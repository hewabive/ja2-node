import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { sharedStubPackDir } from '../../../tests/support/stub-pack.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { Rng } from '../../core/rng.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { TileChangeView } from '../../protocol/view.ts';
import { ShadeChannel } from '../../render/world/instances.ts';
import { prepareLevelRenderData, updateLevelRenderData } from '../../render/world/level-render-data.ts';
import { applyTileChanges } from '../../render/world/tile-changes.ts';
import type { ShadeField } from '../../render/world/world-renderer.ts';
import { doorGridNos } from '../../sim/tactical/doors.ts';
import { initLighting, lightShadeLevel, lightTrueLevel } from '../../sim/tactical/lighting/lighting.ts';
import { createTacticalState } from '../../sim/tactical/state.ts';
import { loadItemTiles } from './item-tiles.ts';
import { LightTemplates, MERC_LIGHT } from './light-templates.ts';
import { type MercLight, surfaceAmbientAt, WorldLighting } from './world-lighting.ts';
import { type LoadedWorld, loadWorld } from './world-loader.ts';

const NIGHT = { hour: 22, minute: 0 };
const NOON = { hour: 12, minute: 0 };
const NO_DOORS = new Set<number>();
const NIGHT_LEVEL = 12;

async function openTemplates(data: DataVfs): Promise<LightTemplates> {
  return LightTemplates.load(data.vfs.list(), (path) => data.vfs.read(path));
}

async function openWorld(data: DataVfs, mapPath: string): Promise<LoadedWorld> {
  const available = new Set(data.vfs.list().map((f) => f.path));
  return loadWorld(mapPath, available, (path) => data.vfs.read(path));
}

async function gameplayLevels(world: LoadedWorld, hour: number, ambient: number, level = lightTrueLevel): Promise<Uint8Array> {
  const mapDoors = new Map(world.map.doors.map((d) => [d.gridNo, d] as const));
  const t = createTacticalState({ ...world.tactical, mapDoors }, await loadTestContent(), Rng.fromSeed(1));
  initLighting(t, world.map, hour, ambient);
  return Uint8Array.from({ length: WORLD_MAX }, (_, g) => level(t, g, 0));
}

function doorsTheMapHoldsOpen(world: LoadedWorld): Set<number> {
  const structures = world.tactical.structures;
  return new Set(
    doorGridNos(world.tactical).filter((g) => has(structures.find(g, StructureFlags.ANYDOOR)?.flags ?? 0, StructureFlags.OPEN)),
  );
}

async function expectStrongestLightRule(world: LoadedWorld, templates: LightTemplates): Promise<ShadeField> {
  const lighting = new WorldLighting(world.tactical, templates.byKey);
  const night = lighting.field({ time: NIGHT, openDoors: doorsTheMapHoldsOpen(world), mercLights: [] });
  const gameplay = await gameplayLevels(world, NIGHT.hour, lighting.ambientAt(NIGHT));
  let lit = 0;
  for (let g = 0; g < WORLD_MAX; g++) {
    expect(night.land[g]).toBeGreaterThanOrEqual(gameplay[g] ?? 0);
    if ((night.land[g] ?? 0) < night.natural) lit++;
  }
  expect(lit).toBeGreaterThan(0);
  expect(lighting.field({ time: NOON, openDoors: NO_DOORS, mercLights: [] }).land.every((s) => s === 3)).toBe(true);
  return night;
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

describe('client lighting on the stub maps', () => {
  const MAPS_WITH_LIGHTS = ['a9', 'airfield', 'camp', 'cave', 'mine', 'town', 'village'];
  let data: DataVfs;
  let templates: LightTemplates;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: sharedStubPackDir() });
    templates = await openTemplates(data);
  });

  afterAll(async () => {
    await data?.close();
  });

  it("shades the ground of every stub map with lights as the sim's strongest light per tile does", async () => {
    for (const name of MAPS_WITH_LIGHTS) {
      const world = await openWorld(data, `stubs/world/maps/${name}.dat`);
      const lighting = new WorldLighting(world.tactical, templates.byKey);
      const ambient = lighting.ambientAt(NIGHT);
      const night = lighting.field({ time: NIGHT, openDoors: doorsTheMapHoldsOpen(world), mercLights: [] });
      const gameplay = await gameplayLevels(world, NIGHT.hour, ambient, lightShadeLevel);
      const differing = Array.from({ length: WORLD_MAX }, (_, g) => g).filter((g) => night.land[g] !== gameplay[g]);
      expect(differing, name).toEqual([]);
      expect(
        night.land.some((shade) => shade < night.natural),
        name,
      ).toBe(true);
    }
  });
});

describe('client lighting on the stub village', () => {
  const WALL = 72 * 160 + 123;
  const WINDOW = 72 * 160 + 124;
  let data: DataVfs;
  let world: LoadedWorld;
  let templates: LightTemplates;
  const mercLight = () => {
    const template = templates.resolve(MERC_LIGHT)?.template;
    if (!template) throw new Error('no merc light in the stub pack');
    return template;
  };

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: sharedStubPackDir() });
    world = await openWorld(data, 'stubs/world/maps/village.dat');
    templates = await openTemplates(data);
  });

  afterAll(async () => {
    await data?.close();
  });

  it('shades by the strongest light, never brighter than the gameplay level', async () => {
    await expectStrongestLightRule(world, templates);
  });

  it("lights the tile of an own merc at night with the stub pack's merc light", () => {
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const g = 80 * 160 + 72;
    expect(templates.resolve(MERC_LIGHT)?.origin).toBe('stubs');
    const without = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [] }).land[g] ?? 0;
    const merc = lighting.field({
      time: NIGHT,
      openDoors: NO_DOORS,
      mercLights: [{ x: 725, y: 805, level: 0, template: mercLight() }],
    });
    expect(merc.land[g]).toBeLessThan(without);
    expect(lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [] }).land[g]).toBe(without);
  });

  it("keeps the roof light of each merc's light on a roof, which a roof node drawn under it takes, and none for a merc on the ground", () => {
    const template = mercLight();
    const roofed = Array.from({ length: WORLD_MAX }, (_, g) => g).find((g) => levelTilesAt(world.level.layers.roofs, g).length > 0);
    if (roofed === undefined) throw new Error('no roof on the stub village');
    const at = { x: (roofed % 160) * 10 + 5, y: Math.floor(roofed / 160) * 10 + 5, template };
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const onRoof = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [{ soldier: 7, level: 1, ...at }] });
    const amount = lighting.mercRoofLights.get(7)?.roof.get(roofed) ?? 0;
    expect(amount).toBeGreaterThan(0);
    expect(onRoof.roof[roofed]).toBe(Math.max(1, onRoof.natural - amount));
    lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [{ soldier: 7, level: 0, ...at }] });
    expect(lighting.mercRoofLights.get(7)?.roof.size).toBe(0);
  });

  it('lights the map lights the view reports powered instead of those the hour would power, as a cave light sight switched on', () => {
    const lamp = world.map.lights?.sprites[0];
    if (!lamp) throw new Error('no stub lamp');
    const template = templates.resolve(lamp.template)?.template;
    if (!template) throw new Error('no lamp template');
    const g = lamp.y * 160 + lamp.x;
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const byTheHour = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [] }).land[g] ?? 0;
    const switchedOff = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mapLights: [], mercLights: [] }).land[g];
    const switchedOn = (time: typeof NOON) =>
      lighting.field({ time, openDoors: NO_DOORS, mapLights: [{ x: lamp.x, y: lamp.y, roof: false, template }], mercLights: [] }).land[g];
    expect(byTheHour).toBeLessThan(12);
    expect(switchedOff).toBe(12);
    expect(switchedOn(NIGHT)).toBe(byTheHour);
    expect(switchedOn(NOON)).toBeLessThan(3);
  });

  it('lets a light drawn after a wall was destroyed pass where it stood, while a light drawn before keeps its shadow until it is drawn again', () => {
    const behind = 70 * 160 + 123;
    const wallTile = levelTilesAt(world.level.layers.structs, WALL)[0];
    if (wallTile === undefined) throw new Error('no stub wall');
    const destroyed: readonly TileChangeView[] = [{ kind: 'remove', gridNo: WALL, level: 0, tile: wallTile }];
    const mercSouthOfTheWall: readonly MercLight[] = [{ x: 1235, y: 745, level: 0, template: mercLight() }];
    const at = (lighting: WorldLighting, mercLights: readonly MercLight[], tileChanges: readonly TileChangeView[] = []) =>
      lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights, tileChanges }).land[behind];
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const shadowed = at(lighting, mercSouthOfTheWall);
    expect(at(lighting, mercSouthOfTheWall, destroyed)).toBe(shadowed);
    at(lighting, [], destroyed);
    const passing = at(lighting, mercSouthOfTheWall, destroyed);
    expect(passing).toBeLessThan(shadowed ?? 0);
    expect(at(new WorldLighting(world.tactical, templates.byKey), mercSouthOfTheWall, destroyed)).toBe(passing);
  });

  it('lights the struct nodes and a corpse of a wall tile from either side, and its ground only from the side the step does not cross the wall', () => {
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const lit = (y: number) =>
      lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [{ x: 1235, y, level: 0, template: mercLight() }] });
    const north = lit(705);
    const south = lit(745);
    for (const side of [north, south]) {
      expect(side.channels[ShadeChannel.STRUCT]?.[WALL]).toBeLessThan(side.natural);
      expect(side.channels[ShadeChannel.ANIMATION]?.[WALL]).toBeLessThan(side.natural);
    }
    expect([north.land[WALL], south.land[WALL]].filter((shade) => shade === NIGHT_LEVEL)).toHaveLength(1);
  });

  it("lights a window tile's struct nodes, objects and soldiers but not its ground from across its wall, and the tiles beyond it", () => {
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const across = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [{ x: 1245, y: 745, level: 0, template: mercLight() }] });
    expect(across.land[WINDOW]).toBe(across.natural);
    for (const shades of [across.channels[ShadeChannel.STRUCT], across.channels[ShadeChannel.OBJECT], across.mercs])
      expect(shades?.[WINDOW]).toBeLessThan(across.natural);
    expect(across.land[WINDOW - 160]).toBeLessThan(across.natural);
  });

  it("gives a soldier's node 7/10 of a step on a ray that ends south-east of the light, and the ground the full light", () => {
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const field = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [{ x: 725, y: 805, level: 0, template: mercLight() }] });
    const southEast = 82 * 160 + 74;
    const northWest = 78 * 160 + 70;
    expect(field.mercs[southEast]).toBeGreaterThan(field.land[southEast] ?? 0);
    expect(field.mercs[northWest]).toBe(field.land[northWest]);
  });

  it("gives a wall the strongest light that reaches it, not the lights' sum", () => {
    const template = mercLight();
    const lighting = new WorldLighting(world.tactical, templates.byKey);
    const near = { x: 1235, y: 735, level: 0, template };
    const far = { x: 1235, y: 755, level: 0, template };
    const wallShade = (mercLights: readonly MercLight[]) =>
      lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights }).channels[ShadeChannel.STRUCT]?.[WALL] ?? 0;
    const natural = lighting.field({ time: NIGHT, openDoors: NO_DOORS, mercLights: [] }).natural;
    const [nearOnly, farOnly, both] = [wallShade([near]), wallShade([far]), wallShade([near, far])];
    expect(farOnly).toBeLessThan(natural);
    expect(nearOnly).toBeLessThan(farOnly);
    expect(both).toBe(nearOnly);
  });

  it('updates the shadows of patched tiles as a full preparation would', () => {
    let at = 0;
    while (levelTilesAt(world.level.layers.structs, at).length === 0) at++;
    const tile = levelTilesAt(world.level.layers.structs, at)[0] as number;
    const level = applyTileChanges(world.level, [{ kind: 'remove', gridNo: at, level: 0, tile }]);
    const full = prepareLevelRenderData(level, world.tiles, world.tables, world.map.info, world.underground);
    const local = updateLevelRenderData(world.prepared, level, world.tiles, world.tables, new Set([at]), world.prepared.noBurn);
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

describe.skipIf(!ORIGINAL_DATA_DIR)('client lighting on original maps', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });

  afterAll(async () => {
    await data?.close();
  });

  it('shades the lamps of D13 by the strongest light', async () => {
    await expectStrongestLightRule(await openWorld(data, 'maps/d13.dat'), await openTemplates(data));
  });

  it("keeps the tile outside the east window of D13's church at the natural level: the window passes the lamp inside only into its own tile", async () => {
    const OUTSIDE_THE_WINDOW = 79 * 160 + 61;
    const world = await openWorld(data, 'maps/d13.dat');
    const night = await expectStrongestLightRule(world, await openTemplates(data));
    const gameplay = await gameplayLevels(world, NIGHT.hour, night.ambient);
    expect([gameplay[OUTSIDE_THE_WINDOW], night.land[OUTSIDE_THE_WINDOW]]).toEqual([night.natural, night.natural]);
  });
});
