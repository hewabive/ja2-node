// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Data.cc LoadAnimationSurface (the start frame of the z strips);
// @src TileEngine/Structure.cc AddZStripInfoToVObject (one structure per step of frames from it).

import { idiv } from '../../core/int.ts';
import { surfaceId } from './surface-choice.ts';
import type { AnimationTables } from './tables.ts';

const PRONE_START_FRAME = 5;
const FIRST_FRAME = 0;
const ONE_DIRECTION_ONLY = -1;

function zStripStartFrame(tables: AnimationTables, surface: number): number {
  if (surface === surfaceId(tables, 'RGMPRONE')) return PRONE_START_FRAME;
  const queen = surface >= surfaceId(tables, 'QUEENMONSTERSTANDING') && surface <= surfaceId(tables, 'QUEENMONSTERSWIPE');
  return queen ? ONE_DIRECTION_ONLY : FIRST_FRAME;
}

export function zStripSourceFrame(
  tables: AnimationTables,
  surface: number,
  frameCount: number,
  structureCount: number,
  structureIndex: number,
): number | null {
  if (structureIndex < 0 || structureIndex >= structureCount) return null;
  const start = zStripStartFrame(tables, surface);
  if (start === ONE_DIRECTION_ONLY) return structureIndex === 0 && frameCount > 0 ? FIRST_FRAME : null;
  const frame = start + structureIndex * idiv(frameCount, structureCount);
  return frame < frameCount ? frame : null;
}
