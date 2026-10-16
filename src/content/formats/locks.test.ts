import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { decodeLockTable, encodeLockTable, LOCK_RECORD_BYTES, LOCKS_PATH, LockType, NUM_LOCKS, parseStubLockTable } from './locks.ts';

const stubLocks = () => parseStubLockTable(JSON.parse(readFileSync(join(import.meta.dirname, '../../../stubs/locks.json'), 'utf8')));

describe('lock table', () => {
  it('round-trips the 46-byte LOCK records of the stub table', () => {
    const table = stubLocks();
    const bytes = encodeLockTable(table);
    expect(bytes.length).toBe(NUM_LOCKS * LOCK_RECORD_BYTES);
    expect(decodeLockTable(bytes)).toEqual(table);
    expect(table[2]).toEqual({ keyItem: 1, type: LockType.ELECTRONIC, pickDifficulty: 60, smashDifficulty: 254 });
    expect(table[0]).toEqual({ keyItem: 0, type: LockType.NONE, pickDifficulty: 0, smashDifficulty: 0 });
  });

  it('rejects a short file', () => {
    expect(() => decodeLockTable(new Uint8Array(LOCK_RECORD_BYTES))).toThrow(/lock table/);
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('original Locks.bin', () => {
  it('loads 64 locks', async () => {
    const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
    try {
      const bytes = await data.vfs.read(LOCKS_PATH);
      expect(decodeLockTable(bytes)).toHaveLength(NUM_LOCKS);
    } finally {
      await data.close();
    }
  });
});
