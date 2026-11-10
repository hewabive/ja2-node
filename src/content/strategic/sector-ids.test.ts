import { describe, expect, it } from 'vitest';
import {
  isValidSector,
  MAX_SECTOR_Z,
  mapFileName,
  NO_PREVIOUS_SECTOR_ID,
  parseSectorId,
  parseSectorLongString,
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

  it('names the palace map of a meanwhile scene with the _m suffix and no other sector or level', () => {
    const palace = { x: 3, y: 16, z: 0 };
    expect(mapFileName(palace, false, true)).toBe('P3_m.dat');
    expect(mapFileName(palace, false, false)).toBe('P3.dat');
    expect(mapFileName({ ...palace, z: 1 }, false, true)).toBe('P3_b1.dat');
    expect(mapFileName({ x: 7, y: 14, z: 0 }, false, true)).toBe('N7.dat');
    expect(mapFileName(palace, true, true)).toBe('P3_a_m.dat');
  });

  it('rejects malformed sector strings', () => {
    expect(() => parseSectorString('Q1')).toThrow();
    expect(() => parseSectorString('A17')).toThrow();
    expect(() => parseSectorString('A0')).toThrow();
  });

  it('reads the long string of every level back, and a short string as the surface', () => {
    for (let z = 0; z <= MAX_SECTOR_Z; z++)
      expect(parseSectorLongString(sectorLongString({ x: 13, y: 4, z }, false))).toEqual({ x: 13, y: 4, z });
    expect(parseSectorLongString('D13')).toEqual({ x: 13, y: 4, z: 0 });
    for (const text of ['D13-4', 'D13-', 'D13-1-1', 'D13_b1', 'Q1-1']) expect(() => parseSectorLongString(text)).toThrow();
  });
});
