// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc HandleItemPointerClick (the robot branch: the APs, the temp object, the walk),
// @src IsValidAmmoToReloadRobot, CompatibleAmmoForGun; Points.cc GetAPsToReloadRobot; Soldier_Control.cc
// @src EVENT_SoldierBeginReloadRobot; externalized/Soldier.cc handlePendingAction (MERC_RELOADROBOT); Soldier_Ani.cc
// @src code 756.

import type { OpOutcome } from '../../content/anim/script.ts';
import { NOTHING } from '../../content/items/items.ts';
import { cloneObject, type ItemObject, removeObjects } from '../items/object.ts';
import { anim } from './anim-states.ts';
import { faceAtOnce, initNewSoldierAnim } from './animation.ts';
import { findAdjacentGridEx } from './combat/melee-reach.ts';
import { apsToMovePlusAction } from './give.ts';
import { autoPlaceObject, InvSlot, itemIn, reloadGun } from './inventory.ts';
import { compatibleAmmoForGun } from './item-compatibility.ts';
import { getNewSoldierPath } from './movement.ts';
import { enoughPoints } from './points.ts';
import { Body, type Soldier } from './soldier.ts';
import { soldierInventoryContext } from './soldier-inventory.ts';
import { type TacticalState, whoIsThere } from './state.ts';
import { addItemToPool, FORCE_ON_GROUND, Visibility } from './world-items.ts';

const RELOAD_ROBOT_CODE = 756;
const AP_RELOAD_ROBOT = 4;
const NO_FLAGS = 0;

export type RobotReloadRefusal = 'noPath' | 'notEnoughAP' | 'robotNeedsCalibre';

const isRobot = (s: Soldier): boolean => s.bodyType === Body.ROBOTNOWEAPON;

export function apsToReloadRobot(t: TacticalState, s: Soldier, robot: Soldier): number {
  const approach = findAdjacentGridEx(t, s, robot.gridNo, true);
  return approach ? apsToMovePlusAction(t, s, approach.actionGridNo, AP_RELOAD_ROBOT) : 0;
}

export function validAmmoToReloadRobot(t: TacticalState, robot: Soldier, ammo: ItemObject): boolean {
  return compatibleAmmoForGun(t.content.items, ammo.item, itemIn(robot.inv, InvSlot.HAND));
}

export function robotGunCalibre(t: TacticalState, robot: Soldier): number | null {
  return t.content.items.byIndex.get(itemIn(robot.inv, InvSlot.HAND))?.weapon?.calibre ?? null;
}

export function robotReloadRefusal(t: TacticalState, s: Soldier, robot: Soldier, ammo: ItemObject): RobotReloadRefusal | null {
  const aps = apsToReloadRobot(t, s, robot);
  if (aps === 0) return 'noPath';
  if (!enoughPoints(t.inCombat, s, aps)) return 'notEnoughAP';
  if (!validAmmoToReloadRobot(t, robot, ammo)) return 'robotNeedsCalibre';
  return null;
}

function returnAmmoToPockets(t: TacticalState, s: Soldier): void {
  const ammo = s.tempObject;
  s.tempObject = null;
  if (!ammo || autoPlaceObject(soldierInventoryContext(t, s), s, ammo)) return;
  addItemToPool(t, s.gridNo, ammo, Visibility.VISIBLE, s.level, NO_FLAGS, FORCE_ON_GROUND);
}

export function cancelPendingRobotReload(t: TacticalState, s: Soldier): void {
  if (!s.pendingRobotReload) return;
  s.pendingRobotReload = null;
  returnAmmoToPockets(t, s);
}

function robotAt(t: TacticalState, s: Soldier, gridNo: number): Soldier | null {
  const there = whoIsThere(t, gridNo, s.level);
  return there && isRobot(there) ? there : null;
}

function beginReloadRobot(t: TacticalState, s: Soldier, gridNo: number, direction: number): boolean {
  if (!robotAt(t, s, gridNo) || !s.tempObject) {
    returnAmmoToPockets(t, s);
    return false;
  }
  faceAtOnce(s, direction);
  initNewSoldierAnim(t, s, anim(t.content, 'RELOAD_ROBOT'), 0, false);
  return true;
}

export function soldierReloadRobot(t: TacticalState, s: Soldier, robot: Soldier, ammo: ItemObject, slot: number): number | null {
  const approach = findAdjacentGridEx(t, s, robot.gridNo, true);
  const source = s.inv[slot];
  if (!approach || !source) return null;
  s.tempObject = cloneObject(ammo);
  removeObjects(source, 1);
  s.pendingActionData2 = approach.targetGridNo;
  if (s.gridNo === approach.actionGridNo) beginReloadRobot(t, s, approach.targetGridNo, approach.direction);
  else {
    s.pendingRobotReload = { targetGridNo: approach.targetGridNo, direction: approach.direction };
    if (!getNewSoldierPath(t, s, approach.actionGridNo, s.uiMovementMode, 0, false)) cancelPendingRobotReload(t, s);
  }
  return approach.actionGridNo;
}

export function handlePendingRobotReloadOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingRobotReload;
  if (!pending) return false;
  s.pendingRobotReload = null;
  return beginReloadRobot(t, s, pending.targetGridNo, pending.direction);
}

function reloadRobotFromAnimation(t: TacticalState, s: Soldier): void {
  const robot = robotAt(t, s, s.pendingActionData2);
  const ammo = s.tempObject;
  if (!robot || !ammo) {
    returnAmmoToPockets(t, s);
    return;
  }
  reloadGun(soldierInventoryContext(t, robot), robot, robot.inv[InvSlot.HAND] as ItemObject, ammo);
  if (ammo.item !== NOTHING) autoPlaceObject(soldierInventoryContext(t, s), s, ammo);
  s.tempObject = null;
}

export function robotReloadOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== RELOAD_ROBOT_CODE) return null;
  reloadRobotFromAnimation(t, s);
  return 'continue';
}
