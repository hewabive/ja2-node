import { describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { vfsFileReader } from '../vfs/vfs.ts';
import { encryptRecord, PROFILE_RECORD_BYTES, PROFILES_PATH, parseProfile, parseProfiles } from './prof.ts';

function recordWithName(units: readonly number[]): Uint8Array {
  const plain = new Uint8Array(PROFILE_RECORD_BYTES);
  const view = new DataView(plain.buffer);
  units.forEach((u, i) => {
    view.setUint16(i * 2, u, true);
  });
  return plain;
}

describe('prof.dat fields', () => {
  it('reads the pre-combat grid number as a signed INT16, so NOWHERE stays -1', () => {
    const PRE_COMBAT_GRIDNO_OFFSET = 700;
    const NOWHERE = -1;
    const plain = new Uint8Array(PROFILE_RECORD_BYTES);
    new DataView(plain.buffer).setInt16(PRE_COMBAT_GRIDNO_OFFSET, NOWHERE, true);
    expect(parseProfile(0, plain).preCombatGridNo).toBe(NOWHERE);
  });

  it('reads the lifetime drug count from byte 691, between the days of morale hangover and the precedent quotes', () => {
    const plain = new Uint8Array(PROFILE_RECORD_BYTES);
    plain.set([4, 9], 690);
    const p = parseProfile(0, plain);
    expect([p.daysOfMoraleHangover, p.numTimesDrugUseInLifetime, p.precedentQuoteSaid]).toEqual([4, 9, 0]);
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('the shipped prof.dat', () => {
  it('starts every profile with no drug use in its lifetime', async () => {
    const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    try {
      const bytes = await vfsFileReader(data.vfs)(PROFILES_PATH);
      if (!bytes) throw new Error('no prof.dat');
      const profiles = parseProfiles(bytes);
      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles.filter((p) => p.numTimesDrugUseInLifetime !== 0)).toEqual([]);
    } finally {
      await data.close();
    }
  });
});

describe('prof.dat names', () => {
  it('keep correctly encoded names and undo the CP1251-as-CP1252 damage of the Russian data', () => {
    const plain = recordWithName([0xc8, 0xe2, 0xe0, 0xed]);
    expect(parseProfile(0, plain).name).toBe('Èâàí');
    expect(parseProfile(0, plain, 'russian').name).toBe('Иван');
    expect(parseProfiles(encryptRecord(plain), 'russian')[0]?.name).toBe('Иван');
  });
});
