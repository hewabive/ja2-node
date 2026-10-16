// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Morale.cc gbMoraleEvent, RefreshSoldierMorale, UpdateSoldierMorale, HandleMoraleEventForSoldier,
// @src HandleMoraleEvent (the strategic events; reputation is M5). See docs/11 §9, docs/19 §2.16, §3.6.

import { type Sector, sameSector, sectorFromId } from '../../content/strategic/sector-ids.ts';
import { clamp } from '../../core/int.ts';
import { Assignment, CONSCIOUSNESS, MoraleEvent as EconomyMoraleEvent } from '../strategic/economy/constants.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import type { RosterMerc } from './roster.ts';

export const MoraleEvent = {
  KILLED_ENEMY: 0,
  SQUADMATE_DIED: 1,
  SUPPRESSED: 2,
  AIRSTRIKE: 3,
  DID_LOTS_OF_DAMAGE: 4,
  TOOK_LOTS_OF_DAMAGE: 5,
  KILLED_CIVILIAN: 6,
  BATTLE_WON: 7,
  RAN_AWAY: 8,
  HEARD_BATTLE_WON: 9,
  HEARD_BATTLE_LOST: 10,
  TOWN_LIBERATED: 11,
  TOWN_LOST: 12,
  MINE_LIBERATED: 13,
  MINE_LOST: 14,
  SAM_SITE_LIBERATED: 15,
  SAM_SITE_LOST: 16,
  BUDDY_DIED: 17,
  HATED_DIED: 18,
  TEAMMATE_DIED: 19,
  LOW_DEATHRATE: 20,
  HIGH_DEATHRATE: 21,
  GREAT_MORALE: 22,
  POOR_MORALE: 23,
  DRUGS_CRASH: 24,
  ALCOHOL_CRASH: 25,
  MONSTER_QUEEN_KILLED: 26,
  DEIDRANNA_KILLED: 27,
  CLAUSTROPHOBE_UNDERGROUND: 28,
  INSECT_PHOBIC_SEES_CREATURE: 29,
  NERVOUS_ALONE: 30,
  MERC_CAPTURED: 31,
  MERC_MARRIED: 32,
  QUEEN_BATTLE_WON: 33,
  SEX: 34,
} as const;

const TACTICAL = 0;
const STRATEGIC = 1;

const MORALE_EVENTS: readonly (readonly [number, number])[] = [
  [TACTICAL, 4],
  [TACTICAL, -5],
  [TACTICAL, -1],
  [TACTICAL, -2],
  [TACTICAL, 2],
  [TACTICAL, -3],
  [STRATEGIC, -5],
  [STRATEGIC, 4],
  [STRATEGIC, -5],
  [STRATEGIC, 2],
  [STRATEGIC, -2],
  [STRATEGIC, 5],
  [STRATEGIC, -5],
  [STRATEGIC, 8],
  [STRATEGIC, -8],
  [STRATEGIC, 3],
  [STRATEGIC, -3],
  [STRATEGIC, -15],
  [STRATEGIC, 5],
  [STRATEGIC, -5],
  [STRATEGIC, 5],
  [STRATEGIC, -5],
  [STRATEGIC, 2],
  [STRATEGIC, -2],
  [TACTICAL, -10],
  [TACTICAL, -10],
  [STRATEGIC, 15],
  [STRATEGIC, 25],
  [TACTICAL, -1],
  [TACTICAL, -5],
  [TACTICAL, -1],
  [STRATEGIC, -5],
  [STRATEGIC, -5],
  [STRATEGIC, 8],
  [STRATEGIC, 5],
];

const Attitude = { OPTIMIST: 3, PESSIMIST: 4, AGGRESSIVE: 5, COWARD: 9 } as const;
const MORALE_MOD_MAX = 50;
const DEFAULT_MORALE = 50;
const MAX_MORALE = 100;
const PROGRESS_MORALE_DIVISOR = 5;
const ROOF_LEVEL = 1;
const HIGH_LEVEL = 5;
const COMPARED_BUDDIES = 3;
const PHOBIC_LIMIT = -20;

export interface MoraleContext {
  readonly team: readonly RosterMerc[];
  readonly profiles: ReadonlyMap<number, ProfileProgress>;
  readonly progress: number;
  readonly enemyInSector: boolean;
}

const SOLDIER_ONLY: ReadonlySet<number> = new Set([
  MoraleEvent.KILLED_ENEMY,
  MoraleEvent.DID_LOTS_OF_DAMAGE,
  MoraleEvent.DRUGS_CRASH,
  MoraleEvent.ALCOHOL_CRASH,
  MoraleEvent.SUPPRESSED,
  MoraleEvent.TOOK_LOTS_OF_DAMAGE,
  MoraleEvent.HIGH_DEATHRATE,
  MoraleEvent.SEX,
]);

const PHOBIC: ReadonlySet<number> = new Set([
  MoraleEvent.CLAUSTROPHOBE_UNDERGROUND,
  MoraleEvent.INSECT_PHOBIC_SEES_CREATURE,
  MoraleEvent.NERVOUS_ALONE,
]);

const EVERYONE: ReadonlySet<number> = new Set([
  MoraleEvent.TOWN_LIBERATED,
  MoraleEvent.TOWN_LOST,
  MoraleEvent.MINE_LIBERATED,
  MoraleEvent.MINE_LOST,
  MoraleEvent.SAM_SITE_LIBERATED,
  MoraleEvent.SAM_SITE_LOST,
  MoraleEvent.KILLED_CIVILIAN,
  MoraleEvent.LOW_DEATHRATE,
  MoraleEvent.HEARD_BATTLE_WON,
  MoraleEvent.HEARD_BATTLE_LOST,
  MoraleEvent.MONSTER_QUEEN_KILLED,
  MoraleEvent.DEIDRANNA_KILLED,
  MoraleEvent.MERC_CAPTURED,
]);

const IN_SECTOR_ONLY: ReadonlySet<number> = new Set([MoraleEvent.POOR_MORALE, MoraleEvent.GREAT_MORALE, MoraleEvent.AIRSTRIKE]);

export const ECONOMY_MORALE_EVENTS: Readonly<Record<string, number>> = {
  [EconomyMoraleEvent.TOWN_LIBERATED]: MoraleEvent.TOWN_LIBERATED,
  [EconomyMoraleEvent.TOWN_LOST]: MoraleEvent.TOWN_LOST,
  [EconomyMoraleEvent.MINE_LIBERATED]: MoraleEvent.MINE_LIBERATED,
  [EconomyMoraleEvent.MINE_LOST]: MoraleEvent.MINE_LOST,
  [EconomyMoraleEvent.SAM_SITE_LIBERATED]: MoraleEvent.SAM_SITE_LIBERATED,
  [EconomyMoraleEvent.SAM_SITE_LOST]: MoraleEvent.SAM_SITE_LOST,
  [EconomyMoraleEvent.KILLED_CIVILIAN]: MoraleEvent.KILLED_CIVILIAN,
  [EconomyMoraleEvent.RAN_AWAY]: MoraleEvent.RAN_AWAY,
};

const isMechanical = (m: RosterMerc) => m.isVehicle || m.isRobot;

function moraleCounts(m: RosterMerc): boolean {
  const a = m.assignment;
  return (
    m.soldier.life >= CONSCIOUSNESS &&
    !isMechanical(m) &&
    !m.isEpc &&
    a !== Assignment.ASSIGNMENT_DEAD &&
    a !== Assignment.ASSIGNMENT_POW &&
    a !== Assignment.IN_TRANSIT
  );
}

export function refreshMercMorale(ctx: MoraleContext, m: RosterMerc): void {
  if (m.asleep) return;
  const s = m.soldier;
  const total =
    DEFAULT_MORALE + s.teamMoraleMod + s.tacticalMoraleMod + s.strategicMoraleMod + Math.trunc(ctx.progress / PROGRESS_MORALE_DIVISOR);
  s.morale = clamp(total, 0, MAX_MORALE);
}

function adjustedChange(ctx: MoraleContext, m: RosterMerc, base: number): number {
  const attitude = ctx.profiles.get(m.profile)?.attitude ?? 0;
  let mod = base;
  if (mod > 0) {
    if (attitude === Attitude.OPTIMIST || attitude === Attitude.AGGRESSIVE) mod++;
    else if (attitude === Attitude.PESSIMIST) mod--;
    return mod;
  }
  if (attitude === Attitude.OPTIMIST) mod++;
  else if (attitude === Attitude.PESSIMIST) mod--;
  else if (attitude === Attitude.COWARD) mod -= 2;
  if (m.soldier.level === ROOF_LEVEL) mod--;
  else if (m.soldier.level > HIGH_LEVEL) mod++;
  return Math.min(mod, 0);
}

function updateMercMorale(ctx: MoraleContext, m: RosterMerc, type: number, base: number): void {
  if (!moraleCounts(m) || !ctx.profiles.has(m.profile)) return;
  const s = m.soldier;
  const mod = adjustedChange(ctx, m, base);
  if (type === TACTICAL) s.tacticalMoraleMod = clamp(s.tacticalMoraleMod + mod, -MORALE_MOD_MAX, MORALE_MOD_MAX);
  else if (ctx.enemyInSector && !s.placed)
    s.delayedStrategicMoraleMod = clamp(s.delayedStrategicMoraleMod + mod, -MORALE_MOD_MAX, MORALE_MOD_MAX);
  else s.strategicMoraleMod = clamp(s.strategicMoraleMod + mod, -MORALE_MOD_MAX, MORALE_MOD_MAX);
  refreshMercMorale(ctx, m);
}

function apply(ctx: MoraleContext, m: RosterMerc, event: number): void {
  const [type, change] = MORALE_EVENTS[event] ?? [TACTICAL, 0];
  updateMercMorale(ctx, m, type, change);
}

const inSector = (m: RosterMerc, s: Sector) => !m.betweenSectors && sameSector(m.sector, s);

function leftSector(m: RosterMerc, s: Sector): boolean {
  if (!m.betweenSectors || m.sector.z !== s.z) return false;
  const prev = sectorFromId(m.prevSectorId, s.z);
  return prev.x === s.x && prev.y === s.y;
}

function ranAway(ctx: MoraleContext, m: RosterMerc, s: Sector): void {
  if (!inSector(m, s) && !leftSector(m, s)) {
    apply(ctx, m, MoraleEvent.HEARD_BATTLE_LOST);
    return;
  }
  const attitude = ctx.profiles.get(m.profile)?.attitude ?? 0;
  if (attitude === Attitude.COWARD) return;
  if (attitude === Attitude.AGGRESSIVE) apply(ctx, m, MoraleEvent.RAN_AWAY);
  apply(ctx, m, MoraleEvent.RAN_AWAY);
}

function teammateDied(ctx: MoraleContext, dead: RosterMerc, s: Sector): void {
  for (const other of ctx.team) {
    const p = ctx.profiles.get(other.profile);
    if (!p) continue;
    if (p.hated.slice(0, COMPARED_BUDDIES).includes(dead.profile)) {
      apply(ctx, other, MoraleEvent.HATED_DIED);
      continue;
    }
    if (inSector(other, s)) apply(ctx, other, MoraleEvent.SQUADMATE_DIED);
    apply(ctx, other, MoraleEvent.TEAMMATE_DIED);
    if (p.buddies.slice(0, COMPARED_BUDDIES).includes(dead.profile)) apply(ctx, other, MoraleEvent.BUDDY_DIED);
  }
}

export function handleMoraleEvent(ctx: MoraleContext, subject: RosterMerc | null, event: number, s: Sector): void {
  if (SOLDIER_ONLY.has(event)) {
    if (subject) apply(ctx, subject, event);
    return;
  }
  if (PHOBIC.has(event)) {
    if (subject && subject.soldier.tacticalMoraleMod > PHOBIC_LIMIT) apply(ctx, subject, event);
    return;
  }
  if (event === MoraleEvent.BATTLE_WON) {
    for (const m of ctx.team) apply(ctx, m, inSector(m, s) ? MoraleEvent.BATTLE_WON : MoraleEvent.HEARD_BATTLE_WON);
    return;
  }
  if (event === MoraleEvent.RAN_AWAY) {
    for (const m of ctx.team) ranAway(ctx, m, s);
    return;
  }
  if (event === MoraleEvent.TEAMMATE_DIED) {
    if (subject) teammateDied(ctx, subject, s);
    return;
  }
  if (EVERYONE.has(event)) {
    for (const m of ctx.team) apply(ctx, m, event);
    return;
  }
  if (IN_SECTOR_ONLY.has(event)) for (const m of ctx.team) if (inSector(m, s)) apply(ctx, m, event);
}
