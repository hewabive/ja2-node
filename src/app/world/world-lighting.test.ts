import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStubs } from '../../../stubs/build.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { Rng } from '../../core/rng.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { prepareLevelRenderData, updateLevelRenderData } from '../../render/world/level-render-data.ts';
import { applyTileChanges } from '../../render/world/tile-changes.ts';
import { initLighting, lightTrueLevel } from '../../sim/tactical/lighting/lighting.ts';
import { createTacticalState } from '../../sim/tactical/state.ts';
import { loadItemTiles } from './item-tiles.ts';
import { LightTemplates, MERC_LIGHT } from './light-templates.ts';
import { surfaceAmbientAt, WorldLighting } from './world-lighting.ts';
import { type LoadedWorld, loadWorld } from './world-loader.ts';

const NIGHT = { hour: 22, minute: 0 };
const NOON = { hour: 12, minute: 0 };
const NO_DOORS = new Set<number>();

async function openWorld(data: DataVfs, mapPath: string): Promise<LoadedWorld> {
  const available = new Set(data.vfs.list().map((f) => f.path));
  return loadWorld(mapPath, available, (path) => data.vfs.read(path));
}

async function gameplayLevels(world: LoadedWorld, hour: number, ambient: number): Promise<Uint8Array> {
  const mapDoors = new Map(world.map.doors.map((d) => [d.gridNo, d] as const));
  const t = createTacticalState({ ...world.tactical, mapDoors }, await loadTestContent(), Rng.fromSeed(1));
  initLighting(t, world.map, hour, ambient);
  return Uint8Array.from({ length: WORLD_MAX }, (_, g) => lightTrueLevel(t, g, 0));
}

async function expectStrongestLightRule(world: LoadedWorld): Promise<void> {
  const lighting = new WorldLighting(world.tactical);
  const night = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [] });
  const gameplay = await gameplayLevels(world, NIGHT.hour, lighting.ambientAt(NIGHT));
  let lit = 0;
  for (let g = 0; g < WORLD_MAX; g++) {
    expect(night.land[g]).toBeGreaterThanOrEqual(gameplay[g] ?? 0);
    if ((night.land[g] ?? 0) < night.natural) lit++;
  }
  expect(lit).toBeGreaterThan(0);
  expect(lighting.field({ time: NOON, openDoors: NO_DOORS, mercLights: [] }).land.every((s) => s === 3)).toBe(true);
}

describe('the client ambient level follows the dawn and dusk schedule', () => {
  it('ramps between night 12 and day 3', () => {
    expect(
      [
        [6, 46],
        [6, 47],
        [7, 3],
        [12, 0],
        [20, 57],
        [21, 13],
      ].map(([hour, minute]) => surfaceAmbientAt({ hour: hour ?? 0, minute: minute ?? 0 })),
    ).toEqual([12, 11, 3, 3, 4, 12]);
  });
});

describe('client lighting on the stub village', () => {
  let dir = '';
  let data: DataVfs;
  let world: LoadedWorld;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-world-lighting-'));
    await buildStubs(dir);
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: dir });
    world = await openWorld(data, 'stubs/world/maps/village.dat');
  }, 60_000);

  afterAll(async () => {
    await data?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('shades by the strongest light, never brighter than the gameplay level', async () => {
    await expectStrongestLightRule(world);
  });

  it('lights the tile of an own merc at night with the merc light stand-in', () => {
    const lighting = new WorldLighting(world.tactical);
    const g = 80 * 160 + 72;
    const template = new LightTemplates().resolve(MERC_LIGHT);
    if (!template) throw new Error('no stand-in');
    expect(template.origin).toBe('standIn');
    const without = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [] }).land[g] ?? 0;
    const merc = lighting.field({
      time: NIGHT,
      openDoors: NO_DOORS,
      mercLights: [{ x: 725, y: 805, level: 0, template: template.template }],
    });
    expect(merc.land[g]).toBeLessThan(without);
    expect(lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [] }).land[g]).toBe(without);
  });

  it('updates the level render data of patched tiles as a full preparation would', () => {
    let at = 0;
    while (levelTilesAt(world.level.layers.structs, at).length === 0) at++;
    const tile = levelTilesAt(world.level.layers.structs, at)[0] as number;
    const level = applyTileChanges(world.level, [{ kind: 'remove', gridNo: at, level: 0, tile }]);
    const full = prepareLevelRenderData(level, world.tiles, world.tables, world.map.info, world.underground);
    const local = updateLevelRenderData(world.prepared, level, world.tiles, world.tables, new Set([at]));
    expect(local.noBurn).toEqual(full.noBurn);
    expect(local.shadows.offsets).toEqual(full.shadows.offsets);
    expect(local.shadows.tiles).toEqual(full.shadows.tiles);
  });

  it('resolves item names to their world tile graphics', async () => {
    const lookup = await loadItemTiles(world.tables, (path) => data.vfs.read(path));
    const start = world.tables.types.find((t) => t.name === 'GUNS')?.start ?? -1;
    expect(lookup('GLOCK_17')).toBe(start + 1);
    expect(lookup('NO_SUCH_ITEM')).toBeNull();
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('client lighting on original maps', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
  }, 60_000);

  afterAll(async () => {
    await data?.close();
  });

  it('shades the lamps of D13 by the strongest light', async () => {
    await expectStrongestLightRule(await openWorld(data, 'maps/d13.dat'));
  }, 60_000);
});
