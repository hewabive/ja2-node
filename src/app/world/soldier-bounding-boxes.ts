// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc SetSoldierLocatorOffsets, GetActualSoldierAnimDims (sBoundingBox* from the
// @src dimensions of usAniFrame), called by EVENT_InitNewSoldierAnim once the first frame of the new animation is
// @src converted and by EVENT_SetSoldierDirection, which does not convert the frame again, so a turn keeps the frame of
// @src the facing before it.

import type { IndexedFrame } from '../../content/picture/picture.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { SheetRequest } from './soldier-assets.ts';

export type BoundingBox = Pick<IndexedFrame, 'offsetX' | 'offsetY' | 'width' | 'height'>;

export interface BoundingFrame {
  readonly sheet: SheetRequest;
  readonly scriptFrame: number;
  readonly direction: number;
}

export interface BoundingFrameSources {
  readonly sheetFor: (s: SoldierView) => SheetRequest | null;
  readonly firstFrameOf: (s: SoldierView) => number;
  readonly frameOf: (s: SoldierView) => number;
}

interface Pose {
  readonly animation: number;
  readonly stateTick: number;
  readonly direction: number;
}

function poseOf(s: SoldierView): Pose {
  return { animation: s.animation, stateTick: s.stateTick, direction: s.direction };
}

function startedAnimation(before: Pose | undefined, s: SoldierView): boolean {
  return !before || before.animation !== s.animation || before.stateTick !== s.stateTick;
}

export class SoldierBoundingBoxes {
  readonly #poses = new Map<number, Pose>();
  readonly #frames = new Map<number, BoundingFrame>();

  update(soldiers: readonly SoldierView[], sources: BoundingFrameSources): void {
    const present = new Set<number>();
    for (const s of soldiers) {
      present.add(s.id);
      this.#follow(s, this.#poses.get(s.id), sources);
      this.#poses.set(s.id, poseOf(s));
    }
    for (const id of this.#poses.keys()) if (!present.has(id)) this.#forget(id);
  }

  frameOf(id: number): BoundingFrame | null {
    return this.#frames.get(id) ?? null;
  }

  reset(): void {
    this.#poses.clear();
    this.#frames.clear();
  }

  #follow(s: SoldierView, before: Pose | undefined, sources: BoundingFrameSources): void {
    if (startedAnimation(before, s)) this.#set(s.id, sources.sheetFor(s), sources.firstFrameOf(s), s.direction);
    else if (before && before.direction !== s.direction) this.#set(s.id, sources.sheetFor(s), sources.frameOf(s), before.direction);
  }

  #set(id: number, sheet: SheetRequest | null, scriptFrame: number, direction: number): void {
    if (sheet) this.#frames.set(id, { sheet, scriptFrame, direction });
    else this.#frames.delete(id);
  }

  #forget(id: number): void {
    this.#poses.delete(id);
    this.#frames.delete(id);
  }
}
