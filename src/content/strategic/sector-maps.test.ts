import { describe, expect, it } from 'vitest';
import { sector } from './sector-ids.ts';
import { STUB_FALLBACK_MAP, sectorMapPath } from './sector-maps.ts';

describe('sector map paths', () => {
  it('prefers the original map, then a stub of the same sector, then the generic stub', () => {
    const files = new Set(['maps/a9.dat', 'stubs/world/maps/a9.dat', 'stubs/world/maps/b9.dat', 'maps/j9_b1.dat']);
    const exists = (p: string) => files.has(p);
    expect(sectorMapPath(exists, sector(9, 1), false)).toBe('maps/a9.dat');
    expect(sectorMapPath(exists, sector(9, 2), false)).toBe('stubs/world/maps/b9.dat');
    expect(sectorMapPath(exists, sector(9, 10, 1), false)).toBe('maps/j9_b1.dat');
    expect(sectorMapPath(exists, sector(3, 3), true)).toBe(STUB_FALLBACK_MAP);
  });
});
