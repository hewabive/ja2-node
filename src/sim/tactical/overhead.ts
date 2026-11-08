// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (per-soldier animation and movement pass, the two BoxingMovementCheck calls,
// @src the fade before the animation update, the SOLDIER_LOOKFOR_ITEMS look at the frame, the HandleBloodForNewGridNo
// @src of a tile's middle, 2026-11-04), CencelAllActionsForTimeCompression (the helicopter's passengers over the loaded
// @src sector included, 2026-11-08);
// @src Strategic/Game_Clock.cc ClearTacticalStuffDueToTimeCompression (the tactical message queue is the browser's).

import { AnimFlags } from '../../content/anim/tables.ts';
import { TICK_MS } from '../clock.ts';
import { adjustToNextAnimationFrame, frameTimerDone, hasAnimFlag, states, turnSoldier } from './animation.ts';
import { handleBloodForNewGridNo } from './combat/bleeding.ts';
import { updateDamageDisplay } from './combat/hit.ts';
import { updateSoldierFade } from './fade.ts';
import { clearEventQueue } from './game-events.ts';
import {
  arriveAtFinalDestination,
  handleAtNewGridNo,
  handleGotoNewGridNo,
  handleNextTileWaiting,
  moveMerc,
  pathExhausted,
  setSoldierDestination,
  stopMerc,
} from './movement.ts';
import { boxingMovementCheckWhileTracked } from './narrative/boxing.ts';
import { revealRoofsAndItems } from './perception/fov.ts';
import { inSector, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

function movementSpeed(t: TacticalState, s: Soldier): number {
  const tables = t.content.animations;
  if (s.state === states(tables).WALKING) return Math.fround(tables.bodySpeeds.walk[s.bodyType]?.movement ?? 0);
  return Math.fround(tables.controls[s.state]?.movement ?? 0);
}

function handleMovementFrame(t: TacticalState, s: Soldier): boolean {
  const specialMove = hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE);
  let keepMoving = true;
  s.pausedMove = false;
  if (s.pastX && s.pastY) {
    s.pastX = false;
    s.pastY = false;
    handleBloodForNewGridNo(t, s);
    if (!specialMove || s.gridNo === s.finalDestination) keepMoving = handleAtNewGridNo(t, s) && keepMoving;
    boxingMovementCheckWhileTracked(t, s);
    if (s.finalDestination === s.gridNo) {
      arriveAtFinalDestination(t, s);
      keepMoving = false;
    } else if (!s.noAPToFinishMove) {
      s.pathIndex = Math.min(s.pathIndex + 1, s.pathSize);
      if (s.pathIndex === s.pathSize) {
        if (!pathExhausted(t, s)) return false;
      } else {
        if (!specialMove) {
          const result = handleGotoNewGridNo(t, s, false, s.state);
          keepMoving = result.keepMoving;
          if (!result.ok) return false;
        } else setSoldierDestination(t, s, s.path[s.pathIndex] ?? 0, s.state);
        boxingMovementCheckWhileTracked(t, s);
      }
    }
  }
  if (s.pauseAnimMove) keepMoving = false;
  if (!s.pausedMove && keepMoving) moveMerc(t, s, movementSpeed(t, s), s.movementDirection);
  return true;
}

function lookForItemsIfNotified(t: TacticalState, s: Soldier): void {
  if (!s.lookForItems) return;
  revealRoofsAndItems(t, s, false);
  s.lookForItems = false;
}

function handleSoldierFrame(t: TacticalState, s: Soldier): boolean {
  lookForItemsIfNotified(t, s);
  const moving = hasAnimFlag(t.content, s.state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE);
  if ((moving && s.noAPToFinishMove) || s.pauseAllAnimation) return true;
  adjustToNextAnimationFrame(t, s);
  if (!inSector(s)) return false;
  if (!hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE)) handleNextTileWaiting(t, s);
  if (hasAnimFlag(t.content, s.state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE) && !s.pauseAnimMove) {
    if (!handleMovementFrame(t, s)) return false;
  }
  if (hasAnimFlag(t.content, s.state, AnimFlags.TURNING)) turnSoldier(t, s);
  return true;
}

export interface OverheadHooks {
  readonly beforePass?: (t: TacticalState) => void;
  readonly ai?: (t: TacticalState, s: Soldier, slot: number) => void;
  readonly afterPass?: (t: TacticalState) => void;
}

function handleSlot(t: TacticalState, s: Soldier, slot: number, hooks: OverheadHooks): void {
  if (!inSector(s)) return;
  updateDamageDisplay(t, s);
  updateSoldierFade(t, s);
  if (frameTimerDone(t, s) && !handleSoldierFrame(t, s)) return;
  hooks.ai?.(t, s, slot);
}

export function executeOverhead(t: TacticalState, hooks: OverheadHooks = {}): void {
  hooks.beforePass?.(t);
  for (let slot = 0; slot < t.mercSlots.length; slot++) handleSlot(t, t.mercSlots[slot] as Soldier, slot, hooks);
  hooks.afterPass?.(t);
  t.clockMs += TICK_MS;
}

function cancelAllActionsForTimeCompression(t: TacticalState): void {
  for (const s of t.soldiers) {
    if (!s || !inSector(s)) continue;
    stopMerc(t, s);
    t.turnHooks.cancelAIAction(t, s);
  }
}

export function clearTacticalStuffDueToTimeCompression(t: TacticalState): void {
  clearEventQueue(t);
  cancelAllActionsForTimeCompression(t);
}
