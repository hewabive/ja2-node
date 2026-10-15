import { describe, expect, it } from 'vitest';
import { parseTilesetDatabase, tileSurfaceSource, writeTilesetDatabase } from './ja2set.ts';

describe('tileset database', () => {
  const db = {
    tileTypeCount: 3,
    tilesets: [
      { id: 0, name: 'GENERIC 1', ambientId: 0, surfaceFiles: ['grass.sti', 'Wall.STI', 'roof.sti'] },
      { id: 1, name: 'DESERT', ambientId: 2, surfaceFiles: ['sand.sti', '', ''] },
    ],
  };

  it('round-trips names, ambience and file slots', () => {
    expect(parseTilesetDatabase(writeTilesetDatabase(db))).toEqual(db);
  });

  it('falls back to the default tileset for empty slots', () => {
    expect(tileSurfaceSource(db, 1, 0)).toEqual({ tilesetId: 1, path: 'tilesets/1/sand.sti' });
    expect(tileSurfaceSource(db, 1, 1)).toEqual({ tilesetId: 0, path: 'tilesets/0/wall.sti' });
    expect(() => tileSurfaceSource(db, 5, 0)).toThrow(RangeError);
  });
});
