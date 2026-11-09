// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc SetSoldierLocatorOffsets, GetActualSoldierAnimDims (sBoundingBox* from the
// @src dimensions of usAniFrame on the surface shown when they were set); the frame and facing come from the view's
// @src bounding frame, which the simulation sets where the original calls SetSoldierLocatorOffsets (2026-11-09).

import { facingOfDirection, type SheetFacing } from '../../content/anim/soldier-sprite.ts';
import type { IndexedFrame } from '../../content/picture/picture.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { SheetRequest } from './soldier-assets.ts';

export type BoundingBox = Pick<IndexedFrame, 'offsetX' | 'offsetY' | 'width' | 'height'>;

export interface BoundingFrame {
  readonly sheet: SheetRequest;
  readonly scriptFrame: number;
  readonly facing: SheetFacing;
}

export type SheetFor = (s: SoldierView) => SheetRequest | null;

interface Pose {
  readonly animation: number;
  readonly stateTick: number;
  readonly direction: number;
  readonly scriptFrame: number;
  readonly facing: SheetFacing;
}

export function boundingFacing(s: SoldierView): SheetFacing {
  const facing = facingOfDirection(s.boundingDirection ?? s.direction);
  return s.boundingHiResDirection === undefined ? facing : { ...facing, hiResDirection: s.boundingHiResDirection };
}

function poseOf(s: SoldierView): Pose {
  return {
    animation: s.animation,
    stateTick: s.stateTick,
    direction: s.direction,
    scriptFrame: s.boundingFrame ?? s.frame,
    facing: boundingFacing(s),
  };
}

function samePose(a: Pose, b: Pose): boolean {
  return (
    a.animation === b.animation &&
    a.stateTick === b.stateTick &&
    a.direction === b.direction &&
    a.scriptFrame === b.scriptFrame &&
    a.facing.direction === b.facing.direction &&
    a.facing.hiResDirection === b.facing.hiResDirection
  );
}

export class SoldierBoundingBoxes {
  readonly #poses = new Map<number, Pose>();
  readonly #frames = new Map<number, BoundingFrame>();

  update(soldiers: readonly SoldierView[], sheetFor: SheetFor): void {
    const present = new Set<number>();
    for (const s of soldiers) {
      present.add(s.id);
      const pose = poseOf(s);
      const before = this.#poses.get(s.id);
      if (!before || !samePose(before, pose)) this.#set(s.id, sheetFor(s), pose);
      this.#poses.set(s.id, pose);
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

  #set(id: number, sheet: SheetRequest | null, pose: Pose): void {
    if (sheet) this.#frames.set(id, { sheet, scriptFrame: pose.scriptFrame, facing: pose.facing });
    else this.#frames.delete(id);
  }

  #forget(id: number): void {
    this.#poses.delete(id);
    this.#frames.delete(id);
  }
}
