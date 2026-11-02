// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc IsCrowWithShadow, HandleCrowShadowVisibility, HandleCrowShadowNewGridNo,
// @src HandleCrowShadowRemoveGridNo, HandleCrowShadowNewDirection, HandleCrowShadowNewPosition, EVENT_InitNewSoldierAnim
// @src (CROW_FLY, CROW_EAT and CROW_DIE, switched on before the new state is set); src/game/Tactical/Overhead.cc
// @src ExecuteOverhead (the shadow's visibility from the render visibility before the change);
// @src src/game/TileEngine/Tile_Animation.cc SetFrameByDir, UpdateAniTiles (ANITILE_USE_DIRECTION_FOR_START_FRAME, looping).

import type { SoldierView } from '../../protocol/view.ts';

const CROW_BODY = 19;
const DIRECTIONS = 8;
const MIN_FRAME_DELAY_MS = 1;

export interface CrowShadow {
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly frame: number;
}

interface ShadowTile {
  frame: number | null;
  lastStepMs: number;
  readonly delayMs: number;
}

interface TrackedCrow {
  gridNo: number;
  shadow: ShadowTile | null;
}

function firstFrameOf(direction: number, framesPerDirection: number): number {
  return framesPerDirection * ((direction + 1) % DIRECTIONS);
}

export function nextShadowFrame(frame: number, direction: number, framesPerDirection: number): number {
  const first = firstFrameOf(direction, framesPerDirection);
  return frame + 1 < first + framesPerDirection ? frame + 1 : first;
}

function stepsToApply(steps: number, framesPerDirection: number): number {
  const settled = DIRECTIONS * framesPerDirection;
  return steps <= settled ? steps : settled + ((steps - settled) % framesPerDirection);
}

export class CrowShadows {
  readonly #flyState: number;
  readonly #crows = new Map<number, TrackedCrow>();

  constructor(flyState: number) {
    this.#flyState = flyState;
  }

  update(soldiers: readonly SoldierView[], clockMs: number, framesPerDirection: () => number | null): CrowShadow[] {
    const shown = new Set<number>();
    const out: CrowShadow[] = [];
    for (const s of soldiers) {
      if (s.bodyType !== CROW_BODY) continue;
      shown.add(s.id);
      const shadow = this.#follow(s, clockMs);
      const frames = shadow ? framesPerDirection() : null;
      if (!shadow || frames === null || frames <= 0) continue;
      out.push({ gridNo: s.gridNo, x: Math.trunc(s.x), y: Math.trunc(s.y), frame: this.#animate(shadow, s.direction, clockMs, frames) });
    }
    for (const id of [...this.#crows.keys()]) if (!shown.has(id)) this.#crows.delete(id);
    return out;
  }

  #follow(s: SoldierView, clockMs: number): ShadowTile | null {
    const crow = this.#crows.get(s.id);
    if (!crow) {
      this.#crows.set(s.id, { gridNo: s.gridNo, shadow: null });
      return null;
    }
    if (s.animation !== this.#flyState) crow.shadow = null;
    else if (s.gridNo !== crow.gridNo)
      crow.shadow = { frame: null, lastStepMs: clockMs, delayMs: Math.max(MIN_FRAME_DELAY_MS, s.frameDelay) };
    crow.gridNo = s.gridNo;
    return crow.shadow;
  }

  #animate(shadow: ShadowTile, direction: number, clockMs: number, framesPerDirection: number): number {
    let frame = shadow.frame ?? firstFrameOf(direction, framesPerDirection);
    const steps = Math.max(0, Math.floor((clockMs - shadow.lastStepMs) / shadow.delayMs));
    shadow.lastStepMs += steps * shadow.delayMs;
    for (let i = stepsToApply(steps, framesPerDirection); i > 0; i--) frame = nextShadowFrame(frame, direction, framesPerDirection);
    shadow.frame = frame;
    return frame;
  }
}
