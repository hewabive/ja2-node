import { describe, expect, it } from 'vitest';
import type { MapDef } from '../formats/map.ts';
import { sector } from './sector-ids.ts';
import { STUB_FALLBACK_MAP, sectorMapPath, sectorOfMapPath, withSectorExitGrids } from './sector-maps.ts';

describe('sector map paths', () => {
  it('prefers the original map, then a stub of the same sector, then the generic stub', () => {
    const files = new Set(['maps/a9.dat', 'stubs/world/maps/a9.dat', 'stubs/world/maps/b9.dat', 'maps/j9_b1.dat']);
    const exists = (p: string) => files.has(p);
    expect(sectorMapPath(exists, sector(9, 1), false)).toBe('maps/a9.dat');
    expect(sectorMapPath(exists, sector(9, 2), false)).toBe('stubs/world/maps/b9.dat');
    expect(sectorMapPath(exists, sector(9, 10, 1), false)).toBe('maps/j9_b1.dat');
    expect(sectorMapPath(exists, sector(3, 3), true)).toBe(STUB_FALLBACK_MAP);
  });

  it('reads the sector back from a sector map file name', () => {
    expect(sectorOfMapPath('stubs/world/maps/d13.dat')).toEqual(sector(13, 4));
    expect(sectorOfMapPath('stubs/world/maps/e13_b2.dat')).toEqual(sector(13, 5, 2));
    expect(sectorOfMapPath('maps/b15_a.dat')).toEqual(sector(15, 2));
    expect(sectorOfMapPath(STUB_FALLBACK_MAP)).toBeNull();
    expect(sectorOfMapPath('stubs/world/maps/mine.dat')).toBeNull();
  });
});

describe('same-sector exit grids', () => {
  const map = (exitGrids: MapDef['exitGrids']) => ({ exitGrids }) as unknown as MapDef;
  const down = { mapIndex: 100, gridNo: 200, sector: { x: 0, y: 0, z: 1 } };
  const away = { mapIndex: 101, gridNo: 201, sector: { x: 10, y: 1, z: 0 } };

  it('lead to the sector the map was loaded for, keeping their level', () => {
    const resolved = withSectorExitGrids(map([down, away]), 'stubs/world/maps/d13.dat');
    expect(resolved.exitGrids).toEqual([{ ...down, sector: { x: 13, y: 4, z: 1 } }, away]);
  });

  it('leave a map alone that has none or is not loaded for a sector', () => {
    const plain = map([away]);
    expect(withSectorExitGrids(plain, 'stubs/world/maps/d13.dat')).toBe(plain);
    const generic = map([down]);
    expect(withSectorExitGrids(generic, 'stubs/world/maps/mine.dat')).toBe(generic);
  });
});
