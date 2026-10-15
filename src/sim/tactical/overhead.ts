// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (per-soldier animation and movement pass). See docs/07 §4.3.

import { AnimFlags } from '../../content/anim/tables.ts';
import { TICK_MS } from '../clock.ts';
import { adjustToNextAnimationFrame, frameTimerDone, hasAnimFlag, states, turnSoldier } from './animation.ts';
import {
  arriveAtFinalDestination,
  handleAtNewGridNo,
  handleGotoNewGridNo,
  handleNextTileWaiting,
  moveMerc,
  pathExhausted,
  setSoldierDestination,
} from './movement.ts';
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
    if (s.finalDestination === s.gridNo) {
      arriveAtFinalDestination(t, s);
      keepMoving = false;
    } else if (!s.noAPToFinishMove) {
      s.pathIndex = Math.min(s.pathIndex + 1, s.pathSize);
      if (s.pathIndex === s.pathSize) {
        if (!pathExhausted(t, s)) return false;
      } else if (!specialMove) {
        const result = handleGotoNewGridNo(t, s, false, s.state);
        keepMoving = result.keepMoving;
        if (!result.ok) return false;
      } else {
        setSoldierDestination(t, s, s.path[s.pathIndex] ?? 0, s.state);
      }
    }
  }
  if (s.pauseAnimMove) keepMoving = false;
  if (!s.pausedMove && keepMoving) moveMerc(t, s, movementSpeed(t, s), s.movementDirection);
  return true;
}

function handleSoldierFrame(t: TacticalState, s: Soldier): boolean {
  const moving = hasAnimFlag(t.content, s.state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE);
  if (moving && s.noAPToFinishMove) return true;
  adjustToNextAnimationFrame(t, s);
  if (!hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE)) handleNextTileWaiting(t, s);
  if (hasAnimFlag(t.content, s.state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE) && !s.pauseAnimMove) {
    if (!handleMovementFrame(t, s)) return false;
  }
  if (hasAnimFlag(t.content, s.state, AnimFlags.TURNING)) turnSoldier(t, s);
  return true;
}

export interface OverheadHooks {
  readonly ai?: (t: TacticalState, s: Soldier, slot: number) => void;
  readonly afterPass?: (t: TacticalState) => void;
}

export function executeOverhead(t: TacticalState, hooks: OverheadHooks = {}): void {
  t.soldiers.forEach((s, slot) => {
    if (!s.placed) return;
    if (frameTimerDone(t, s) && !handleSoldierFrame(t, s)) return;
    hooks.ai?.(t, s, slot);
  });
  hooks.afterPass?.(t);
  t.clockMs += TICK_MS;
}
