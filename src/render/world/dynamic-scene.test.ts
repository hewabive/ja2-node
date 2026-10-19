import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyTileLayer, LAYER_NAMES, type MapDef, tileLayerFromLists } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { buildLevel } from '../../content/world/level.ts';
import { buildTileDatabase, type TileElement, TileFlags, type TileSurface } from '../../content/world/tile-database.ts';
import { parseTileTables, tileIndex, tileIndexFromTypeSubIndex, typeIndex } from '../../content/world/tile-tables.ts';
import { animatedTile, type DynamicFrame, DynamicScene, type SceneAniTile, type SceneSoldier } from './dynamic-scene.ts';
import {
  corpseZ,
  itemZ,
  mercZ,
  onRoofZ,
  roofCorpseZ,
  roofMercZ,
  STRUCT_Z_LEVEL,
  TOPMOST_Z_LEVEL,
  worldY,
  Z_SUBLAYERS,
} from './geometry.ts';
import { DrawState, FLOATS_PER_INSTANCE, InstanceFlags } from './instances.ts';
import { prepareLevelRenderData } from './level-render-data.ts';
import type { StaticWorld } from './static-scene.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));
const surfaces: TileSurface[] = tables.types.map((t) => ({
  type: t.index,
  path: `t${t.index}.sti`,
  frames: Array.from({ length: t.count }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
  auxData: null,
  structures: null,
}));
const g = (x: number, y: number) => y * WORLD_COLS + x;
const T = (name: string, sub = 1) => ({ type: typeIndex(tables, name), subIndex: sub });

function world(
  cells: Partial<Record<(typeof LAYER_NAMES)[number], [number, { type: number; subIndex: number }[]][]>>,
  tiles: TileElement[],
) {
  const layers = Object.fromEntries(
    LAYER_NAMES.map((name) => {
      const lists = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
      for (const [at, list] of cells[name] ?? []) lists[at] = list;
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
  const prepared = prepareLevelRenderData(level, tiles, tables, info, false);
  const staticWorld: StaticWorld = {
    level,
    tiles,
    prepared,
    topY: 860,
    sprite: (tile) => ({ layer: 0, x: 0, y: tile, width: 40, height: 20, offsetX: 0, offsetY: 0, paletteBase: 0 }),
  };
  return { staticWorld, prepared };
}

const pixels = new Uint8Array(40 * 20).fill(1);
const soldier = (id: number, gridNo: number, level: number, topmost = false): SceneSoldier => ({
  id,
  gridNo,
  x: (gridNo % WORLD_COLS) * 10 + 5,
  y: Math.floor(gridNo / WORLD_COLS) * 10 + 5,
  level,
  sprite: { layer: 0, x: 0, y: 9000 + id, width: 40, height: 20, offsetX: 0, offsetY: 0, pixels },
  paletteRow: 100 + id,
  topmost,
});

function frame(overrides: Partial<DynamicFrame>): DynamicFrame {
  return {
    viewport: { width: 640, height: 360 },
    camera: { centerX: 805, centerY: 805 },
    renderHeight: 0,
    rows: { first: 140, last: 180 },
    animationStep: 0,
    showRoofs: true,
    soldiers: [],
    items: [],
    itemOutline: () => 0xffffff,
    uiNodes: [],
    aniTiles: [],
    ...overrides,
  };
}

function decode(scene: DynamicScene) {
  const d = scene.instances.data;
  return Array.from({ length: scene.instances.count }, (_, i) => ({
    tile: d[i * FLOATS_PER_INSTANCE + 5] as number,
    z: d[i * FLOATS_PER_INSTANCE + 8] as number,
    flags: d[i * FLOATS_PER_INSTANCE + 10] as number,
  }));
}

describe('dynamic scene', () => {
  const tiles = buildTileDatabase(tables, surfaces);

  it('draws ground soldiers in three parts at the merc z and roof soldiers in both roof passes', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(frame({ soldiers: [soldier(1, g(80, 80), 0), soldier(2, g(81, 80), 1)] }));
    const parts = decode(scene);
    const ground = parts.filter((p) => p.tile === 9001);
    expect(ground.map((p) => p.flags)).toEqual([
      InstanceFlags.ONLY_SHADOW_INDEX,
      InstanceFlags.EXCEPT_SHADOW_INDEX,
      InstanceFlags.EXCEPT_SHADOW_INDEX | InstanceFlags.DITHER,
    ]);
    expect(ground[0]?.z).toBe(mercZ(worldY(80, 80, 860)));
    const roof = parts.filter((p) => p.tile === 9002);
    expect(roof).toHaveLength(6);
    expect(roof[0]?.z).toBe(roofMercZ(worldY(81, 80, 860)));
    expect(scene.runs.slice(0, 3).map((r) => r.state)).toEqual([DrawState.NEARER_SHADOW, DrawState.NEARER_OR_EQUAL, DrawState.FARTHER]);
    expect(scene.placedSoldiers.map((p) => p.id)).toEqual([1, 2, 2]);
  });

  it('puts a glowing soldier at the topmost z', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(frame({ soldiers: [soldier(3, g(80, 80), 0, true)] }));
    expect(decode(scene).every((p) => p.z === TOPMOST_Z_LEVEL)).toBe(true);
  });

  it('orders UI nodes around the dynamic map nodes of their layer and tile', () => {
    const top = tileIndex(tables, 'FIRSTFULLSTRUCT1') + 1;
    const { staticWorld, prepared } = world({ structs: [[g(80, 80), [T('FIRSTFULLSTRUCT', 2)]]] }, tiles);
    expect(tiles[top]?.flags ?? 0).toBeGreaterThan(0);
    const scene = new DynamicScene(staticWorld, prepared);
    const marker = tileIndex(tables, 'FIRSTPOINTERS1');
    scene.build(
      frame({
        uiNodes: [
          { gridNo: g(80, 80), layer: 'topmost', tile: marker },
          { gridNo: g(80, 80), layer: 'object', tile: marker, head: true },
        ],
      }),
    );
    const order = decode(scene).map((p) => tables.tileNames[p.tile]);
    expect(order).toEqual(['FIRSTPOINTERS1', 'FIRSTFULLSHADOW2', 'FIRSTFULLSTRUCT2', 'FIRSTPOINTERS1']);
    expect(decode(scene).at(-1)?.z).toBe(TOPMOST_Z_LEVEL);
  });

  it('steps animated tiles every frame of the 200 ms clock', () => {
    const animated = tiles.map((t, i) =>
      i === 10 ? { ...t, flags: t.flags | TileFlags.ANIMATED, animationFrames: [10, 11, 12] } : t,
    ) as TileElement[];
    expect([0, 1, 2, 3].map((step) => animatedTile(animated, 10, step))).toEqual([10, 11, 12, 10]);
    expect(animatedTile(animated, 9, 2)).toBe(9);
  });

  it('draws at most two items per pool, dithered first and then with depth writes', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    const gun = tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'GUNS'), 1);
    scene.build(
      frame({
        items: [
          { gridNo: g(80, 80), level: 0, tile: gun },
          { gridNo: g(80, 80), level: 0, tile: gun + 1 },
          { gridNo: g(80, 80), level: 0, tile: gun + 2 },
        ],
      }),
    );
    expect(scene.itemInstances.count).toBe(4);
    expect(scene.itemRuns.map((r) => [r.state, r.count])).toEqual([
      [DrawState.FARTHER_OR_EQUAL, 2],
      [DrawState.NEARER_WRITE, 2],
    ]);
  });

  const aniTile = (kind: SceneAniTile['kind'], gridNo: number, level: number, id: number): SceneAniTile => ({
    kind,
    gridNo,
    level,
    sprite: { layer: 0, x: 0, y: 7000 + id, width: 40, height: 20, offsetX: -20, offsetY: -10 },
    paletteRow: 50 + id,
    shaded: kind !== 'smoke',
    zStrip: null,
    zTileOffsetX: 1,
    zTileOffsetY: 0,
  });

  it('draws corpses with their shadow pixels and a depth write at the corpse z of the tile to the north-west', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(
      frame({
        aniTiles: [aniTile('corpse', g(80, 80), 0, 1), aniTile('vehicleCorpse', g(82, 80), 0, 2), aniTile('corpse', g(84, 80), 1, 3)],
      }),
    );
    const parts = decode(scene);
    const corpse = parts.filter((p) => p.tile === 7001);
    expect(corpse.map((p) => p.flags)).toEqual([InstanceFlags.ONLY_SHADOW_INDEX, InstanceFlags.EXCEPT_SHADOW_INDEX]);
    expect(corpse[0]?.z).toBe(corpseZ(worldY(79, 79, 860)));
    expect(parts.find((p) => p.tile === 7002)?.z).toBe((worldY(83, 80, 860) * Z_SUBLAYERS + STRUCT_Z_LEVEL) & 0xffff);
    expect(parts.find((p) => p.tile === 7003)?.z).toBe(roofCorpseZ(worldY(84, 80, 860)));
    expect(scene.runs.slice(0, 2).map((r) => r.state)).toEqual([DrawState.NEARER_SHADOW, DrawState.NEARER_WRITE]);
  });

  it('draws animated smoke translucent at the object z, static smoke opaque, smoke on roofs at the on-roof z', () => {
    const { staticWorld, prepared } = world({}, tiles);
    const scene = new DynamicScene(staticWorld, prepared);
    scene.build(
      frame({
        aniTiles: [aniTile('smoke', g(80, 80), 0, 4), aniTile('staticSmoke', g(90, 80), 0, 5), aniTile('smoke', g(85, 80), 1, 6)],
      }),
    );
    const parts = decode(scene);
    expect(parts.find((p) => p.tile === 7004)?.z).toBe(itemZ(worldY(80, 80, 860)));
    expect(parts.find((p) => p.tile === 7006)?.z).toBe(onRoofZ(worldY(85, 80, 860)));
    const states = scene.runs.map((r) => r.state);
    expect(states).toContain(DrawState.TRANSLUCENT);
    expect(states).toContain(DrawState.NEARER_OR_EQUAL);
  });
});
