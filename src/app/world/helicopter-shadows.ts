// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Entering.cc HandleHeliDrop HELI_SHOW_HELI (heli_sh.sti on the shadow layer at the sweet
// @src spot, ANITILE_FORWARD | ANITILE_LOOPING from frame 0 every sDelay 90 ms), HELI_MOVELARGERY (the steps
// @src REPEAT_HELI_MOVEAWAY repeats on a wide screen before HELI_GOTO_EXIT deletes the shadow, ahead of the next round's
// @src SHOW_HELI);
// @src src/game/TileEngine/Tile_Animation.cc UpdateAniTiles (the next frame once the delay has passed, the first again
// @src after the last); Tile_Cache.cc AddCachedTile (the frame count from the first picture's aux data).

import type { HelicopterDropView, HelicopterShadowView } from '../../protocol/view.ts';
import { HELI_SCRIPT_STEP_MS, MOVELARGERY_STEP } from '../../sim/tactical/helicopter-drop.ts';

const FRAME_DELAY_MS = 90;
const NO_SHADOWS: readonly HelicopterShadowView[] = [];

export interface HelicopterShadowFrame extends HelicopterShadowView {
  readonly frame: number;
}

export type ShadowOnScreen = (shadow: HelicopterShadowFrame) => boolean;

interface ShadowTile {
  frame: number;
  lastStepMs: number;
}

interface LeavingShadow {
  readonly from: HelicopterShadowView;
  readonly droppedAtMs: number;
  readonly tile: ShadowTile;
}

function newTile(clockMs: number): ShadowTile {
  return { frame: 0, lastStepMs: clockMs };
}

function animate(tile: ShadowTile, clockMs: number, frameCount: number): number {
  const steps = Math.max(0, Math.floor((clockMs - tile.lastStepMs) / FRAME_DELAY_MS));
  tile.lastStepMs += steps * FRAME_DELAY_MS;
  tile.frame = (tile.frame + steps) % frameCount;
  return tile.frame;
}

function sameShadow(a: HelicopterShadowView, b: HelicopterShadowView | undefined): boolean {
  return b !== undefined && a.gridNo === b.gridNo && a.x === b.x && a.y === b.y && a.z === b.z;
}

function oneShadowMore(fewer: readonly HelicopterShadowView[], more: readonly HelicopterShadowView[]): boolean {
  return more.length === fewer.length + 1 && fewer.every((s, k) => sameShadow(s, more[k]));
}

function droppedAtTheExit(before: readonly HelicopterShadowView[], now: readonly HelicopterShadowView[]): HelicopterShadowView | null {
  return oneShadowMore(now, before) ? (before.at(-1) ?? null) : null;
}

function shownAtMoveTo(before: readonly HelicopterShadowView[], now: readonly HelicopterShadowView[]): boolean {
  return oneShadowMore(before, now);
}

function stepsFlownOn(leaving: LeavingShadow, clockMs: number): number {
  return 1 + Math.max(0, Math.floor((clockMs - leaving.droppedAtMs) / HELI_SCRIPT_STEP_MS));
}

export class HelicopterShadows {
  readonly #tiles: ShadowTile[] = [];
  #runShadows: readonly HelicopterShadowView[] = NO_SHADOWS;
  #leaving: LeavingShadow | null = null;

  update(drop: HelicopterDropView | null, clockMs: number, frameCount: number | null, onScreen: ShadowOnScreen): HelicopterShadowFrame[] {
    const shadows = drop?.shadows ?? NO_SHADOWS;
    this.#followTheRun(drop, shadows, clockMs);
    this.#tiles.length = Math.min(this.#tiles.length, shadows.length);
    while (this.#tiles.length < shadows.length) this.#tiles.push(newTile(clockMs));
    if (frameCount === null || frameCount <= 0) return [];
    const shown = shadows.flatMap((s, k) => {
      const tile = this.#tiles[k];
      return tile ? [{ ...s, frame: animate(tile, clockMs, frameCount) }] : [];
    });
    const leaving = this.#leavingFrame(clockMs, frameCount, onScreen);
    return leaving ? [...shown, leaving] : shown;
  }

  reset(): void {
    this.#runShadows = NO_SHADOWS;
    this.#leaving = null;
  }

  #followTheRun(drop: HelicopterDropView | null, shadows: readonly HelicopterShadowView[], clockMs: number): void {
    if (drop?.running !== true) {
      this.reset();
      return;
    }
    const dropped = droppedAtTheExit(this.#runShadows, shadows);
    if (dropped) this.#leaving = { from: dropped, droppedAtMs: clockMs, tile: this.#tiles[shadows.length] ?? newTile(clockMs) };
    if (shownAtMoveTo(this.#runShadows, shadows)) this.#leaving = null;
    this.#runShadows = shadows;
  }

  #leavingFrame(clockMs: number, frameCount: number, onScreen: ShadowOnScreen): HelicopterShadowFrame | null {
    const leaving = this.#leaving;
    if (!leaving) return null;
    const y = leaving.from.y + stepsFlownOn(leaving, clockMs) * MOVELARGERY_STEP;
    const shadow = { ...leaving.from, y, frame: animate(leaving.tile, clockMs, frameCount) };
    if (onScreen(shadow)) return shadow;
    this.#leaving = null;
    return null;
  }
}
