// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIUtils.cc CalcMorale, CalcManThreatValue, RangeChangeDesire; AIMain.cc ThreatPercent;
// @src Tactical/Soldier_Macros.h CREATURE_OR_BLOODCAT. See docs/13 §4.

import { type ItemTable, WEAPON_CLASSES } from '../../../content/items/items.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import { i16, idiv } from '../../../core/int.ts';
import { armourPercent, type MaxArmour, maxArmourPerClass } from '../combat/armour.ts';
import { soldierToLocationChanceToGetThrough } from '../combat/bullets.ts';
import { isCreatureOrBloodcat } from '../combat/impact.ts';
import { AiMorale } from '../combat/types.ts';
import { InvSlot, itemIn, NO_SLOT } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { seenOpponent } from '../perception/duel.ts';
import { Opp } from '../perception/opp.ts';
import { knowledge, publicOpp } from '../perception/sight.ts';
import { calcActionPoints } from '../points.ts';
import { Attitude, CivilianGroup, consideredNeutral, NOWHERE, OKLIFE, type Soldier, SoldierClass, Team } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { findAIUsableObjClass } from './utils.ts';

export const NO_THREAT = -999;
export const SLAY = 64;

const THREAT_PERCENT = [20, 40, 60, 80, 25, 100, 90, 75, 60, 45];
const OLDEST_HEARD_VALUE = -4;
const FULL_BREATH_MORALE = 75;
const LOW_BREATH_MORALE = 40;
const EXHAUSTED_BREATH_MORALE = 10;
const HEALTHY_MORALE = 75;
const HURT_MORALE = 40;
const BADLY_HURT_MORALE = 20;
const NO_THREAT_MORALE = 500;
const MAX_ARMOUR_BY_TABLE = new WeakMap<ItemTable, MaxArmour>();

export function threatPercent(opplistValue: number): number {
  return THREAT_PERCENT[opplistValue - OLDEST_HEARD_VALUE] ?? 0;
}

export function isKnowableOpponent(s: Soldier, opp: Soldier): boolean {
  if (opp.life < OKLIFE) return false;
  if (consideredNeutral(s, opp) || s.side === opp.side) return false;
  return true;
}

export function ignoredByBountyHunter(s: Soldier, opp: Soldier): boolean {
  return s.ai.attitude === Attitude.ATTACKSLAYONLY && opp.profile !== SLAY;
}

export interface OpponentKnowledge {
  readonly personal: number;
  readonly public: number;
}

export function opponentKnowledge(t: TacticalState, s: Soldier, opp: Soldier): OpponentKnowledge {
  return { personal: s.oppList[opp.id] ?? Opp.NOT_HEARD_OR_SEEN, public: publicOpp(t, s.team, opp) };
}

export function isUnknown(k: OpponentKnowledge): boolean {
  return k.personal === Opp.NOT_HEARD_OR_SEEN && k.public === Opp.NOT_HEARD_OR_SEEN;
}

export function prefersPersonalKnowledge(k: OpponentKnowledge): boolean {
  return knowledge(k.public, k.personal) > 0 || k.personal === k.public;
}

export function mostRecentOpplistValue(k: OpponentKnowledge): number {
  return prefersPersonalKnowledge(k) ? k.personal : k.public;
}

export function bestGuessLocation(t: TacticalState, s: Soldier, opp: Soldier, k: OpponentKnowledge): number {
  if (prefersPersonalKnowledge(k)) return s.lastKnownOpp[opp.id] ?? NOWHERE;
  return t.perception.publicLastKnown[s.team]?.[opp.id] ?? NOWHERE;
}

function maxArmour(items: ItemTable): MaxArmour {
  let max = MAX_ARMOUR_BY_TABLE.get(items);
  if (!max) {
    max = maxArmourPerClass(items);
    MAX_ARMOUR_BY_TABLE.set(items, max);
  }
  return max;
}

function weaponInHandDeadliness(t: TacticalState, s: Soldier): number {
  const def = t.content.items.byIndex.get(itemIn(s.inv, InvSlot.HAND));
  if (!def || !(def.itemClass & WEAPON_CLASSES)) return 0;
  return def.weapon?.deadliness ?? 0;
}

function creatureThreat(enemy: Soldier, myGrid: number): number {
  return idiv((enemy.life + enemy.bleeding) * 10, 10 + pythSpacesAway(myGrid, enemy.gridNo));
}

function soldierThreat(t: TacticalState, enemy: Soldier): number {
  let threat = enemy.stats.experience;
  threat += calcActionPoints(t.content, enemy);
  threat += idiv(enemy.actionPoints, 2);
  threat += idiv(enemy.life, 10);
  threat += idiv(armourPercent(t.content.items, maxArmour(t.content.items), enemy), 4);
  threat += idiv(enemy.stats.marksmanship, 5);
  threat += weaponInHandDeadliness(t, enemy);
  threat -= idiv(enemy.bleeding, 5);
  threat -= idiv(100 - enemy.breath, 10);
  threat -= enemy.shock;
  return threat;
}

export function calcManThreatValue(t: TacticalState, enemy: Soldier, myGrid: number, reduceForCover: boolean, me: Soldier): number {
  if (!enemy.placed || enemy.life === 0) return NO_THREAT;
  let threat = isCreatureOrBloodcat(me) ? creatureThreat(enemy, myGrid) : soldierThreat(t, enemy);
  if (myGrid !== NOWHERE) {
    if (enemy.lastTarget === myGrid) threat += idiv(threat, 10);
    else if (enemy.direction === directionToward(enemy.gridNo, myGrid)) threat += idiv(threat, 20);
  }
  if (enemy.life >= OKLIFE) {
    if (reduceForCover && myGrid !== NOWHERE)
      threat = idiv(threat * soldierToLocationChanceToGetThrough(t, enemy, myGrid, me.level, 0, me), 100);
  } else if (threat > 0) {
    threat = idiv(threat, 4 + (OKLIFE - enemy.life));
  }
  return Math.max(threat, 1);
}

function isMoraleFriend(s: Soldier, friend: Soldier): boolean {
  if (friend.life < OKLIFE) return false;
  if (friend.neutral && !(s.civilianGroup !== CivilianGroup.NONE && s.civilianGroup === friend.civilianGroup)) return false;
  return s.side === friend.side;
}

function friendsThreatAgainst(t: TacticalState, s: Soldier, opp: Soldier, oppThreat: number): number {
  let total = 0;
  for (const friend of mercs(t)) {
    if (!isMoraleFriend(s, friend)) continue;
    const friendKnows = friend.oppList[opp.id] ?? Opp.NOT_HEARD_OR_SEEN;
    let percent = threatPercent(friendKnows);
    if (friendKnows <= Opp.HEARD_LAST_TURN) {
      percent -= pythSpacesAway(s.gridNo, friend.gridNo) * 2;
      if (percent <= 0) continue;
    }
    const friendThreat = i16(idiv(percent * calcManThreatValue(t, friend, opp.gridNo, false, s), 100));
    total += oppThreat * friendThreat;
  }
  return total;
}

function moraleOdds(ours: number, theirs: number): number {
  if (!theirs) return NO_THREAT_MORALE;
  return i16(idiv(100 * idiv(ours, theirs), theirs));
}

function moraleCategory(odds: number): number {
  if (odds <= 25) return AiMorale.HOPELESS;
  if (odds <= 50) return AiMorale.WORRIED;
  if (odds <= 150) return AiMorale.NORMAL;
  if (odds <= 300) return AiMorale.CONFIDENT;
  return AiMorale.FEARLESS;
}

function attitudeMoraleShift(attitude: number): number {
  switch (attitude) {
    case Attitude.DEFENSIVE:
      return -1;
    case Attitude.BRAVESOLO:
    case Attitude.BRAVEAID:
      return 2;
    case Attitude.AGGRESSIVE:
      return 1;
    default:
      return 0;
  }
}

function conditionMoraleShift(s: Soldier): number {
  let shift = 0;
  if (s.breath > FULL_BREATH_MORALE) shift++;
  else {
    if (s.breath < LOW_BREATH_MORALE) shift--;
    if (s.breath < EXHAUSTED_BREATH_MORALE) shift--;
  }
  if (s.life > HEALTHY_MORALE) shift++;
  else {
    if (s.life < HURT_MORALE) shift--;
    if (s.life < BADLY_HURT_MORALE) shift--;
  }
  if (!s.ai.underFire) shift++;
  return shift;
}

function isBrave(s: Soldier): boolean {
  return s.ai.attitude === Attitude.BRAVESOLO || s.ai.attitude === Attitude.BRAVEAID;
}

export function calcMorale(t: TacticalState, s: Soldier): number {
  if (s.team === Team.ENEMY && findAIUsableObjClass(t, s, WEAPON_CLASSES) === NO_SLOT) return AiMorale.HOPELESS;
  let theirs = 0;
  let ours = 0;
  for (const opp of mercs(t)) {
    if (!isKnowableOpponent(s, opp) || ignoredByBountyHunter(s, opp)) continue;
    const k = opponentKnowledge(t, s, opp);
    let value: number;
    if (isUnknown(k)) {
      if (!seenOpponent(t, s.id, opp.id)) continue;
      value = Opp.NOT_HEARD_OR_SEEN;
    } else value = mostRecentOpplistValue(k);
    const oppThreat = i16(idiv(threatPercent(value) * calcManThreatValue(t, opp, s.gridNo, false, s), 100));
    theirs += oppThreat;
    ours += friendsThreatAgainst(t, s, opp, oppThreat);
  }
  let category = moraleCategory(moraleOdds(ours, theirs));
  category += attitudeMoraleShift(s.ai.attitude);
  if (s.soldierClass === SoldierClass.ADMINISTRATOR) category += 2;
  category += conditionMoraleShift(s);
  category = Math.min(AiMorale.FEARLESS, Math.max(AiMorale.HOPELESS, category));
  if (category === AiMorale.HOPELESS && isBrave(s)) category = AiMorale.WORRIED;
  return category;
}

function attitudeRangeShift(attitude: number): number {
  switch (attitude) {
    case Attitude.DEFENSIVE:
      return -1;
    case Attitude.BRAVESOLO:
    case Attitude.BRAVEAID:
      return 2;
    case Attitude.ATTACKSLAYONLY:
    case Attitude.AGGRESSIVE:
      return 1;
    default:
      return 0;
  }
}

export function rangeChangeDesire(t: TacticalState, s: Soldier): number {
  let desire = s.ai.morale - 1 + attitudeRangeShift(s.ai.attitude);
  const unseenTurns = t.turn.consNumTurnsWeHaventSeenButEnemyDoes;
  if (unseenTurns > 0) desire += unseenTurns;
  return desire;
}
