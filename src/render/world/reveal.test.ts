import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStubs } from '../../../stubs/build.ts';
import { type LoadedWorld, loadWorld } from '../../app/world/world-loader.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { typeIndex } from '../../content/world/tile-tables.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { rowOf } from './geometry.ts';
import { changedRevealTiles, computeReveal, NO_REVEAL, NodeFlags } from './reveal.ts';
import { StaticScene, StaticSegment, type StaticWorld } from './static-scene.ts';

const ROOM = 1;

describe('revealed rooms on the stub village', () => {
  let dir = '';
  let data: DataVfs;
  let world: LoadedWorld;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-reveal-'));
    await buildStubs(dir);
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: dir });
    const available = new Set(data.vfs.list().map((f) => f.path));
    world = await loadWorld('stubs/world/maps/village.dat', available, (path) => data.vfs.read(path));
  }, 60_000);

  afterAll(async () => {
    await data?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const revealWorld = () => ({
    level: world.level,
    tiles: world.tiles,
    tables: world.tables,
    structures: world.structures,
    basement: false,
  });
  const roomTiles = () => Array.from({ length: WORLD_MAX }, (_, g) => g).filter((g) => world.level.rooms[g] === ROOM);

  it('hides the roof of a revealed room and patches only the rows it touches', () => {
    const firstRoof = typeIndex(world.tables, 'FIRSTROOF');
    const revealed = computeReveal(revealWorld(), new Set([ROOM]));
    const tiles = roomTiles();
    expect(tiles.length).toBeGreaterThan(0);
    for (const g of tiles) {
      expect(revealed.revealed[g]).toBe(1);
      levelTilesAt(world.level.layers.roofs, g).forEach((t, i) => {
        if (world.tiles[t]?.type === firstRoof) expect(revealed.nodeFlags('roofs', g, i) & NodeFlags.HIDDEN).toBe(NodeFlags.HIDDEN);
      });
    }
    const changed = changedRevealTiles(computeReveal(revealWorld(), new Set()), revealed, world.level);
    expect(changed.length).toBeGreaterThan(0);
    expect(new Set(changed.map(rowOf)).size).toBeLessThan(80);
    const staticWorld: StaticWorld = {
      level: world.level,
      tiles: world.tiles,
      prepared: world.prepared,
      topY: 860,
      sprite: (tile) => ({ layer: 0, x: 0, y: tile, width: 40, height: 20, offsetX: 0, offsetY: 0, paletteBase: 0 }),
    };
    const state = { reveal: NO_REVEAL, openDoors: new Set<number>(), treeTops: true, wireframes: true, roofLevel: false };
    const scene = new StaticScene(staticWorld, state);
    const roofsBefore = roofCount(scene);
    scene.setState({ ...state, reveal: revealed }, changed.map(rowOf));
    expect(roofCount(scene)).toBeLessThan(roofsBefore);
    expect(roofCount(new StaticScene(staticWorld, { ...state, reveal: revealed }))).toBe(roofCount(scene));
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('wireframes on A9', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
  }, 60_000);

  afterAll(async () => {
    await data?.close();
  });

  it('outlines unrevealed buildings with mandatory wireframes and makes revealed walls follow the option', async () => {
    const available = new Set(data.vfs.list().map((f) => f.path));
    const w = await loadWorld('maps/a9.dat', available, (path) => data.vfs.read(path));
    const input = { level: w.level, tiles: w.tiles, tables: w.tables, structures: w.structures, basement: false };
    const hidden = computeReveal(input, new Set());
    const wired = [...hidden.touched].filter((g) => hidden.wireframes(g).length > 0);
    expect(wired.length).toBeGreaterThan(50);
    expect(wired.every((g) => hidden.wireframes(g).every((n) => !n.optional))).toBe(true);
    const rooms = new Set([...w.level.rooms].filter((r) => r !== 0));
    const open = computeReveal(input, rooms);
    expect([...open.touched].some((g) => open.wireframes(g).some((n) => n.optional))).toBe(true);
  }, 60_000);
});

function roofCount(scene: StaticScene): number {
  const a = scene.assemble();
  return (a.segmentStart[StaticSegment.ROOFS + 1] ?? 0) - (a.segmentStart[StaticSegment.ROOFS] ?? 0);
}
