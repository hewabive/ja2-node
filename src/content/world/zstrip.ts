// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Structure.cc AddZStripInfoToVObject

import type { StructureDef, StructureFile } from '../formats/jsd.ts';
import { WORLD_TILE_X } from './grid.ts';

export const STRUCTURE_MOBILE = 0x00000010;
export const STRUCTURE_GARAGEDOOR = 0x00000008;
export const STRUCTURE_ANYDOOR = 0x00cc0008;
export const STRUCTURE_CORPSE = 0x40000000;

const HALF_TILE_X = WORLD_TILE_X / 2;
const MAX_Z_CHANGES = 16;

export interface ZStripInfo {
  readonly zChanges: readonly number[];
  readonly initialZChange: number;
  readonly firstStripWidth: number;
}

export interface FrameGeometry {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
}

function spansSeveralTiles(s: StructureDef | null): boolean {
  return s !== null && s.tiles.length > 1 && s.tiles.slice(1).some((t) => t.posRelToBase !== 0);
}

export function zStripInfo(frame: FrameGeometry, s: StructureDef): ZStripInfo {
  let offsetX = frame.offsetX;
  if (s.flags & (STRUCTURE_MOBILE | STRUCTURE_CORPSE)) {
    offsetX += HALF_TILE_X;
    offsetX = offsetX - s.zTileOffsetX * HALF_TILE_X + s.zTileOffsetY * HALF_TILE_X;
  }
  let leftHalfWidth: number;
  let rightHalfWidth: number;
  if (offsetX <= 0) {
    rightHalfWidth = frame.width + offsetX - HALF_TILE_X;
    if (rightHalfWidth >= 0) {
      leftHalfWidth = -offsetX + HALF_TILE_X;
    } else {
      leftHalfWidth = frame.width - (rightHalfWidth % HALF_TILE_X);
      rightHalfWidth = 0;
    }
  } else if (offsetX < HALF_TILE_X) {
    leftHalfWidth = HALF_TILE_X - offsetX;
    rightHalfWidth = frame.width - leftHalfWidth;
    if (rightHalfWidth <= 0) {
      rightHalfWidth = 0;
      leftHalfWidth = HALF_TILE_X;
    }
  } else {
    leftHalfWidth = 0;
    rightHalfWidth = frame.width;
  }

  let increasing = leftHalfWidth > 0 ? Math.trunc(leftHalfWidth / HALF_TILE_X) : 0;
  const stable = rightHalfWidth > 0 ? 1 : 0;
  let decreasing = rightHalfWidth > HALF_TILE_X ? Math.trunc(rightHalfWidth / HALF_TILE_X) : 0;
  let firstStripWidth: number;
  if (leftHalfWidth > 0) {
    firstStripWidth = leftHalfWidth % HALF_TILE_X;
    if (firstStripWidth === 0) {
      increasing--;
      firstStripWidth = HALF_TILE_X;
    }
  } else {
    firstStripWidth = offsetX > WORLD_TILE_X ? HALF_TILE_X - ((offsetX - WORLD_TILE_X) % HALF_TILE_X) : WORLD_TILE_X - offsetX;
    if (firstStripWidth === 0) {
      decreasing--;
      firstStripWidth = HALF_TILE_X;
    }
  }
  const zChanges = [
    ...new Array<number>(increasing).fill(1),
    ...new Array<number>(stable).fill(0),
    ...new Array<number>(decreasing).fill(-1),
  ];
  if (zChanges.length > MAX_Z_CHANGES) throw new RangeError(`too many z strips (${zChanges.length})`);
  const initialZChange = increasing > 0 ? -increasing : stable > 0 ? 0 : -decreasing;
  return { zChanges, initialZChange, firstStripWidth };
}

export function tileSurfaceZStrips(frames: readonly FrameGeometry[], structures: StructureFile): (ZStripInfo | null)[] {
  const result: (ZStripInfo | null)[] = frames.map(() => null);
  const anyMultiTile = structures.structures.some(spansSeveralTiles);
  const lastStructure = structures.structures.at(-1) ?? null;
  const corpse = lastStructure !== null && (lastStructure.flags & STRUCTURE_CORPSE) !== 0;
  if (!anyMultiTile && !corpse) return result;
  frames.forEach((frame, i) => {
    const s = structures.structures[i] ?? null;
    if (!s || !(s.tiles.length > 1 || s.flags & STRUCTURE_CORPSE)) return;
    if (s.flags & STRUCTURE_ANYDOOR && !(s.flags & STRUCTURE_GARAGEDOOR)) return;
    result[i] = zStripInfo(frame, s);
  });
  return result;
}
