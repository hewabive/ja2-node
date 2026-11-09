import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { MAX_BOMB_QUEUE, readExplosionTable } from './savegame-effects.ts';

const ROOF = 1;
const TRAILING_MARKER = 0xab;

function queueEntry(w: BinaryWriter, bomb: number, timestamp: number, exists: number): void {
  w.u32(bomb).u32(timestamp).u8(exists).zeros(3);
}

function explosionRecord(w: BinaryWriter): void {
  w.zeros(4).u8(2).u8(5).u16(131).i16(805).i16(675).i16(0).i16(12867).zeros(1).u8(ROOF).zeros(2).u8(1).zeros(1).i16(7).zeros(12);
}

function table(elements: number, explosions: number): Uint8Array {
  const w = new BinaryWriter().u8(elements).zeros(3);
  queueEntry(w, 3, 900_000, 0);
  queueEntry(w, 1, 901_250, 1);
  queueEntry(w, 7, 5, 1);
  for (let i = 3; i < MAX_BOMB_QUEUE; i++) queueEntry(w, 0, 0, 0);
  w.u32(explosions);
  for (let i = 0; i < explosions; i++) explosionRecord(w);
  return w.u8(TRAILING_MARKER).toBytes();
}

describe('readExplosionTable (Explosion_Control.cc LoadExplosionTableFromSavedGameFile)', () => {
  it('reads all 40 queue slots and keeps the counted ones, then the allocated explosions with their saved frame', () => {
    const c = new SaveCursor(table(2, 1));
    const saved = readExplosionTable(c);
    expect(saved.queue).toEqual([
      { worldBombIndex: 3, timestamp: 900_000, exists: false },
      { worldBombIndex: 1, timestamp: 901_250, exists: true },
    ]);
    expect(saved.explosions).toEqual([
      { ownerId: 2, animationId: 5, item: 131, x: 805, y: 675, z: 0, gridNo: 12867, level: ROOF, frame: 7 },
    ]);
    expect(c.u8()).toBe(TRAILING_MARKER);
  });

  it('rejects a queue count past its 40 slots', () => {
    expect(() => readExplosionTable(new SaveCursor(table(MAX_BOMB_QUEUE + 1, 0)))).toThrow(FormatError);
  });
});
