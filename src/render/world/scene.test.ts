import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyTileLayer, LAYER_NAMES, type MapDef, tileLayerFromLists } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { buildLevel } from '../../content/world/level.ts';
import { buildTileDatabase, type TileElement, TileFlags, type TileSurface } from '../../content/world/tile-database.ts';
import { parseTileTables, typeIndex } from '../../content/world/tile-tables.ts';
import { DepthMode } from '../sprite-renderer.ts';
import { prepareLevelRenderData } from './level-render-data.ts';
import { buildScene, type SceneOptions, type SceneSource, screenToGridNo, tileOrigin } from './scene.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));
const surfaces: TileSurface[] = tables.types.map((t) => ({
  type: t.index,
  path: `t${t.index}.sti`,
  frames: Array.from({ length: t.count }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
  auxData: null,
  structures: null,
}));
const baseTiles = buildTileDatabase(tables, surfaces);
const options: SceneOptions = {
  width: 640,
  height: 360,
  camera: { centerX: 805, centerY: 805 },
  ambientShade: 3,
  showRoofs: true,
  showShadows: true,
};
const T = (name: string, sub = 1) => ({ type: typeIndex(tables, name), subIndex: sub });

function sceneWith(
  cells: Partial<Record<(typeof LAYER_NAMES)[number], [number, { type: number; subIndex: number }[]][]>>,
  tiles: TileElement[] = baseTiles,
) {
  const layers = Object.fromEntries(
    LAYER_NAMES.map((name) => {
      const lists = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
      for (const [g, list] of cells[name] ?? []) lists[g] = list;
      return [name, cells[name] ? tileLayerFromLists(lists) : emptyTileLayer()];
    }),
  ) as unknown as MapDef['layers'];
  const map = {
    minorVersion: 25,
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers,
  } as unknown as MapDef;
  const level = buildLevel(map, tables, tiles);
  const info = { northGridNo: -1, eastGridNo: -1, southGridNo: -1, westGridNo: -1 } as MapDef['info'];
  const source: SceneSource = {
    level,
    tiles,
    prepared: prepareLevelRenderData(level, tiles, tables, info, false),
    frame: () => ({ offsetX: 0, offsetY: 0, width: 40, height: 20 }),
  };
  return source;
}

const g = (x: number, y: number) => y * WORLD_COLS + x;

describe('projection and picking', () => {
  it('picks the tile whose diamond is under the cursor', () => {
    for (const [x, y] of [
      [80, 80],
      [81, 79],
      [75, 90],
      [90, 70],
    ] as const) {
      const o = tileOrigin(x, y, options);
      expect(screenToGridNo(o.x + 20, o.y + 10, options)).toBe(g(x, y));
      expect(screenToGridNo(o.x + 20, o.y + 1, options)).toBe(g(x, y));
    }
    expect(tileOrigin(80, 80, options)).toEqual({ x: 300, y: 160 });
  });
});

describe('scene order and depth', () => {
  it('draws land from the topmost full tile to the head, skipping covered land', () => {
    const source = sceneWith({
      land: [[g(80, 80), [T('FIRSTTEXTURE', 15), T('FIRSTTEXTURE', 1), T('FIRSTTEXTURE', 20)]]],
    });
    const land = buildScene(source, options).filter((i) => i.depthMode === DepthMode.NONE && !i.shadow);
    const names = land.map((i) => tables.tileNames[i.tile]);
    expect(names).toEqual(['FIRSTTEXTURE1', 'FIRSTTEXTURE20']);
  });

  it('orders rows by X+Y and uses the original z per layer', () => {
    const source = sceneWith({
      structs: [
        [g(81, 80), [T('FIRSTWALL', 1)]],
        [g(80, 80), [T('FIRSTWALL', 1)]],
      ],
      roofs: [[g(80, 80), [T('FIRSTROOF', 1)]]],
      objects: [[g(80, 80), [T('FIRSTOSTRUCT', 1)]]],
    });
    const items = buildScene(source, options);
    const at = (name: string) => items.filter((i) => tables.tileNames[i.tile] === name);
    const [wallA, wallB] = at('FIRSTWALL1');
    expect(wallA?.z).toBe(8 * (10 * 160 - 835) + 4);
    expect(wallB?.z).toBe(8 * (10 * 161 - 835) + 4);
    expect(at('FIRSTROOF1')[0]?.z).toBe(8 * (10 * 160 - 835 + 50) + 5);
    expect(at('FIRSTROOF1')[0]?.y).toBe(tileOrigin(80, 80, options).y - 50);
    expect(items.indexOf(at('FIRSTROOF1')[0] as never)).toBeLessThan(items.indexOf(wallB as never));
    expect(at('FIRSTOSTRUCT1')[0]).toMatchObject({ z: 1, depthMode: DepthMode.NEARER_OR_EQUAL });
  });

  it('splits multi-tile structures into 20 px strips with their own depth', () => {
    const wall = typeIndex(tables, 'FIRSTOSTRUCT');
    const tiles = baseTiles.map((t) =>
      t.type === wall && t.regionIndex === 0
        ? { ...t, flags: t.flags | TileFlags.MULTI_Z, zStrip: { zChanges: [1, 0, -1], initialZChange: -1, firstStripWidth: 10 } }
        : t,
    );
    const source = {
      ...sceneWith({ structs: [[g(80, 80), [T('FIRSTOSTRUCT', 1)]]] }, tiles),
      frame: () => ({ offsetX: 0, offsetY: 0, width: 70, height: 20 }),
    };
    const strips = buildScene(source, options).filter((i) => i.depthMode === DepthMode.NEARER && !i.shadow);
    const base = 8 * (10 * 160 - 835) + 4;
    expect(strips.map((s) => [s.srcX, s.srcWidth, s.z])).toEqual([
      [0, 10, base - 80],
      [10, 20, base],
      [30, 20, base],
      [50, 20, base - 80],
    ]);
  });

  it('adds buddy shadows by day only and hides roofs on request', () => {
    const source = sceneWith({
      land: [[g(80, 80), [T('FIRSTTEXTURE', 1)]]],
      structs: [[g(80, 80), [T('FIRSTOSTRUCT', 1)]]],
      roofs: [[g(80, 81), [T('FIRSTROOF', 1)]]],
    });
    expect(
      buildScene(source, options)
        .filter((i) => i.shadow)
        .map((i) => tables.tileNames[i.tile]),
    ).toEqual(['FIRSTSHADOW1']);
    expect(buildScene(source, { ...options, ambientShade: 12 }).some((i) => i.shadow)).toBe(false);
    expect(buildScene(source, { ...options, showRoofs: false }).some((i) => tables.tileNames[i.tile] === 'FIRSTROOF1')).toBe(false);
  });
});
