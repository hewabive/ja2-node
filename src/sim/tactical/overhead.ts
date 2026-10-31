// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (per-soldier animation and movement pass, the two BoxingMovementCheck calls,
// @src the fade before the animation update, the SOLDIER_LOOKFOR_ITEMS look at the frame).

import { AnimFlags } from '../../content/anim/tables.ts';
import { TICK_MS } from '../clock.ts';
import { adjustToNextAnimationFrame, frameTimerDone, hasAnimFlag, states, turnSoldier } from './animation.ts';
import { updateDamageDisplay } from './combat/hit.ts';
import { updateSoldierFade } from './fade.ts';
import {
  arriveAtFinalDestination,
  handleAtNewGridNo,
  handleGotoNewGridNo,
  handleNextTileWaiting,
  moveMerc,
  pathExhausted,
  setSoldierDestination,
} from './movement.ts';
import { boxingMovementCheckWhileTracked } from './narrative/boxing.ts';
import { revealRoofsAndItems } from './perception/fov.ts';
import type { Soldier } from './soldier.ts';
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

export function executeOverhead(t: TacticalState, hooks: OverheadHooks = {}): void {
  hooks.beforePass?.(t);
  t.mercSlots.forEach((s, slot) => {
    if (!s || !(s.placed || s.offMap)) return;
    updateDamageDisplay(t, s);
    updateSoldierFade(t, s);
    if (frameTimerDone(t, s) && !handleSoldierFrame(t, s)) return;
    hooks.ai?.(t, s, slot);
  });
  hooks.afterPass?.(t);
  t.clockMs += TICK_MS;
}
