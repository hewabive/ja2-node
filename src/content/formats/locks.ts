// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Keys.h LOCK, lock types, ANYKEY, OPENING_NOT_POSSIBLE; Keys.cc LoadLockTable.

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';

export const LOCKS_PATH = 'binarydata/locks.bin';
export const STUB_LOCKS_PATH = `stubs/${LOCKS_PATH}`;
export const NUM_LOCKS = 64;
export const LOCK_RECORD_BYTES = 46;
const EDITOR_NAME_BYTES = 40;

export const LockType = { NONE: 0, REGULAR: 1, PADLOCK: 2, CARD: 3, ELECTRONIC: 4, SPECIAL: 5 } as const;
export const LOCK_UNOPENABLE = 255;
export const OPENING_NOT_POSSIBLE = 254;
export const ANYKEY = 252;
export const INVALID_KEY_NUMBER = 255;

export interface LockDef {
  readonly keyItem: number;
  readonly type: number;
  readonly pickDifficulty: number;
  readonly smashDifficulty: number;
}

export type LockTable = readonly LockDef[];

const NO_LOCK: LockDef = { keyItem: 0, type: LockType.NONE, pickDifficulty: 0, smashDifficulty: 0 };

export function emptyLockTable(): LockTable {
  return Array.from({ length: NUM_LOCKS }, () => NO_LOCK);
}

export function lockAt(table: LockTable, id: number): LockDef {
  return table[id] ?? NO_LOCK;
}

export function decodeLockTable(bytes: Uint8Array): LockTable {
  if (bytes.length < NUM_LOCKS * LOCK_RECORD_BYTES)
    throw new FormatError(`lock table needs ${NUM_LOCKS * LOCK_RECORD_BYTES} bytes, got ${bytes.length}`);
  const r = new BinaryReader(bytes);
  return Array.from({ length: NUM_LOCKS }, () => {
    r.skip(EDITOR_NAME_BYTES);
    const keyItem = r.u16();
    const type = r.u8();
    const pickDifficulty = r.u8();
    const smashDifficulty = r.u8();
    r.skip(1);
    return { keyItem, type, pickDifficulty, smashDifficulty };
  });
}

export function encodeLockTable(table: LockTable): Uint8Array {
  const w = new BinaryWriter(NUM_LOCKS * LOCK_RECORD_BYTES);
  for (let id = 0; id < NUM_LOCKS; id++) {
    const lock = lockAt(table, id);
    w.zeros(EDITOR_NAME_BYTES).u16(lock.keyItem).u8(lock.type).u8(lock.pickDifficulty).u8(lock.smashDifficulty).u8(0);
  }
  return w.toBytes();
}

interface StubLockEntry {
  readonly id: number;
  readonly keyItem: number;
  readonly type: keyof typeof LockType;
  readonly pick: number;
  readonly smash: number;
}

export function parseStubLockTable(json: unknown): LockTable {
  const entries = (json as { locks?: unknown }).locks;
  if (!Array.isArray(entries)) throw new FormatError('stub lock table needs a locks array');
  const table = [...emptyLockTable()];
  for (const raw of entries as StubLockEntry[]) {
    const type = LockType[raw.type];
    if (!Number.isInteger(raw.id) || raw.id < 0 || raw.id >= NUM_LOCKS || type === undefined)
      throw new FormatError(`bad stub lock entry ${JSON.stringify(raw)}`);
    table[raw.id] = { keyItem: raw.keyItem, type, pickDifficulty: raw.pick, smashDifficulty: raw.smash };
  }
  return table;
}
