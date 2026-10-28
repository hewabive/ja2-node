// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-28. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Town_Loyalty.cc HandleMurderOfCivilian.

import { type Sector, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { idiv } from '../../core/int.ts';
import {
  GAIN_PTS_PER_LOYALTY_PT,
  LOYALTY_EVENT_DISTANCE_THRESHOLD,
  MAX_LOYALTY_VALUE,
  MoraleEvent,
  Town,
} from '../strategic/economy/constants.ts';
import { affectAllTownsLoyaltyByDistanceFrom, usesLoyalty } from '../strategic/economy/loyalty.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { townOf } from '../strategic/economy/towns.ts';
import { checkFact } from '../strategic/narrative/check-fact.ts';
import { economyFactContext } from '../strategic/narrative/economy-facts.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { soldierToSoldierLos } from '../tactical/combat/positions.ts';
import { Body, CivilianGroup, isMonster, NO_PROFILE, type Soldier, Team } from '../tactical/soldier.ts';
import { type TacticalState, teamMembers } from '../tactical/state.ts';

export const Witnessed = { NOTHING: 0, KILLER: 1, VICTIM: 2, EVERYTHING: 3 } as const;

const TOWN_DOESNT_CARE_ABOUT_DEATH = 0x40;
const HOSTILE_CIVILIAN_GROUPS: ReadonlySet<number> = new Set([
  CivilianGroup.KINGPIN,
  CivilianGroup.ALMA_MILITARY,
  CivilianGroup.HICKS,
  CivilianGroup.WARDEN,
]);
const BASIC_COST_FOR_CIV_MURDER = 10 * GAIN_PTS_PER_LOYALTY_PT;
const REDUCTION_FOR_UNINTENTIONAL_KILLING = 50;
const REDUCTION_FOR_MURDER_BY_REBEL = 70;
const REDUCTION_FOR_MURDER_NOT_OUR_FAULT = 50;
const REDUCTION_FOR_MURDER_OF_INNOCENT_BY_ENEMY_IN_OUR_SECTOR = 25;
const MULTIPLIER_FOR_MURDER_BY_MONSTER = 2;
const PERCENT_PER_NEAR_SECTOR = 25;
const DISTANCE_ZERO_COMPENSATION = 100 + PERCENT_PER_NEAR_SECTOR * LOYALTY_EVENT_DISTANCE_THRESHOLD;
const STRAIGHT_RANGE = 13;
const PERCENT = 100;
const FALSE_ACCUSAL_WHEN_ONLY_KILLER_SEEN = 10;
const FALSE_ACCUSAL_WHEN_ONLY_VICTIM_SEEN = 50;

interface TownVerdict {
  readonly change: number;
  readonly increment: boolean;
}

function townCaresAboutDeath(t: TacticalState, victim: Soldier): boolean {
  if (victim.team !== Team.CIV || victim.bodyType === Body.CROW) return false;
  if (victim.profile !== NO_PROFILE && (t.profiles.get(victim.profile)?.miscFlags3 ?? 0) & TOWN_DOESNT_CARE_ABOUT_DEATH) return false;
  return !HOSTILE_CIVILIAN_GROUPS.has(victim.civilianGroup);
}

function murderCost(ctx: EconomyContext, body: number): number {
  if (body < Body.FATCIV || body > Body.COW) return BASIC_COST_FOR_CIV_MURDER;
  return ctx.economy.loyalty.civilianMurderCost[body - Body.FATCIV] ?? BASIC_COST_FOR_CIV_MURDER;
}

export function murderWitnesses(t: TacticalState, victim: Soldier, killer: Soldier): number {
  let seen: number = Witnessed.NOTHING;
  for (const civ of teamMembers(t, Team.CIV)) {
    if (civ === victim) continue;
    if (soldierToSoldierLos(t, civ, killer, STRAIGHT_RANGE, true) !== 0) seen |= Witnessed.KILLER;
    if (soldierToSoldierLos(t, civ, victim, STRAIGHT_RANGE, true) !== 0) seen |= Witnessed.VICTIM;
  }
  return seen;
}

export function falseAccusalChance(seen: number, townRating: number): number {
  if (seen === Witnessed.NOTHING) return MAX_LOYALTY_VALUE - townRating;
  if (seen === Witnessed.KILLER) return FALSE_ACCUSAL_WHEN_ONLY_KILLER_SEEN;
  if (seen === Witnessed.VICTIM) return FALSE_ACCUSAL_WHEN_ONLY_VICTIM_SEEN;
  return 0;
}

const percentOf = (value: number, percent: number) => idiv(value * percent, PERCENT);
const enemyControlled = (ctx: EconomyContext, sector: Sector) => ctx.state.map.elements[strategicIndex(sector)]?.enemyControlled === true;

function townVerdict(ctx: EconomyContext, blamedTeam: number, killer: Soldier, change: number, sector: Sector): TownVerdict | null {
  if (blamedTeam === Team.OUR) return { change, increment: false };
  if (blamedTeam === Team.ENEMY) {
    if (enemyControlled(ctx, sector)) return { change, increment: true };
    return { change: percentOf(change, REDUCTION_FOR_MURDER_OF_INNOCENT_BY_ENEMY_IN_OUR_SECTOR), increment: false };
  }
  if (blamedTeam === Team.MILITIA) {
    if (checkFact(economyFactContext(ctx), Fact.REBELS_HATE_PLAYER, 0)) return { change, increment: false };
    return { change: percentOf(change, REDUCTION_FOR_MURDER_BY_REBEL), increment: false };
  }
  if (blamedTeam === Team.CREATURE) {
    if (!isMonster(killer)) return { change, increment: false };
    return { change: change * MULTIPLIER_FOR_MURDER_BY_MONSTER, increment: enemyControlled(ctx, sector) };
  }
  return null;
}

export function handleMurderOfCivilian(ctx: EconomyContext, t: TacticalState, victim: Soldier, sector: Sector): void {
  const killer = victim.attacker;
  if (!killer || !townCaresAboutDeath(t, victim)) return;
  let blamedTeam = killer.team;
  if (blamedTeam === Team.OUR) ctx.hooks.moraleEvent(MoraleEvent.KILLED_CIVILIAN, sector);
  const town = townOf(ctx, sector);
  if (town === Town.BLANK || !usesLoyalty(ctx, town)) return;
  let change = murderCost(ctx, victim.bodyType);
  if (!victim.intendedTarget) change = percentOf(change, REDUCTION_FOR_UNINTENTIONAL_KILLING);
  if (blamedTeam !== Team.OUR) {
    const rating = ctx.state.economy.towns[town]?.rating ?? 0;
    if (ctx.random.int(PERCENT) < falseAccusalChance(murderWitnesses(t, victim, killer), rating)) {
      blamedTeam = Team.OUR;
      change = percentOf(change, REDUCTION_FOR_MURDER_NOT_OUR_FAULT);
    }
  }
  const verdict = townVerdict(ctx, blamedTeam, killer, change, sector);
  if (!verdict) return;
  const signed = verdict.increment ? verdict.change : -verdict.change;
  affectAllTownsLoyaltyByDistanceFrom(ctx, idiv(signed * PERCENT, DISTANCE_ZERO_COMPENSATION), sector);
}
