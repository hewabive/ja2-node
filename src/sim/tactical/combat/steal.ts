// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc MercStealFromMerc; Points.cc GetAPsToStealItem; Turn_Based_Input.cc
// @src HandleHandCursorClick (the steal click); Soldier_Find.cc GetSoldierFindFlags (ENEMY_MERC, UNCONSCIOUS_MERC);
// @src Weapons.cc UseHandToHand (the steal branch, without the curse sound, which the browser plays);
// @src Soldier_Ani.cc opcode 485 (try steal).

import type { OpOutcome } from '../../../content/anim/script.ts';
import { NOTHING } from '../../../content/items/items.ts';
import { idiv } from '../../../core/int.ts';
import type { StealAttemptEvent } from '../../events.ts';
import { deleteObject, type ItemObject } from '../../items/object.ts';
import { plotPathCost } from '../ai/utils.ts';
import { AnimHeight } from '../animation.ts';
import { reloadSoldierAnimationDueToHandItemChange } from '../hand-item.ts';
import { autoPlaceObject, InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { AP, apsToChangeStance } from '../points.ts';
import { StatKind } from '../profiles.ts';
import { Body, isCreatureOrBloodcat, isMechanical, isTank, OKLIFE, Side, type Soldier, Team } from '../soldier.ts';
import { soldierInventoryContext } from '../soldier-inventory.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { addItemToPool, FORCE_ON_GROUND, Visibility } from '../world-items.ts';
import { freeUpAttacker } from './barrier.ts';
import { StatCause, statChange } from './experience.ts';
import { beginStealing, calcChanceToSteal, MeleeKind, noticeStrike, reduceMonsterSmell } from './melee.ts';
import { findAdjacentGridEx } from './melee-reach.ts';

const TRY_STEAL_CODE = 485;
const UNAWARE_STEAL_BONUS = 20;
const SURE_STEAL_CHANCE = 100;
const STEAL_SUCCESS_XP = 8;
const STEAL_FAILURE_XP = 4;
const NO_FLAGS = 0;

type StealResult = StealAttemptEvent['result'];

const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;
const cannotBeRobbed = (s: Soldier) => isRobot(s) || isTank(s) || isCreatureOrBloodcat(s);

export function canBeStolenFrom(s: Soldier): boolean {
  return s.team !== Team.OUR && !s.neutral && s.side !== Side.FRIENDLY && s.life >= OKLIFE;
}

export function stealActionGridNo(t: TacticalState, s: Soldier, tgt: Soldier): number {
  return findAdjacentGridEx(t, s, tgt.gridNo, true)?.actionGridNo ?? tgt.gridNo;
}

export function apsToStealItem(t: TacticalState, s: Soldier, actionGridNo: number): number {
  return plotPathCost(t, s, actionGridNo, s.uiMovementMode) + AP.STEAL_ITEM + apsToChangeStance(t.content, s, AnimHeight.STAND);
}

export function mercStealFromMerc(t: TacticalState, s: Soldier, tgt: Soldier): boolean {
  const approach = findAdjacentGridEx(t, s, tgt.gridNo, true);
  if (!approach) return false;
  s.pendingMelee = { kind: MeleeKind.STEAL, targetGridNo: tgt.gridNo, direction: approach.direction, animCount: 0 };
  s.pendingActionData2 = tgt.gridNo;
  s.targetLevel = tgt.level;
  if (s.gridNo !== approach.actionGridNo)
    t.gameEvents.push({ kind: 'getNewPath', soldier: s.id, destination: approach.actionGridNo, mode: s.uiMovementMode });
  else {
    s.pendingMelee = null;
    beginStealing(t, s, approach.direction);
  }
  t.turn.attackBusyCount++;
  s.attackingWeapon = NOTHING;
  return true;
}

function stealChance(t: TacticalState, s: Soldier, tgt: Soldier): number {
  if (cannotBeRobbed(tgt)) return 0;
  if (tgt.oppList[s.id] === Opp.NOT_HEARD_OR_SEEN) return calcChanceToSteal(t, s, tgt, s.aimTime) + UNAWARE_STEAL_BONUS;
  if (tgt.life < OKLIFE || tgt.collapsed) return SURE_STEAL_CHANCE;
  return calcChanceToSteal(t, s, tgt, s.aimTime);
}

function earnsStealExperience(s: Soldier, tgt: Soldier): boolean {
  return s.team === Team.OUR && tgt.team !== Team.OUR && !isMechanical(tgt);
}

function grab(t: TacticalState, s: Soldier, taken: ItemObject): void {
  if (!autoPlaceObject(soldierInventoryContext(t, s), s, taken))
    addItemToPool(t, s.gridNo, taken, Visibility.VISIBLE, s.level, NO_FLAGS, FORCE_ON_GROUND);
  deleteObject(taken);
}

function knockAway(t: TacticalState, s: Soldier, tgt: Soldier, taken: ItemObject, chance: number): void {
  const nearThief = t.pre.int(100) < chance;
  addItemToPool(t, nearThief ? s.gridNo : tgt.gridNo, taken, Visibility.VISIBLE, s.level, NO_FLAGS, FORCE_ON_GROUND);
  deleteObject(taken);
}

function steal(t: TacticalState, s: Soldier, tgt: Soldier): void {
  const chance = stealChance(t, s, tgt);
  const roll = t.pre.int(100);
  const taken = tgt.inv[InvSlot.HAND] as ItemObject;
  const item = taken.item;
  if (item === NOTHING) return;
  const event = (result: StealResult) => t.events.push({ type: 'stealAttempt', soldier: s.id, target: tgt.id, item, result });
  if (roll > chance) {
    event('failed');
    if (chance > 0 && earnsStealExperience(s, tgt)) statChange(t, s, StatKind.STRENGTH, STEAL_FAILURE_XP, StatCause.FAILURE);
    return;
  }
  const grabbed = roll <= idiv(chance * 2, 3);
  event(grabbed ? 'grabbed' : 'dropped');
  if (earnsStealExperience(s, tgt)) statChange(t, s, StatKind.STRENGTH, STEAL_SUCCESS_XP, StatCause.SUCCESS);
  if (grabbed) grab(t, s, taken);
  else knockAway(t, s, tgt, taken, chance);
  reloadSoldierAnimationDueToHandItemChange(t, tgt, item, NOTHING);
}

export function useHandToHandSteal(t: TacticalState, s: Soldier, g: number): void {
  const tgt = whoIsThere(t, g, s.targetLevel);
  if (tgt) {
    noticeStrike(s, tgt);
    steal(t, s, tgt);
    freeUpAttacker(t, s);
  }
  reduceMonsterSmell(t, s);
}

export function stealOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== TRY_STEAL_CODE) return null;
  useHandToHandSteal(t, s, s.pendingActionData2);
  return 'continue';
}
