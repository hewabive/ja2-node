// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CreateSoldierPalettes, SetPaletteReplacement, ConvertAniCodeToAniFrame (a
// @src 32-direction sheet by ExtOneCDirection of ubHiResDirection, 2026-11-05), Dir2ExtDir;
// @src TileEngine/RenderWorld.cc (merc screen position, shade and z).

import { idiv } from '../../core/int.ts';
import type { SoldierPalettes as PaletteData } from '../formats/ja2pal.ts';

export interface SoldierPaletteIds {
  readonly hair: string;
  readonly skin: string;
  readonly vest: string;
  readonly pants: string;
}

export const SOLDIER_SHADOW_INDEX = 254;
export const DEFAULT_SOLDIER_SHADE = 4;
export const MERC_Z_LEVEL = 3;
const TWO_DIRECTION_BLOCKS = [0, 0, 1, 1, 0, 1, 1, 0];
const DIRECTIONS = 8;
export const HI_RES_DIRECTIONS = 32;
export const HI_RES_STEPS_PER_DIRECTION = HI_RES_DIRECTIONS / DIRECTIONS;

function replace(palette: Uint8Array, data: PaletteData, id: string): void {
  if (!id) return;
  const rep = data.replacements.find((r) => r.id === id);
  if (!rep) return;
  const range = data.subRanges[rep.subRange];
  if (!range) return;
  for (let i = range.start; i <= range.end; i++) {
    const k = i - range.start;
    if (k * 3 + 2 >= rep.rgb.length) break;
    palette[i * 3] = rep.rgb[k * 3] as number;
    palette[i * 3 + 1] = rep.rgb[k * 3 + 1] as number;
    palette[i * 3 + 2] = rep.rgb[k * 3 + 2] as number;
  }
}

export function composeSoldierPalette(standingPalette: Uint8Array, data: PaletteData, ids: SoldierPaletteIds): Uint8Array {
  const palette = standingPalette.slice(0, 768);
  replace(palette, data, ids.hair);
  replace(palette, data, ids.vest);
  replace(palette, data, ids.pants);
  replace(palette, data, ids.skin);
  return palette;
}

export interface SheetLayout {
  readonly directions: number;
  readonly framesPerDirection: number;
  readonly noFrames: boolean;
  readonly frameCount: number;
}

export interface SheetFacing {
  readonly direction: number;
  readonly hiResDirection: number;
}

export function facingOfDirection(direction: number): SheetFacing {
  return { direction, hiResDirection: direction * HI_RES_STEPS_PER_DIRECTION };
}

function oneClockwise(direction: number, directions: number): number {
  return (direction + 1) % directions;
}

function hiResBlock(hiResDirection: number): number {
  return (hiResDirection + HI_RES_STEPS_PER_DIRECTION) % HI_RES_DIRECTIONS;
}

export function soldierSheetFrame(layout: SheetLayout, scriptFrame: number, facing: SheetFacing): number {
  const direction = facing.direction;
  let block = oneClockwise(direction, DIRECTIONS);
  if (layout.directions === 1) block = 0;
  else if (layout.directions === 4) block = idiv(block, 2);
  else if (layout.directions === HI_RES_DIRECTIONS) block = hiResBlock(facing.hiResDirection);
  else if (layout.directions === 2) block = TWO_DIRECTION_BLOCKS[direction] ?? 0;
  else if (layout.directions === 3) block = direction === 7 ? 1 : direction === 6 ? 0 : direction === 2 ? 2 : block;
  const frame = layout.noFrames ? 0 : scriptFrame;
  const index = frame + layout.framesPerDirection * block;
  return index >= layout.frameCount ? 0 : index;
}

export function soldierShade(tileShade: number): number {
  return Math.max((tileShade & 15) - 2, DEFAULT_SOLDIER_SHADE);
}
