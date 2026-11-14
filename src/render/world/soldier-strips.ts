// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc BltTransZTransShadowInc, BltTransZTransShadowIncObscure (the strips of a
// @src soldier clipped at the left edge, the sublayer step inside a run of opaque pixels, the dither parity of a sprite
// @src clipped at the top); src/sgp/VObject_Blitters.cc ClipInfo::ClipInfo (the skipped columns and rows).

import type { ZStripInfo } from '../../content/world/zstrip.ts';
import { clamp, idiv } from '../../core/int.ts';
import { HALF_TILE_X, Z_STRIP_DELTA, Z_SUBLAYERS } from './geometry.ts';
import { InstanceFlags, type SpriteSource } from './instances.ts';

const TRANSPARENT = 0;
const VIEW_LEFT = 0;

export interface StripSprite extends SpriteSource {
  readonly pixels: Uint8Array;
}

export interface SpriteSkip {
  readonly left: number;
  readonly top: number;
}

export interface StripCell {
  readonly source: SpriteSource;
  readonly top: number;
  readonly srcX: number;
  readonly width: number;
  readonly z: number;
}

interface StripStart {
  readonly z: number;
  readonly index: number;
  readonly columns: number;
}

interface StripColumn {
  readonly srcX: number;
  readonly width: number;
  readonly change: number;
}

export function spriteSkip(screenX: number, screenY: number, sprite: SpriteSource, viewTop: number): SpriteSkip {
  return {
    left: clamp(VIEW_LEFT - screenX, 0, sprite.width),
    top: clamp(viewTop - screenY, 0, sprite.height),
  };
}

export function stripDitherFlags(skip: SpriteSkip): number {
  return skip.top % 2 === 1 ? InstanceFlags.DITHER | InstanceFlags.DITHER_ODD : InstanceFlags.DITHER;
}

function zStep(change: number | undefined): number {
  return Math.sign(change ?? 0);
}

function firstColumns(strip: ZStripInfo, leftSkip: number): number {
  const first = strip.firstStripWidth;
  if (leftSkip > first) return HALF_TILE_X - ((leftSkip - first) % HALF_TILE_X);
  if (leftSkip < first) return first - leftSkip;
  return HALF_TILE_X;
}

function clippedStripStart(strip: ZStripInfo, z: number, leftSkip: number): StripStart {
  const startZ = z + Z_STRIP_DELTA * strip.initialZChange;
  const columns = firstColumns(strip, leftSkip);
  if (leftSkip < columns) return { z: startZ, index: 0, columns };
  const index = 1 + idiv(leftSkip - strip.firstStripWidth, HALF_TILE_X);
  let skipped = startZ;
  for (let i = 0; i < index; i++) skipped += Z_SUBLAYERS * zStep(strip.zChanges[i]);
  return { z: skipped, index, columns };
}

function stripColumns(strip: ZStripInfo, start: StripStart, leftSkip: number, spriteWidth: number): StripColumn[] {
  const columns: StripColumn[] = [];
  let srcX = leftSkip;
  let width = Math.min(start.columns, spriteWidth - srcX);
  let index = start.index;
  let change = 0;
  while (srcX < spriteWidth) {
    columns.push({ srcX, width, change });
    srcX += width;
    width = Math.min(HALF_TILE_X, spriteWidth - srcX);
    change = zStep(strip.zChanges[index++]);
  }
  return columns;
}

function bandSource(sprite: SpriteSource, top: number, bottom: number): SpriteSource {
  return top === 0 && bottom === sprite.height ? sprite : { ...sprite, y: sprite.y + top, height: bottom - top };
}

export function obscuredStripCells(strip: ZStripInfo, sprite: SpriteSource, z: number, skip: SpriteSkip): StripCell[] {
  const start = clippedStripStart(strip, z, skip.left);
  let cellZ = start.z;
  return stripColumns(strip, start, skip.left, sprite.width).map((c) => {
    cellZ += Z_STRIP_DELTA * c.change;
    return { source: sprite, top: 0, srcX: c.srcX, width: c.width, z: cellZ };
  });
}

function stepAcross(sprite: StripSprite, row: number, c: StripColumn): number {
  return sprite.pixels[row * sprite.width + c.srcX - 1] === TRANSPARENT ? Z_STRIP_DELTA : Z_SUBLAYERS;
}

export function noBurnStripCells(strip: ZStripInfo, sprite: StripSprite, z: number, skip: SpriteSkip): StripCell[] {
  const start = clippedStripStart(strip, z, skip.left);
  const columns = stripColumns(strip, start, skip.left, sprite.width);
  const cells: StripCell[] = [];
  const bandTop = columns.map(() => 0);
  const bandZ = columns.map(() => start.z);
  const close = (k: number, bottom: number) => {
    const c = columns[k] as StripColumn;
    const top = bandTop[k] as number;
    cells.push({ source: bandSource(sprite, top, bottom), top, srcX: c.srcX, width: c.width, z: bandZ[k] as number });
  };
  for (let row = 0; row < sprite.height; row++) {
    let rowZ = start.z;
    columns.forEach((c, k) => {
      if (c.change !== 0) rowZ += c.change * stepAcross(sprite, row, c);
      if (row === 0) bandZ[k] = rowZ;
      else if (rowZ !== bandZ[k]) {
        close(k, row);
        bandTop[k] = row;
        bandZ[k] = rowZ;
      }
    });
  }
  for (let k = 0; k < columns.length; k++) close(k, sprite.height);
  return cells;
}
