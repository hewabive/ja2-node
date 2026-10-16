import { describe, expect, it } from 'vitest';
import {
  isValidSector,
  mapFileName,
  NO_PREVIOUS_SECTOR_ID,
  parseSectorId,
  parseSectorString,
  sectorFromId,
  sectorFromStrategicIndex,
  sectorId,
  sectorLongString,
  sectorShortString,
  strategicIndex,
} from './sector-ids.ts';

describe('sector ids', () => {
  it('round-trips byte ids, strategic indices and short strings for every sector', () => {
    for (let id = 0; id < 256; id++) {
      const s = sectorFromId(id);
      expect(sectorId(s)).toBe(id);
      expect(sectorFromStrategicIndex(strategicIndex(s))).toEqual(s);
      expect(parseSectorString(sectorShortString(s))).toEqual(s);
    }
  });

  it('uses the original numbering', () => {
    expect(parseSectorId('A1')).toBe(0);
    expect(parseSectorId('A9')).toBe(8);
    expect(parseSectorId('P16')).toBe(255);
    expect(strategicIndex(parseSectorString('A9'))).toBe(9 + 18);
    expect(sectorFromStrategicIndex(0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(isValidSector(sectorFromStrategicIndex(0))).toBe(false);
  });

  it('treats byte id 255 as P16, the "no previous sector" sentinel', () => {
    expect(sectorFromId(NO_PREVIOUS_SECTOR_ID)).toEqual({ x: 16, y: 16, z: 0 });
  });

  it('wraps the byte id of the (0,0) sector like an unchecked UINT8', () => {
    expect(sectorId({ x: 0, y: 0 })).toBe(239);
  });

  it('names map files with the basement and alternate suffixes', () => {
    expect(mapFileName({ x: 9, y: 1, z: 0 }, false)).toBe('A9.dat');
    expect(mapFileName({ x: 9, y: 1, z: 0 }, true)).toBe('A9_a.dat');
    expect(mapFileName({ x: 9, y: 10, z: 1 }, false)).toBe('J9_b1.dat');
    expect(mapFileName({ x: 9, y: 10, z: 1 }, true)).toBe('J9_b1_a.dat');
    expect(sectorLongString({ x: 9, y: 10, z: 2 }, false)).toBe('J9-2');
  });

  it('rejects malformed sector strings', () => {
    expect(() => parseSectorString('Q1')).toThrow();
    expect(() => parseSectorString('A17')).toThrow();
    expect(() => parseSectorString('A0')).toThrow();
  });
});
