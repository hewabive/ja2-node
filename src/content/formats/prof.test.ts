import { describe, expect, it } from 'vitest';
import { encryptRecord, PROFILE_RECORD_BYTES, parseProfile, parseProfiles } from './prof.ts';

function recordWithName(units: readonly number[]): Uint8Array {
  const plain = new Uint8Array(PROFILE_RECORD_BYTES);
  const view = new DataView(plain.buffer);
  units.forEach((u, i) => {
    view.setUint16(i * 2, u, true);
  });
  return plain;
}

describe('prof.dat names', () => {
  it('keep correctly encoded names and undo the CP1251-as-CP1252 damage of the Russian data', () => {
    const plain = recordWithName([0xc8, 0xe2, 0xe0, 0xed]);
    expect(parseProfile(0, plain).name).toBe('Èâàí');
    expect(parseProfile(0, plain, 'russian').name).toBe('Иван');
    expect(parseProfiles(encryptRecord(plain), 'russian')[0]?.name).toBe('Иван');
  });
});
