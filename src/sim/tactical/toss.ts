// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc HandleItemPointerClick (the toss branch: escorts, the unconscious and swimmers
// @src cannot toss, the AP_TOSS_ITEM check, a moving target refused, a merc of ours beyond passing range set up to catch
// @src with the end height of his stance and turned to face the thrower, the bad chance to get through refused, the
// @src thrower turned without the turning cost, the attack busy count, CalculateLaunchItemParamsForThrow,
// @src HandleSoldierThrowItem), SoldierCanSeeCatchComing (always TRUE), HandleItemCursor (the throw end height);
// @src DrawItemTileCursor (CalculateLaunchItemChanceToGetThrough for the landing tile, 2026-11-03); a merc of ours within
// @src passing range takes a pass whatever his life (2026-11-03); BeginKeyRingItemPointer (keys off the ring tossed,
// @src 2026-11-03).

import { AnimFlags } from '../../content/anim/tables.ts';
import { NOTHING } from '../../content/items/items.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import { emptyObject, type ItemObject } from '../items/object.ts';
import { AnimHeight, hasAnimFlag, height, setDesiredDirection, soldierGotoStationaryStance } from './animation.ts';
import { HEIGHT_UNITS } from './explosions/physics.ts';
import { ThrowAction } from './explosions/state.ts';
import { handleSoldierThrowItem } from './explosions/throwing.ts';
import {
  calculateLaunchItemChanceToGetThrough,
  calculateLaunchItemParamsForThrow,
  type LandingPrediction,
} from './explosions/trajectory.ts';
import { handleTacticalEffectsOfEquipmentChange } from './hand-item.ts';
import { itemIn } from './inventory.ts';
import { DROPPING_DISTANCE, itemPointerHolderBlocked, PASSING_ITEM_DISTANCE_OKLIFE, takesPass } from './item-pointer.ts';
import { type ItemSource, isRingSource, sourceObject, takeSourceObject } from './item-source.ts';
import { directionToward } from './movement.ts';
import { enoughPoints } from './points.ts';
import { OKLIFE, type Soldier } from './soldier.ts';
import { type TacticalState, whoIsThere } from './state.ts';

export const AP_TOSS_ITEM = 8;
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
  readonly source: ItemSource;
  readonly gridNo: number;
  readonly level: number;
}

function catcherAt(t: TacticalState, thrower: Soldier, toss: Toss): Soldier | null {
  const target = whoIsThere(t, toss.gridNo, toss.level);
  if (!target || target === thrower || target.life < OKLIFE) return null;
  return takesPass(t, target) ? target : null;
}

function throwEndZ(t: TacticalState, catcher: Soldier | null): number {
  if (!catcher || catcher.level > 0) return 0;
  return CATCH_HEIGHT[height(t.content, catcher.state)] ?? 0;
}

function passesInstead(t: TacticalState, s: Soldier, target: Soldier | null, distance: number): boolean {
  return target !== null && target !== s && takesPass(t, target) && distance <= PASSING_ITEM_DISTANCE_OKLIFE;
}

function placementRefusal(t: TacticalState, s: Soldier, toss: Toss): TossRefusal | null {
  if (itemPointerHolderBlocked(t, s)) return 'cannotToss';
  const target = whoIsThere(t, toss.gridNo, toss.level);
  if (target && hasAnimFlag(t.content, target.state, AnimFlags.MOVING)) return 'targetMoving';
  return null;
}

function targetRefusal(t: TacticalState, s: Soldier, toss: Toss): TossRefusal | null {
  const target = whoIsThere(t, toss.gridNo, toss.level);
  const distance = pythSpacesAway(s.gridNo, toss.gridNo);
  if (passesInstead(t, s, target, distance)) return 'passInstead';
  if ((!target || target === s) && distance <= DROPPING_DISTANCE) return 'tooClose';
  return null;
}

function tosserRefusal(t: TacticalState, s: Soldier, toss: Toss): TossRefusal | null {
  const refusal = placementRefusal(t, s, toss);
  if (refusal) return refusal;
  if (!enoughPoints(t.inCombat, s, AP_TOSS_ITEM)) return 'notEnoughAP';
  return targetRefusal(t, s, toss);
}

function tossedPreview(t: TacticalState, s: Soldier, toss: Toss): ItemObject {
  return sourceObject(t.content, s, toss.source) ?? emptyObject();
}

function tossEndZ(t: TacticalState, s: Soldier, toss: Toss): { catcher: Soldier | null; endZ: number } {
  const catcher = catcherAt(t, s, toss);
  return { catcher, endZ: toss.level * HEIGHT_UNITS + throwEndZ(t, catcher) };
}

function tossLanding(t: TacticalState, s: Soldier, toss: Toss, endZ: number): LandingPrediction {
  return calculateLaunchItemChanceToGetThrough(t, s, tossedPreview(t, s, toss), toss.gridNo, toss.level, endZ, false, true);
}

export interface TossPreview {
  readonly refusal: TossRefusal | null;
  readonly landing: LandingPrediction;
}

export function previewToss(t: TacticalState, s: Soldier, toss: Toss): TossPreview {
  const landing = tossLanding(t, s, toss, tossEndZ(t, s, toss).endZ);
  const refusal = placementRefusal(t, s, toss) ?? targetRefusal(t, s, toss) ?? (landing.ok ? null : 'badThrow');
  return { refusal, landing };
}

function faceThrower(t: TacticalState, catcher: Soldier, thrower: Soldier): void {
  soldierGotoStationaryStance(t, catcher);
  setDesiredDirection(t, catcher, directionToward(catcher.gridNo, thrower.gridNo));
}

function takeTossed(t: TacticalState, s: Soldier, source: ItemSource): ItemObject {
  if (isRingSource(source)) return takeSourceObject(t.content, s, source) as ItemObject;
  const item = itemIn(s.inv, source.slot);
  const tossed = takeSourceObject(t.content, s, source) as ItemObject;
  handleTacticalEffectsOfEquipmentChange(t, s, source.slot, item, itemIn(s.inv, source.slot) === NOTHING ? NOTHING : item);
  return tossed;
}

export function tossItem(t: TacticalState, s: Soldier, toss: Toss): TossRefusal | null {
  const refusal = tosserRefusal(t, s, toss);
  if (refusal) return refusal;
  const { catcher, endZ } = tossEndZ(t, s, toss);
  if (!tossLanding(t, s, toss, endZ).ok) return 'badThrow';
  const tossed = takeTossed(t, s, toss.source);
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
