// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc SoldierPickupItem, HandleSoldierPickupItem, SoldierGetItemFromWorld,
// @src HandleAutoPlaceFail, ItemPoolOKForPickup, SoldierDropItem, SoldierHandleDropItem, AdjustGridNoForItemPlacement;
// @src Soldier_Control.cc PickPickupAnimation, PickDropItemAnimation; Soldier_Ani.cc codes 487, 493;
// @src externalized/Soldier.cc handlePendingAction (MERC_PICKUPITEM). See docs/12 §6.5–§6.6.

import type { OpOutcome } from '../../content/anim/script.ts';
import { DIRECTION_INCREMENT, newGridNo } from '../../content/world/grid.ts';
import { has, STRUCTURE_ON_GROUND, STRUCTURE_ON_ROOF, StructureFlags } from '../../content/world/structures.ts';
import { cloneObject, deleteObject } from '../items/object.ts';
import { AiAction } from './ai/actions.ts';
import { anim } from './anim-states.ts';
import { AnimHeight, height, initNewSoldierAnim, soldierGotoStationaryStance } from './animation.ts';
import { StatCause, statChange } from './combat/experience.ts';
import { DIRECTION_COUNT } from './directions.ts';
import { autoPlaceObject } from './inventory.ts';
import { directionToward, getNewSoldierPath } from './movement.ts';
import { findBestPath, isWater, newOKDestination, PathCopy } from './pathfinding.ts';
import { AP, deductPoints } from './points.ts';
import { StatKind } from './profiles.ts';
import { type PendingPickup, type Soldier, Team } from './soldier.ts';
import { soldierInventoryContext } from './soldier-inventory.ts';
import { type TacticalState, whoIsThere } from './state.ts';
import { addItemToPool, FORCE_ON_GROUND, itemsAt, lookForHiddenItems, removeWorldItem, Visibility, type WorldItem } from './world-items.ts';

const Code = { GIVE_ITEM: 486, DROP_ITEM: 487, PICKUP_ITEM: 493 } as const;
const HIDDEN_ITEM_WISDOM_GAIN = 5;

export function itemPlacementBlocked(t: TacticalState, s: Soldier, g: number): boolean {
  const desired = s.level !== 0 ? STRUCTURE_ON_ROOF : STRUCTURE_ON_GROUND;
  const blocked = t.world.structures
    .at(g)
    .some((x) => has(x.flags, StructureFlags.BLOCKSMOVES) && !has(x.flags, StructureFlags.PASSABLE) && x.cubeOffset === desired);
  if (blocked) return true;
  const occupant = whoIsThere(t, g, s.level);
  return occupant !== null && occupant !== s;
}

export function pickupCandidates(t: TacticalState, s: Soldier, g: number, zLevel: number): WorldItem[] {
  return itemsAt(t, g, s.level).filter((wi) => itemPoolOKForPickup(s, wi, zLevel));
}

function itemPoolOKForPickup(s: Soldier, wi: WorldItem, zLevel: number): boolean {
  if (s.team === Team.OUR && wi.visible !== Visibility.VISIBLE) return false;
  return zLevel === 0 ? wi.zHeight === 0 : wi.zHeight > 0;
}

export function adjustGridNoForItemPlacement(t: TacticalState, s: Soldier, g: number): number {
  if (!itemPlacementBlocked(t, s, g)) return g;
  let best = g;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const spot = newGridNo(g, DIRECTION_INCREMENT[d] ?? 0);
    if (spot === s.gridNo) return spot;
    if (!newOKDestination(t.pathEnv, s, spot, true, s.level)) continue;
    const route = findBestPath(t.pathEnv, s, spot, s.level, { copy: PathCopy.NONE });
    if (route.length > 0 && route.length < bestCost) {
      bestCost = route.length;
      best = spot;
    }
  }
  return best;
}

export function soldierPickupItem(
  t: TacticalState,
  s: Soldier,
  g: number,
  zLevel: number,
  selection: readonly WorldItem[] | null,
): boolean {
  const actionGridNo = adjustGridNoForItemPlacement(t, s, g);
  s.pendingPickup = { gridNo: g, actionGridNo, zLevel, selection };
  if (s.gridNo === actionGridNo) {
    pickPickupAnimation(t, s, g, zLevel);
    return true;
  }
  if (getNewSoldierPath(t, s, actionGridNo, s.uiMovementMode, s.team === Team.OUR ? 1 : 0, true)) return true;
  s.pendingPickup = null;
  return false;
}

export function handlePendingPickupOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingPickup;
  if (!pending) return false;
  if (pending.actionGridNo !== s.gridNo) {
    s.pendingPickup = null;
    soldierGotoStationaryStance(t, s);
    return true;
  }
  if (!t.inCombat && pending.actionGridNo !== pending.gridNo && newOKDestination(t.pathEnv, s, pending.gridNo, true, s.level))
    return soldierPickupItem(t, s, pending.gridNo, pending.zLevel, pending.selection);
  pickPickupAnimation(t, s, pending.gridNo, pending.zLevel);
  return true;
}

function pickPickupAnimation(t: TacticalState, s: Soldier, g: number, zLevel: number): void {
  if (g !== s.gridNo) {
    s.pendingDirection = directionToward(s.gridNo, g);
    initNewSoldierAnim(t, s, anim(t.content, 'ADJACENT_GET_ITEM'), 0, false);
    if (s.team !== Team.OUR) s.ai.action = AiAction.PENDING_ACTION;
    return;
  }
  if (isWater(t.pathWorld, s.gridNo) || height(t.content, s.state) !== AnimHeight.STAND) {
    handleSoldierPickupItem(t, s);
    soldierGotoStationaryStance(t, s);
    if (s.team !== Team.OUR) t.turnHooks.actionDone(t, s);
    return;
  }
  initNewSoldierAnim(t, s, anim(t.content, zLevel > 0 ? 'ADJACENT_GET_ITEM' : 'PICKUP_ITEM'), 0, false);
  if (s.team !== Team.OUR) s.ai.action = AiAction.PENDING_ACTION;
}

function handleSoldierPickupItem(t: TacticalState, s: Soldier): void {
  const pending = s.pendingPickup;
  s.pendingPickup = null;
  if (!pending) return;
  const pool = itemsAt(t, pending.gridNo, s.level);
  if (pool.length === 0) return;
  if (s.team !== Team.OUR) {
    soldierGetItemFromWorld(t, s, pending);
    return;
  }
  const allHidden = pool.every((wi) => wi.visible === Visibility.HIDDEN_ITEM);
  if (pickupCandidates(t, s, pending.gridNo, pending.zLevel).length > 0) soldierGetItemFromWorld(t, s, pending);
  else if (allHidden && lookForHiddenItems(t, pending.gridNo, s.level))
    statChange(t, s, StatKind.WISDOM, HIDDEN_ITEM_WISDOM_GAIN, StatCause.SUCCESS);
}

function soldierGetItemFromWorld(t: TacticalState, s: Soldier, pending: PendingPickup): void {
  const ctx = soldierInventoryContext(t, s);
  const selected = pending.selection ?? pickupCandidates(t, s, pending.gridNo, pending.zLevel);
  let dontCharge = false;
  for (const wi of selected) {
    if (!t.worldItems.includes(wi) || !itemPoolOKForPickup(s, wi, pending.zLevel)) continue;
    const copy = cloneObject(wi.object);
    if (autoPlaceObject(ctx, s, copy)) {
      removeWorldItem(t, wi);
      continue;
    }
    Object.assign(wi.object, copy);
    if (s.team === Team.OUR) dontCharge = true;
  }
  if (s.team === Team.OUR && lookForHiddenItems(t, pending.gridNo, s.level))
    statChange(t, s, StatKind.WISDOM, HIDDEN_ITEM_WISDOM_GAIN, StatCause.SUCCESS);
  if (!dontCharge) deductPoints(t.inCombat, s, AP.PICKUP_ITEM, 0);
  t.events.push({ type: 'itemsPickedUp', soldier: s.id, gridNo: pending.gridNo });
}

export function soldierDropItem(t: TacticalState, s: Soldier, slot: number): void {
  const o = s.inv[slot];
  if (!o) return;
  s.tempObject = cloneObject(o);
  deleteObject(o);
  if (height(t.content, s.state) === AnimHeight.STAND) initNewSoldierAnim(t, s, anim(t.content, 'DROP_ITEM'), 0, false);
  else {
    soldierHandleDropItem(t, s);
    soldierGotoStationaryStance(t, s);
  }
}

function soldierHandleDropItem(t: TacticalState, s: Soldier): void {
  const o = s.tempObject;
  if (!o) return;
  s.tempObject = null;
  addItemToPool(t, s.gridNo, o, Visibility.VISIBLE, s.level, 0, FORCE_ON_GROUND);
  t.events.push({ type: 'itemDropped', soldier: s.id, gridNo: s.gridNo });
}

export function itemOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code === Code.DROP_ITEM) {
    soldierHandleDropItem(t, s);
    return 'continue';
  }
  if (code === Code.PICKUP_ITEM) {
    handleSoldierPickupItem(t, s);
    return 'continue';
  }
  return null;
}
