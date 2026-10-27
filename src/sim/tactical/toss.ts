// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc HandleItemPointerClick (the toss branch: escorts, the unconscious and swimmers
// @src cannot toss, the AP_TOSS_ITEM check, a moving target refused, a merc of ours beyond passing range set up to catch
// @src with the end height of his stance and turned to face the thrower, the bad chance to get through refused, the
// @src thrower turned without the turning cost, the attack busy count, CalculateLaunchItemParamsForThrow,
// @src HandleSoldierThrowItem), SoldierCanSeeCatchComing (always TRUE), HandleItemCursor (the throw end height).

import { AnimFlags } from '../../content/anim/tables.ts';
import { NOTHING } from '../../content/items/items.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { cloneObject, type ItemObject } from '../items/object.ts';
import { AnimHeight, hasAnimFlag, height, setDesiredDirection, soldierGotoStationaryStance } from './animation.ts';
import { HEIGHT_UNITS } from './explosions/physics.ts';
import { ThrowAction } from './explosions/state.ts';
import { handleSoldierThrowItem } from './explosions/throwing.ts';
import { calculateLaunchItemChanceToGetThrough, calculateLaunchItemParamsForThrow } from './explosions/trajectory.ts';
import { handleTacticalEffectsOfEquipmentChange } from './hand-item.ts';
import { itemIn } from './inventory.ts';
import { type Count, takeObjects } from './inventory-panel.ts';
import { directionToward } from './movement.ts';
import { enoughPoints } from './points.ts';
import { Body, OKLIFE, type Soldier, Team } from './soldier.ts';
import { type TacticalState, whoIsThere } from './state.ts';

export const AP_TOSS_ITEM = 8;
const PASSING_ITEM_DISTANCE_OKLIFE = 3;
const DROPPING_DISTANCE = 1;
const CATCH_HEIGHT: Readonly<Record<number, number>> = { [AnimHeight.STAND]: 150, [AnimHeight.CROUCH]: 80, [AnimHeight.PRONE]: 10 };

export type TossRefusal = 'cannotToss' | 'tooClose' | 'passInstead' | 'targetMoving' | 'notEnoughAP' | 'badThrow';

export const TOSS_REFUSALS: Readonly<Record<TossRefusal, string>> = {
  cannotToss: 'escorts, the unconscious and swimmers in deep water cannot toss',
  tooClose: 'the tile is next to the merc: drop the item instead',
  passInstead: 'the merc stands within 3 tiles: give the item instead',
  targetMoving: 'the soldier on that tile is moving',
  notEnoughAP: `not enough APs: ${AP_TOSS_ITEM} needed`,
  badThrow: 'the item cannot get there',
};

export interface Toss {
  readonly slot: number;
  readonly count: Count;
  readonly index: number;
  readonly gridNo: number;
  readonly level: number;
}

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

function catcherAt(t: TacticalState, thrower: Soldier, toss: Toss): Soldier | null {
  const target = whoIsThere(t, toss.gridNo, toss.level);
  if (!target || target === thrower || target.team !== Team.OUR || target.life < OKLIFE) return null;
  return t.narrative.isEpc(target) || isVehicle(target) ? null : target;
}

function throwEndZ(t: TacticalState, catcher: Soldier | null): number {
  if (!catcher || catcher.level > 0) return 0;
  return CATCH_HEIGHT[height(t.content, catcher.state)] ?? 0;
}

function tosserRefusal(t: TacticalState, s: Soldier, toss: Toss): TossRefusal | null {
  if (t.narrative.isEpc(s) || s.life < OKLIFE || s.overTerrain === Terrain.DEEP_WATER) return 'cannotToss';
  const target = whoIsThere(t, toss.gridNo, toss.level);
  if (target && hasAnimFlag(t.content, target.state, AnimFlags.MOVING)) return 'targetMoving';
  if (!enoughPoints(t.inCombat, s, AP_TOSS_ITEM)) return 'notEnoughAP';
  const distance = pythSpacesAway(s.gridNo, toss.gridNo);
  if (catcherAt(t, s, toss) && distance <= PASSING_ITEM_DISTANCE_OKLIFE) return 'passInstead';
  if ((!target || target === s) && distance <= DROPPING_DISTANCE) return 'tooClose';
  return null;
}

function tossedPreview(s: Soldier, toss: Toss): ItemObject {
  const preview = cloneObject(s.inv[toss.slot] as ItemObject);
  return takeObjects(preview, toss.count, toss.index) ?? preview;
}

function faceThrower(t: TacticalState, catcher: Soldier, thrower: Soldier): void {
  soldierGotoStationaryStance(t, catcher);
  setDesiredDirection(t, catcher, directionToward(catcher.gridNo, thrower.gridNo));
}

export function tossItem(t: TacticalState, s: Soldier, toss: Toss): TossRefusal | null {
  const refusal = tosserRefusal(t, s, toss);
  if (refusal) return refusal;
  const catcher = catcherAt(t, s, toss);
  const endZ = toss.level * HEIGHT_UNITS + throwEndZ(t, catcher);
  if (!calculateLaunchItemChanceToGetThrough(t, s, tossedPreview(s, toss), toss.gridNo, toss.level, endZ, false, true).ok)
    return 'badThrow';
  const item = itemIn(s.inv, toss.slot);
  const tossed = takeObjects(s.inv[toss.slot] as ItemObject, toss.count, toss.index) as ItemObject;
  handleTacticalEffectsOfEquipmentChange(t, s, toss.slot, item, itemIn(s.inv, toss.slot) === NOTHING ? NOTHING : item);
  if (catcher) faceThrower(t, catcher, s);
  s.dontChargeTurningAPs = true;
  setDesiredDirection(t, s, directionToward(s.gridNo, toss.gridNo));
  s.turningUntilDone = true;
  t.turn.attackBusyCount++;
  const action = catcher ? ThrowAction.TARGET_MERC_CATCH : ThrowAction.NONE;
  calculateLaunchItemParamsForThrow(t, s, toss.gridNo, toss.level, endZ, tossed, 0, action, catcher);
  handleSoldierThrowItem(t, s, toss.gridNo);
  return null;
}
