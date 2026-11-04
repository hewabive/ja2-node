// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc HandleItemPointerClick (escorts, the unconscious and swimmers in deep water
// @src click for nothing; a moving soldier under the pointer refused; the pass to a merc of ours within
// @src PASSING_ITEM_DISTANCE_OKLIFE who is no escort and no vehicle: 3 AP each checked, his line of sight to the giver at
// @src cube level 3, the 3 AP charged before AutoPlaceObject, MSG_ITEM_PASSED_TO_MERC or MSG_NO_ROOM_TO_PASS_ITEM, the
// @src catcher stopped and both turned to each other into PASS_OBJECT when standing out of water; keys off the ring passed
// @src as BeginKeyRingItemPointer takes them, 2026-11-03).

import { AnimFlags } from '../../content/anim/tables.ts';
import { NOTHING } from '../../content/items/items.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { u8 } from '../../core/int.ts';
import type { ItemObject } from '../items/object.ts';
import { anim } from './anim-states.ts';
import { AnimHeight, endHeight, hasAnimFlag, setDesiredDirection } from './animation.ts';
import { soldierTo3DLocationLos } from './combat/positions.ts';
import { oppositeDirection } from './directions.ts';
import { handleTacticalEffectsOfEquipmentChange } from './hand-item.ts';
import { autoPlaceObject, itemIn } from './inventory.ts';
import { tacticalPanelEnv } from './inventory-commands.ts';
import { cancelCursor } from './inventory-panel.ts';
import { type ItemSource, isRingSource, type PocketSource, type RingSource, returnKeysToRing, takeSourceObject } from './item-source.ts';
import { directionToward, stopMerc } from './movement.ts';
import { distanceVisible } from './perception/sight.ts';
import { mercInWater } from './person-structure.ts';
import { deductPoints, enoughPoints } from './points.ts';
import { Body, OKLIFE, type Soldier, Team } from './soldier.ts';
import { soldierInventoryContext } from './soldier-inventory.ts';
import type { TacticalState } from './state.ts';

export const DROPPING_DISTANCE = 1;
export const PASSING_ITEM_DISTANCE_OKLIFE = 3;
export const AP_PASS_ITEM = 3;
const DIRECTION_IRRELEVANT = -1;
const PASS_LOS_CUBE_LEVEL = 3;

export type PassRefusal = 'cannotPass' | 'targetMoving' | 'notACatcher' | 'tooFar' | 'notEnoughAP' | 'noLineOfSight';

export const PASS_REFUSALS: Readonly<Record<PassRefusal, string>> = {
  cannotPass: 'escorts, the unconscious and swimmers in deep water cannot pass items',
  targetMoving: 'the soldier to pass to is moving',
  notACatcher: 'only a merc of ours who is no escort and no vehicle takes a pass: toss the item instead',
  tooFar: `the merc stands more than ${PASSING_ITEM_DISTANCE_OKLIFE} tiles away: toss the item instead`,
  notEnoughAP: `not enough APs: ${AP_PASS_ITEM} needed by both mercs`,
  noLineOfSight: 'the other merc cannot see the giver',
};

export interface PassOutcome {
  readonly passed: boolean;
}

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

export function itemPointerHolderBlocked(t: TacticalState, s: Soldier): boolean {
  return t.narrative.isEpc(s) || s.life < OKLIFE || s.overTerrain === Terrain.DEEP_WATER;
}

export function takesPass(t: TacticalState, target: Soldier): boolean {
  return target.team === Team.OUR && !t.narrative.isEpc(target) && !isVehicle(target);
}

function seesGiver(t: TacticalState, catcher: Soldier, giver: Soldier): boolean {
  const range = distanceVisible(t, catcher, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, giver.gridNo, giver.level);
  return soldierTo3DLocationLos(t, catcher, giver.gridNo, giver.level, PASS_LOS_CUBE_LEVEL, u8(range), true) !== 0;
}

function passRefusal(t: TacticalState, giver: Soldier, catcher: Soldier): PassRefusal | null {
  if (itemPointerHolderBlocked(t, giver)) return 'cannotPass';
  if (hasAnimFlag(t.content, catcher.state, AnimFlags.MOVING)) return 'targetMoving';
  if (!enoughPoints(t.inCombat, giver, AP_PASS_ITEM)) return 'notEnoughAP';
  if (!takesPass(t, catcher)) return 'notACatcher';
  if (pythSpacesAway(giver.gridNo, catcher.gridNo) > PASSING_ITEM_DISTANCE_OKLIFE) return 'tooFar';
  if (!enoughPoints(t.inCombat, catcher, AP_PASS_ITEM)) return 'notEnoughAP';
  return seesGiver(t, catcher, giver) ? null : 'noLineOfSight';
}

function turnToPass(t: TacticalState, s: Soldier, direction: number): void {
  if (endHeight(t.content, s.state) !== AnimHeight.STAND || mercInWater(s)) return;
  setDesiredDirection(t, s, direction);
  s.turningUntilDone = true;
  s.pendingAnimation = anim(t.content, 'PASS_OBJECT');
}

function handOver(t: TacticalState, giver: Soldier, catcher: Soldier, o: ItemObject): boolean {
  const item = o.item;
  if (!autoPlaceObject(soldierInventoryContext(t, catcher), catcher, o)) {
    t.events.push({ type: 'passFailed', soldier: giver.id, target: catcher.id, item });
    return false;
  }
  t.events.push({ type: 'itemPassed', soldier: giver.id, target: catcher.id, item });
  const facing = directionToward(catcher.gridNo, giver.gridNo);
  stopMerc(t, catcher);
  turnToPass(t, catcher, facing);
  turnToPass(t, giver, oppositeDirection(facing));
  return true;
}

function passFromRing(t: TacticalState, giver: Soldier, catcher: Soldier, source: RingSource): boolean {
  const keys = takeSourceObject(t.content, giver, source) as ItemObject;
  const passed = handOver(t, giver, catcher, keys);
  returnKeysToRing(giver, source, keys);
  return passed;
}

function passFromPocket(t: TacticalState, giver: Soldier, catcher: Soldier, source: PocketSource): boolean {
  const item = itemIn(giver.inv, source.slot);
  const cursor = takeSourceObject(t.content, giver, source) as ItemObject;
  const passed = handOver(t, giver, catcher, cursor);
  cancelCursor(tacticalPanelEnv(t), giver, source.slot, cursor);
  handleTacticalEffectsOfEquipmentChange(t, giver, source.slot, item, itemIn(giver.inv, source.slot) === NOTHING ? NOTHING : item);
  return passed;
}

export function passItem(t: TacticalState, giver: Soldier, catcher: Soldier, source: ItemSource): PassRefusal | PassOutcome {
  const refusal = passRefusal(t, giver, catcher);
  if (refusal) return refusal;
  deductPoints(t.inCombat, catcher, AP_PASS_ITEM, 0);
  deductPoints(t.inCombat, giver, AP_PASS_ITEM, 0);
  const passed = isRingSource(source) ? passFromRing(t, giver, catcher, source) : passFromPocket(t, giver, catcher, source);
  return { passed };
}
