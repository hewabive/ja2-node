// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc CheckForAndAddMercToTeamPanel (the mercs of the current squad), PrintAP
// @src (the AP colour), SetStatsHelp (MERC_VITAL_STATS_POPUPTEXT, the robot's STR_LATE_16), FindNextActiveAndAliveMerc;
// @src src/game/Tactical/Soldier_Macros.h IS_MERC_BODY_TYPE, AM_AN_EPC; src/game/Strategic/Morale.cc GetMoraleString.
// See docs/28 §5.1, §5.2.

import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { BarValues } from './bars.ts';
import { OKLIFE } from './faces.ts';

export const OUR_TEAM = 0;
const REGFEMALE = 3;
const MERC_VITAL_STATS_POPUPTEXT = 61;
const STR_LATE_16 = 15;
const MORALE_STRINGS = 'pMoralStrings';

export type ApColour = 'dkred' | 'ltblue' | 'ltyellow' | 'ltgray';

export function ownSoldiers(view: PlayerView | null): SoldierView[] {
  return (view?.soldiers ?? []).filter((s) => s.team === OUR_TEAM).sort((a, b) => a.id - b.id);
}

export function soldierById(view: PlayerView | null, id: number | null): SoldierView | null {
  if (id === null) return null;
  return view?.soldiers.find((s) => s.id === id) ?? null;
}

export function squadOf(s: SoldierView): number {
  return s.squad ?? 0;
}

export function isMercBodyType(s: SoldierView): boolean {
  return s.bodyType >= 0 && s.bodyType <= REGFEMALE;
}

export function isEpc(s: SoldierView): boolean {
  return s.kind === 'epc';
}

export function isRobot(s: SoldierView): boolean {
  return s.controlled !== undefined;
}

export function isInVehicle(s: SoldierView): boolean {
  return s.vehicle !== undefined && s.vehicle !== null;
}

export function isDead(s: SoldierView): boolean {
  return (s.life ?? 0) <= 0;
}

export function inCombat(view: PlayerView | null): boolean {
  return (view?.combat ?? null) !== null;
}

export function ourTurn(view: PlayerView | null): boolean {
  const combat = view?.combat ?? null;
  return combat === null || combat.team === OUR_TEAM;
}

export function okInterrupt(s: SoldierView): boolean {
  return s.canAct !== false;
}

export function apColour(s: SoldierView): ApColour {
  if ((s.ap ?? 0) < 0) return 'dkred';
  if (s.stealth === true) return 'ltyellow';
  return 'ltgray';
}

export function showsAp(view: PlayerView | null, s: SoldierView): boolean {
  return inCombat(view) && (s.life ?? 0) >= OKLIFE && !isDead(s);
}

export function barValues(s: SoldierView): BarValues {
  return {
    life: s.life ?? 0,
    lifeMax: s.lifeMax ?? 0,
    bleeding: s.bleeding ?? 0,
    breath: s.breath ?? 0,
    breathMax: s.breathMax ?? 0,
    morale: s.morale ?? 0,
    robot: isRobot(s),
    vehicle: false,
  };
}

const MORALE_THRESHOLDS = [80, 65, 35, 20] as const;
const MORALE_DEAD = 5;

export function moraleString(text: UiTextService, s: SoldierView): string {
  if (isDead(s)) return text.string(MORALE_STRINGS, MORALE_DEAD) ?? '';
  const morale = s.morale ?? 0;
  const level = MORALE_THRESHOLDS.findIndex((threshold) => morale > threshold);
  return text.string(MORALE_STRINGS, level < 0 ? MORALE_THRESHOLDS.length : level) ?? '';
}

export function vitalStatsHelp(text: UiTextService, s: SoldierView): string {
  const life = s.life ?? 0;
  if (life === 0) return '';
  if (isRobot(s)) return printf(text.string('gzLateLocalizedString', STR_LATE_16) ?? '', [life, s.lifeMax ?? 0]);
  return printf(text.string('TacticalStr', MERC_VITAL_STATS_POPUPTEXT) ?? '', [
    life,
    s.lifeMax ?? 0,
    s.breath ?? 0,
    s.breathMax ?? 0,
    moraleString(text, s),
  ]);
}

export function activeAndAlive(s: SoldierView): boolean {
  return !isDead(s);
}

export function nextMerc(mercs: readonly SoldierView[], current: number | null, step: 1 | -1): SoldierView | null {
  const alive = mercs.filter(activeAndAlive);
  if (alive.length === 0) return null;
  const at = alive.findIndex((s) => s.id === current);
  if (at < 0) return alive[0] ?? null;
  return alive[(at + step + alive.length) % alive.length] ?? null;
}
