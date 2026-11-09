// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc LoadExplosionTableFromSavedGameFile, MAX_BOMB_QUEUE;
// @src TileEngine/LoadSaveExplosionType.cc ExtractExplosionTypeFromFile; Explosion_Control.h ExplosionQueueElement.

import { FormatError } from '../binary/errors.ts';
import type { SaveCursor } from './savegame-cursor.ts';

export const MAX_BOMB_QUEUE = 40;
const QUEUE_COUNT_PADDING = 3;
const QUEUE_ENTRY_BYTES = 12;
const QUEUE_ENTRY_PADDING = 3;
const EXPLOSION_RECORD_BYTES = 36;
const EXPLOSION_HEAD_PADDING = 4;
const EXPLOSION_GRID_PADDING = 1;
const EXPLOSION_LEVEL_PADDING = 2;
const EXPLOSION_ALLOCATED_PADDING = 1;
const EXPLOSION_TAIL_PADDING = 12;

export interface SavedQueuedBomb {
  readonly worldBombIndex: number;
  readonly timestamp: number;
  readonly exists: boolean;
}

export interface SavedExplosion {
  readonly ownerId: number;
  readonly animationId: number;
  readonly item: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly gridNo: number;
  readonly level: number;
  readonly frame: number;
}

export interface SavedExplosionTable {
  readonly queue: readonly SavedQueuedBomb[];
  readonly explosions: readonly SavedExplosion[];
}

export const NO_SAVED_EXPLOSIONS: SavedExplosionTable = { queue: [], explosions: [] };

function readQueuedBomb(c: SaveCursor): SavedQueuedBomb {
  const start = c.pos;
  const entry = { worldBombIndex: c.u32(), timestamp: c.u32(), exists: c.bool() };
  c.skip(QUEUE_ENTRY_PADDING);
  c.expectConsumed(start, QUEUE_ENTRY_BYTES, 'ExplosionQueueElement');
  return entry;
}

function readExplosion(c: SaveCursor): SavedExplosion {
  const start = c.pos;
  c.skip(EXPLOSION_HEAD_PADDING);
  const head = { ownerId: c.u8(), animationId: c.u8(), item: c.u16(), x: c.i16(), y: c.i16(), z: c.i16(), gridNo: c.i16() };
  c.skip(EXPLOSION_GRID_PADDING);
  const level = c.i8();
  c.skip(EXPLOSION_LEVEL_PADDING);
  c.bool();
  c.skip(EXPLOSION_ALLOCATED_PADDING);
  const frame = c.i16();
  c.skip(EXPLOSION_TAIL_PADDING);
  c.expectConsumed(start, EXPLOSION_RECORD_BYTES, 'EXPLOSIONTYPE');
  return { ...head, level, frame };
}

export function readExplosionTable(c: SaveCursor): SavedExplosionTable {
  const elements = c.u8();
  c.skip(QUEUE_COUNT_PADDING);
  if (elements > MAX_BOMB_QUEUE) throw new FormatError(`explosion queue: ${elements} elements, at most ${MAX_BOMB_QUEUE}`);
  const slots = Array.from({ length: MAX_BOMB_QUEUE }, () => readQueuedBomb(c));
  const explosions = Array.from({ length: c.u32() }, () => readExplosion(c));
  return { queue: slots.slice(0, elements), explosions };
}
