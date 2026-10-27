// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Physics.cc CheckForCatchObject (the catch animation within 4 tiles, decided at the first
// @src look), AttemptToCatchObject (PreRandom(100) against 50 + dexterity / 2 within one tile), DoCatchObject (the end
// @src of the catch animation, CATCH_OBJECT, AutoPlaceObject and MSG_MERC_CAUGHT_ITEM), CheckForCatcher, the catch
// @src animation ended at the end of an object's life (PhysicsUpdateLife).

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { u8 } from '../../../core/int.ts';
import { anim, animName } from '../anim-states.ts';
import { AnimHeight, height, initNewSoldierAnim } from '../animation.ts';
import { autoPlaceObject } from '../inventory.ts';
import { effectiveDexterity } from '../skills.ts';
import { NO_PENDING_ANIMATION, type Soldier } from '../soldier.ts';
import { soldierInventoryContext } from '../soldier-inventory.ts';
import type { TacticalState } from '../state.ts';
import { type RealObject, TestObject, ThrowAction } from './state.ts';

const CATCH_ANIMATION_RANGE = 4;
const CATCH_RANGE = 1;
const BASE_CHANCE_TO_CATCH = 50;
const MAX_NUM_SOLDIERS = 148;
const READY_TO_CATCH: ReadonlySet<string> = new Set(['CATCH_STANDING', 'CATCH_CROUCHED', 'LOWER_RIFLE']);

function catchable(o: RealObject): boolean {
  return o.testObject === TestObject.NONE && o.action === ThrowAction.TARGET_MERC_CATCH && o.target !== null;
}

function raiseHands(t: TacticalState, catcher: Soldier, o: RealObject): void {
  if (READY_TO_CATCH.has(animName(t.content, catcher.state))) return;
  const stance = height(t.content, catcher.state);
  if (stance === AnimHeight.STAND) initNewSoldierAnim(t, catcher, anim(t.content, 'CATCH_STANDING'), 0, false);
  else if (stance === AnimHeight.CROUCH) initNewSoldierAnim(t, catcher, anim(t.content, 'CATCH_CROUCHED'), 0, false);
  o.catchAnimOn = true;
}

function attemptToCatchObject(t: TacticalState, catcher: Soldier, o: RealObject): boolean {
  const chance = u8(BASE_CHANCE_TO_CATCH + Math.trunc(effectiveDexterity(catcher) / 2));
  o.catchCheckDone = true;
  if (t.pre.int(100) > chance) return false;
  o.catchGood = true;
  return true;
}

export function checkForCatchObject(t: TacticalState, o: RealObject): boolean {
  const catcher = o.target;
  if (!catchable(o) || !catcher) return false;
  const spaces = pythSpacesAway(o.gridNo, catcher.gridNo);
  if (spaces < CATCH_ANIMATION_RANGE && !o.attemptedCatch) raiseHands(t, catcher, o);
  o.attemptedCatch = true;
  return spaces <= CATCH_RANGE && !o.catchCheckDone && attemptToCatchObject(t, catcher, o);
}

function lowerHands(t: TacticalState, catcher: Soldier): void {
  const stance = height(t.content, catcher.state);
  if (stance !== AnimHeight.STAND && stance !== AnimHeight.CROUCH) return;
  catcher.pendingAnimation = NO_PENDING_ANIMATION;
  initNewSoldierAnim(t, catcher, anim(t.content, stance === AnimHeight.STAND ? 'END_CATCH' : 'END_CROUCH_CATCH'), 0, false);
}

function doCatchObject(t: TacticalState, catcher: Soldier, o: RealObject): boolean {
  lowerHands(t, catcher);
  t.events.push({ type: 'catchEnded', soldier: catcher.id });
  o.catchAnimOn = false;
  if (!o.catchGood) return false;
  const item = o.object.item;
  if (autoPlaceObject(soldierInventoryContext(t, catcher), catcher, o.object)) {
    o.dropItem = false;
    t.events.push({ type: 'itemCaught', soldier: catcher.id, item });
  }
  return true;
}

export function checkForCatcher(t: TacticalState, o: RealObject, structureId: number): boolean {
  if (!catchable(o) || structureId >= MAX_NUM_SOLDIERS) return false;
  const catcher = o.target;
  if (!catcher || t.soldiers[structureId] !== catcher || !doCatchObject(t, catcher, o)) return false;
  o.alive = false;
  return true;
}

export function endCatchAnimation(t: TacticalState, o: RealObject): void {
  const catcher = o.target;
  if (!o.catchAnimOn || !catcher) return;
  o.catchAnimOn = false;
  lowerHands(t, catcher);
  t.events.push({ type: 'catchEnded', soldier: catcher.id });
}
