import { describe, expect, it } from 'vitest';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, levelTilesAt } from '../../content/world/level.ts';
import { layerWith } from '../../content/world/synthetic.ts';
import { applyTileChanges, tileChangesKey } from './tile-changes.ts';

const WINDOW = 1000;
const WALL = 900;
const AT = 12880;

function level(): Level {
  const structs = layerWith((g) => (g === AT ? [WALL, WINDOW, 950] : []));
  const empty = layerWith(() => []);
  return {
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers: { land: empty, objects: empty, structs, shadows: empty, roofs: empty, onRoof: empty, topmost: empty },
  } as Level;
}

describe('tile changes', () => {
  it('keeps the place of a swapped structure, adds plain additions at the head and drops removals', () => {
    const swapped = applyTileChanges(level(), [
      { kind: 'remove', gridNo: AT, level: 0, tile: WINDOW },
      { kind: 'add', gridNo: AT, level: 0, tile: WINDOW + 1 },
    ]);
    expect([...levelTilesAt(swapped.layers.structs, AT)]).toEqual([WALL, WINDOW + 1, 950]);
    const added = applyTileChanges(level(), [{ kind: 'add', gridNo: AT + 1, level: 1, tile: 77 }]);
    expect([...levelTilesAt(added.layers.onRoof, AT + 1)]).toEqual([77]);
    const removed = applyTileChanges(level(), [{ kind: 'remove', gridNo: AT, level: 1, tile: WALL }]);
    expect([...levelTilesAt(removed.layers.structs, AT)]).toEqual([WINDOW, 950]);
  });

  it('returns the same level when nothing changed and keys a change list by its content', () => {
    const l = level();
    expect(applyTileChanges(l, [])).toBe(l);
    expect(tileChangesKey([{ kind: 'add', gridNo: 5, level: 0, tile: 7 }])).toBe('a5.0.7');
  });
});
