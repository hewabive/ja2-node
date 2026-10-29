// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc SoldierGiveItem, VerifyGiveItem, SoldierGiveItemFromAnimation;
// @src Soldier_Control.cc EVENT_SoldierBeginGiveItem, SoldierCollapse (issue #2265);
// @src externalized/Soldier.cc handlePendingAction, anyoneHasPendingAction (MERC_GIVEITEM); Soldier_Ani.cc code 486;
// @src Points.cc GetMovePlusActionAPCosts, GetAPsToGiveItem; Dialogue_Control.cc SetEngagedInConvFromPCAction,
// @src UnSetEngagedInConvFromPCAction.

import { ItemClass } from '../../content/items/items.ts';
import { i32 } from '../../core/int.ts';
import { cloneObject, deleteObject, type ItemObject, removeObjects } from '../items/object.ts';
import { plotPathCost } from './ai/utils.ts';
import { anim } from './anim-states.ts';
import { initNewSoldierAnim, setDesiredDirection } from './animation.ts';
import { findAdjacentGridEx } from './combat/melee-reach.ts';
import { autoPlaceObject, NO_SLOT } from './inventory.ts';
import { getNewSoldierPath } from './movement.ts';
import { AP, deductPoints } from './points.ts';
import { profileProgress } from './profiles.ts';
import { NO_PROFILE, NOBODY, type Soldier, Team } from './soldier.ts';
import { soldierInventoryContext } from './soldier-inventory.ts';
import { type TacticalState, teamMembers, whoIsThere } from './state.ts';
import { addItemToPool, FORCE_ON_GROUND, Visibility } from './world-items.ts';

const NO_FLAGS = 0;

export function apsToGiveItem(t: TacticalState, s: Soldier, gridNo: number): number {
  if (s.gridNo === gridNo) return AP.GIVE_ITEM;
  const move = plotPathCost(t, s, gridNo, s.uiMovementMode);
  return move === 0 ? 0 : move + AP.GIVE_ITEM;
}

export function setEngagedInConvFromPcAction(t: TacticalState, s: Soldier): void {
  t.engagedInConv = true;
  t.engagedInConvFromActionMerc = s.id;
}

export function unsetEngagedInConvFromPcAction(t: TacticalState, s: Soldier): void {
  if (t.engagedInConvFromActionMerc === s.id) t.engagedInConv = false;
}

export function itemName(t: TacticalState, item: number): string {
  return t.content.items.byIndex.get(item)?.name ?? String(item);
}

export function givenItemRef(t: TacticalState, o: ItemObject) {
  const money = t.content.items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY;
  return { item: itemName(t, o.item), count: o.count, status: o.status[0] ?? 0, ...(money ? { money: o.money } : {}) };
}

export function soldierGiveItem(t: TacticalState, giver: Soldier, target: Soldier, object: ItemObject, slot: number): boolean {
  const approach = findAdjacentGridEx(t, giver, target.gridNo, true);
  if (!approach) return false;
  giver.pendingGive = { slot, targetGridNo: target.gridNo, direction: approach.direction, target: target.id, begun: false };
  giver.tempObject = cloneObject(object);
  giver.engagedInAction = true;
  if (giver.gridNo !== approach.actionGridNo) getNewSoldierPath(t, giver, approach.actionGridNo, giver.uiMovementMode, 0, true);
  else {
    beginGiveItem(t, giver);
    setDesiredDirection(t, giver, approach.direction);
  }
  target.engagedInAction = true;
  return true;
}

export function anyMercWalksToGiveItem(t: TacticalState): boolean {
  return teamMembers(t, Team.OUR).some((s) => s.pendingGive !== null && !s.pendingGive.begun);
}

export function handlePendingGiveOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingGive;
  if (!pending || pending.begun) return false;
  beginGiveItem(t, s);
  return true;
}

export function cancelGiveOnCollapse(t: TacticalState, s: Soldier): void {
  if (!s.pendingGive || s.pendingGive.begun) return;
  s.tempObject = null;
  unsetEngagedInConvFromPcAction(t, s);
}

export function clearPendingGive(t: TacticalState, s: Soldier): void {
  const pending = s.pendingGive;
  if (!pending || pending.begun) return;
  const target = t.soldiers[pending.target];
  if (target) target.engagedInAction = false;
  s.pendingGive = null;
  s.tempObject = null;
}

function beginGiveItem(t: TacticalState, s: Soldier): void {
  const pending = s.pendingGive;
  if (!pending) return;
  pending.begun = true;
  if (verifyGiveItem(t, s)) {
    s.desiredDirection = pending.direction;
    s.direction = pending.direction;
    initNewSoldierAnim(t, s, anim(t.content, 'GIVE_ITEM'), 0, false);
    return;
  }
  unsetEngagedInConvFromPcAction(t, s);
  s.tempObject = null;
  s.pendingGive = null;
}

export function verifyGiveItem(t: TacticalState, s: Soldier): Soldier | null {
  const pending = s.pendingGive;
  if (!pending) return null;
  const there = whoIsThere(t, pending.targetGridNo, s.level);
  if (there) {
    if (there.id === pending.target) return there;
    t.events.push({ type: 'giveAborted', soldier: s.id, target: pending.target, reason: 'otherSoldierThere', dropped: false });
    return null;
  }
  const temp = s.tempObject;
  if (temp) {
    addItemToPool(t, s.gridNo, temp, Visibility.VISIBLE, s.level, NO_FLAGS, FORCE_ON_GROUND);
    t.events.push({ type: 'npcMessage', kind: 'itemPlacedOnGround', item: itemName(t, temp.item) });
    s.engagedInAction = false;
    if (pending.target !== NOBODY) {
      const target = t.soldiers[pending.target];
      if (target) target.engagedInAction = false;
    }
    s.tempObject = null;
  }
  t.events.push({ type: 'giveAborted', soldier: s.id, target: pending.target, reason: 'targetMoved', dropped: temp !== null });
  t.narrative.triggerDoneGivingItem(s.profile);
  return null;
}

function handedOver(t: TacticalState, giver: Soldier, target: Soldier, ref: ReturnType<typeof givenItemRef>, dropped: boolean): void {
  if (giver.team === Team.OUR) t.events.push({ type: 'itemGiven', soldier: giver.id, target: target.id, ...ref, dropped });
  else t.events.push({ type: 'npcGaveItem', npc: giver.id, profile: giver.profile, to: target.id, ...ref, dropped });
}

function giveToTeamMember(t: TacticalState, giver: Soldier, target: Soldier, object: ItemObject, slot: number): void {
  const placed = cloneObject(object);
  const ref = givenItemRef(t, object);
  const source = slot !== NO_SLOT ? giver.inv[slot] : undefined;
  if (!autoPlaceObject(soldierInventoryContext(t, target), target, placed)) {
    if (source) deleteObject(source);
    addItemToPool(t, giver.gridNo, placed, Visibility.VISIBLE, giver.level, NO_FLAGS, FORCE_ON_GROUND);
    t.events.push({ type: 'npcMessage', kind: 'itemPlacedOnGround', item: ref.item });
    handedOver(t, giver, target, ref, true);
    giver.engagedInAction = false;
    target.engagedInAction = false;
    return;
  }
  if (source) deleteObject(source);
  handedOver(t, giver, target, ref, false);
  if (ref.money !== undefined) payBalance(t, target, placed.money);
}

function payBalance(t: TacticalState, target: Soldier, leftAfterPlacing: number): void {
  if (target.profile === NO_PROFILE) return;
  const p = profileProgress(t, target.profile);
  if (!p || p.balance >= 0) return;
  p.balance = i32(p.balance + leftAfterPlacing);
  if (p.balance >= 0) {
    p.balance = 0;
    t.events.push({ type: 'npcMessage', kind: 'paidInFull', profile: target.profile });
  } else t.events.push({ type: 'npcMessage', kind: 'stillOwed', profile: target.profile, amount: -p.balance });
}

export function soldierGiveItemFromAnimation(t: TacticalState, s: Soldier): void {
  const temp = s.tempObject;
  if (!temp) return;
  const object = cloneObject(temp);
  s.tempObject = null;
  const slot = s.pendingGive?.slot ?? NO_SLOT;
  deductPoints(t.inCombat, s, AP.PICKUP_ITEM, 0);
  const target = verifyGiveItem(t, s);
  s.pendingGive = null;
  if (target) {
    if (t.narrative.isDealer(target.profile)) {
      unsetEngagedInConvFromPcAction(t, s);
      if (t.narrative.dealerTakesGive(s, target, object, slot)) return;
    }
    if (t.narrative.receivesAsTeamMember(target)) giveToTeamMember(t, s, target, object, slot);
    else {
      const source = slot !== NO_SLOT ? s.inv[slot] : undefined;
      if (source) removeObjects(source, object.count);
      t.narrative.giveToNpc(s, target, object);
    }
    target.engagedInAction = false;
  }
  s.engagedInAction = false;
}

export function giveItemOpcode(t: TacticalState, s: Soldier): void {
  soldierGiveItemFromAnimation(t, s);
  if (s.profile !== NO_PROFILE && t.narrative.isNpcProfile(s.profile)) t.narrative.triggerDoneGivingItem(s.profile);
}
