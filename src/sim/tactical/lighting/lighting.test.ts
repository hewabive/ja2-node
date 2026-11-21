import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../../tests/support/combat.ts';
import { loadTestContent, readDataJson, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { LightTime, parseMap, writeMap } from '../../../content/formats/map.ts';
import { parseStubMapSource, stubMapToMapDef } from '../../../content/formats/stub-map.ts';
import { Direction, gridNo, WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import { LIGHT_NEW_RAY } from '../../../content/world/light-templates.ts';
import { compileWorldMovementCosts } from '../../../content/world/movement-costs.ts';
import { StructureFlags, structureHeight, type WorldStructures } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import { parseTileTables, TILE_TABLES_PATH } from '../../../content/world/tile-tables.ts';
import { Rng } from '../../../core/rng.ts';
import type { TacticalContent } from '../content.ts';
import { createTacticalState, type TacticalState } from '../state.ts';
import {
  initLighting,
  type LightSprite,
  LightSpriteFlags,
  LitNodes,
  lightSetBaseLevel,
  lightShadeLevel,
  lightSpriteCreate,
  lightSpriteDestroy,
  lightSpriteFromTemplate,
  lightSpritePosition,
  lightSpritePower,
  lightSpriteRenderAll,
  lightTimeAt,
  lightTrueLevel,
  NORMAL_LIGHTLEVEL_DAY,
  NORMAL_LIGHTLEVEL_NIGHT,
  switchOnCaveLightAt,
  traceLitTiles,
  turnOffNightLights,
  turnOnNightLights,
} from './lighting.ts';

const NIGHT = NORMAL_LIGHTLEVEL_NIGHT;
const X = 80;
const Y = 80;
let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function tactical(place: (s: WorldStructures) => void = () => {}, roofs: ReadonlySet<number> = new Set()): TacticalState {
  const w = syntheticWorld(testDoorCosts(), place, roofs);
  const t = createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(5));
  lightSetBaseLevel(t, NIGHT);
  return t;
}

function lamp(t: TacticalState, name: string, x = X, y = Y): LightSprite {
  const l = lightSpriteCreate(t, name);
  if (!l) throw new Error(`no template ${name}`);
  lightSpritePower(l, true);
  lightSpritePosition(t, l, x, y);
  return l;
}

const level = (t: TacticalState, x: number, y: number, z = 0) => lightTrueLevel(t, gridNo(x, y), z);
const row = (t: TacticalState, y: number, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => level(t, from + i, y));

describe('light sprites', () => {
  it('brightens tiles by the template intensity that decays with distance', () => {
    const t = tactical();
    lamp(t, 'L-R03.LHT');
    expect(row(t, Y, X - 4, X + 4)).toEqual([12, 11, 10, 9, 9, 9, 10, 11, 12]);
    expect(level(t, X, Y - 3)).toBe(11);
  });

  it('never goes brighter than shade 1 and leaves the natural level without lights', () => {
    const t = tactical();
    lamp(t, 'L-R08.LHT');
    lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_DAY);
    expect(level(t, X, Y)).toBe(1);
    expect(level(t, X + 30, Y)).toBe(NORMAL_LIGHTLEVEL_DAY);
  });

  it('adds overlapping lights and removes a destroyed one', () => {
    const t = tactical();
    const a = lamp(t, 'L-R03.LHT');
    lamp(t, 'L-R03.LHT', X + 2, Y);
    expect(level(t, X + 1, Y)).toBe(NIGHT - 6);
    lightSpriteDestroy(t, a);
    expect(level(t, X + 1, Y)).toBe(NIGHT - 3);
    expect(level(t, X - 2, Y)).toBe(NIGHT);
  });

  it('draws a tile in the shade of its strongest light, cut to the light left when a light goes out even if no light left is that strong', () => {
    const t = tactical();
    const strong = lamp(t, 'L-R03.LHT');
    lamp(t, 'L-R03.LHT', X - 3, Y);
    lamp(t, 'L-R03.LHT', X + 3, Y);
    const shade = () => lightShadeLevel(t, gridNo(X, Y), 0);
    expect([level(t, X, Y), shade()]).toEqual([NIGHT - 5, NIGHT - 3]);
    lightSpriteDestroy(t, strong);
    expect([level(t, X, Y), shade()]).toEqual([NIGHT - 2, NIGHT - 2]);
    lightSpriteRenderAll(t);
    expect([level(t, X, Y), shade()]).toEqual([NIGHT - 2, NIGHT - 1]);
  });

  it('moves a light by erasing it and drawing it again', () => {
    const t = tactical();
    const l = lamp(t, 'L-R02.LHT');
    lightSpritePosition(t, l, X + 10, Y);
    expect(level(t, X, Y)).toBe(NIGHT);
    expect(level(t, X + 10, Y)).toBe(NIGHT - 2);
  });

  it('stops at a wall but lights nothing beyond it', () => {
    const wallAt = gridNo(X + 2, Y);
    const t = tactical((s) => {
      s.add(wallAt, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT));
    });
    lamp(t, 'L-R05.LHT');
    expect(level(t, X + 1, Y)).toBeLessThan(NIGHT);
    expect(row(t, Y, X + 3, X + 6)).toEqual([NIGHT, NIGHT, NIGHT, NIGHT]);
  });

  it('keeps the light of a sprite drawn before a structure appears until the lights are rendered again', () => {
    const t = tactical();
    lamp(t, 'L-R05.LHT');
    const lit = row(t, Y, X + 3, X + 6);
    t.world.structures.add(gridNo(X + 2, Y), 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT));
    t.world.costs.replaceWith(compileWorldMovementCosts(t.world).values);
    expect(row(t, Y, X + 3, X + 6)).toEqual(lit);
    lightSpriteRenderAll(t);
    expect(row(t, Y, X + 3, X + 6)).toEqual([NIGHT, NIGHT, NIGHT, NIGHT]);
  });

  it('erases a light along the walls standing now, so a wall that appears after the draw leaves the light that passed it until the next render', () => {
    const t = tactical();
    const l = lamp(t, 'L-R05.LHT');
    const lit = row(t, Y, X + 3, X + 6);
    t.world.structures.add(gridNo(X + 2, Y), 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT));
    t.world.costs.replaceWith(compileWorldMovementCosts(t.world).values);
    lightSpriteDestroy(t, l);
    expect(row(t, Y, X + 3, X + 6)).toEqual(lit);
    expect(level(t, X - 3, Y)).toBe(NIGHT);
    lightSpriteRenderAll(t);
    expect(row(t, Y, X + 3, X + 6)).toEqual([NIGHT, NIGHT, NIGHT, NIGHT]);
  });

  it('lets light pass a tall obstacle, whatever its height cache', () => {
    const obstacleAt = gridNo(X + 2, Y);
    const t = tactical((s) => {
      s.add(obstacleAt, 0, syntheticStructure(StructureFlags.GENERIC));
    });
    for (const s of t.world.structures.at(obstacleAt)) structureHeight(s);
    lamp(t, 'L-R05.LHT');
    expect(row(t, Y, X + 2, X + 4).every((v) => v < NIGHT)).toBe(true);
  });

  it('ends a ray at a tile higher than the step before it, which stays dark', () => {
    const t = tactical();
    t.world.level.heights[gridNo(X + 1, Y)] = 10;
    lamp(t, 'L-R03.LHT');
    expect(level(t, X + 1, Y)).toBe(NIGHT);
    expect(level(t, X + 2, Y)).toBe(NIGHT);
  });

  it('lights nothing past the edges of the map (MAPROWCOLTOPOS)', () => {
    const t = tactical();
    lamp(t, 'L-R03.LHT', WORLD_COLS - 2, Y);
    expect(level(t, WORLD_COLS - 1, Y)).toBeLessThan(NIGHT);
    expect([level(t, 0, Y + 1), level(t, 1, Y + 1)]).toEqual([NIGHT, NIGHT]);
  });

  it('reads the roof level from roof tiles only', () => {
    const roof = gridNo(X, Y);
    const t = tactical(() => {}, new Set([roof]));
    lamp(t, 'L-R03.LHT');
    expect(level(t, X, Y, 1)).toBe(NIGHT);
    lightSetBaseLevel(t, 0);
    expect(level(t, X, Y, 1)).toBe(1);
    expect(level(t, X + 1, Y, 1)).toBe(0);
  });

  it('finds a template by its file name in any case, and no other', () => {
    const t = tactical();
    expect(lightSpriteCreate(t, 'light3')?.template.name).toBe('Light3');
    expect(lightSpriteCreate(t, 'l-r03.lht')?.template.name).toBe('L-R03.LHT');
    expect(lightSpriteCreate(t, 'Light9')).toBeNull();
  });
});

describe('the nodes a light step reaches (LightAddTile)', () => {
  const WALL_AT = gridNo(X, Y - 2);
  const OPEN_DOOR_ONE_TILE_WEST = 230;
  const EVERYTHING = LitNodes.LAND | LitNodes.STRUCTS | LitNodes.OBJECTS | LitNodes.MERCS | LitNodes.ANIMATIONS;
  const WALLS_AND_ANIMATIONS = LitNodes.STRUCTS | LitNodes.ANIMATIONS;
  interface Visit {
    readonly amount: number;
    readonly mercAmount: number;
    readonly nodes: number;
  }
  const visitsAt = (t: TacticalState, l: LightSprite, g: number): Visit[] => {
    const visits: Visit[] = [];
    traceLitTiles(t, l, (at, amount, mercAmount, nodes) => {
      if (at === g) visits.push({ amount, mercAmount, nodes });
    });
    return visits;
  };
  const nodesAt = (t: TacticalState, l: LightSprite, g: number) => visitsAt(t, l, g).map((v) => v.nodes);
  const windowRow = (s: WorldStructures) => {
    for (let x = X - 4; x <= X + 4; x++)
      s.add(gridNo(x, Y - 2), 0, syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.OUTSIDE_LEFT));
  };

  it('lights the ground, every struct node, the objects, the mercs and the animation tiles of a tile an open step reaches, once', () => {
    const t = tactical((s) => s.add(WALL_AT, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT)));
    expect(nodesAt(t, lamp(t, 'L-R05.LHT', X, Y - 5), gridNo(X, Y - 3))).toEqual([EVERYTHING]);
  });

  it('lights only the struct nodes and the animation tiles of a tile a step reaches across a wall, and ends the ray there', () => {
    const t = tactical((s) => s.add(WALL_AT, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT)));
    const l = lamp(t, 'L-R05.LHT');
    expect(nodesAt(t, l, WALL_AT)).toEqual([WALLS_AND_ANIMATIONS]);
    expect(level(t, X, Y - 2)).toBe(NIGHT);
    expect(level(t, X, Y - 3)).toBe(NIGHT);
  });

  it('lights only the animation tiles of a raised tile it reaches without crossing a wall, as a corpse there', () => {
    const t = tactical();
    t.world.level.heights[gridNo(X + 1, Y)] = 10;
    expect(nodesAt(t, lamp(t, 'L-R03.LHT'), gridNo(X + 1, Y))).toEqual([LitNodes.ANIMATIONS]);
  });

  it("lights a window tile's struct nodes, objects and mercs but not its ground on a step across its wall, and lets the ray go on", () => {
    const t = tactical(windowRow);
    const l = lamp(t, 'L-R05.LHT');
    expect(nodesAt(t, l, WALL_AT)).toEqual([EVERYTHING & ~LitNodes.LAND]);
    expect(level(t, X, Y - 2)).toBe(NIGHT);
    expect(level(t, X, Y - 3)).toBeLessThan(NIGHT);
  });

  it('blocks a step out of a window tile across its wall, so a window passes light only into its own tile', () => {
    const t = tactical(windowRow);
    const l = lamp(t, 'L-R05.LHT', X, Y - 4);
    expect(level(t, X, Y - 2)).toBeLessThan(NIGHT);
    expect(nodesAt(t, l, gridNo(X, Y - 1))).toEqual([WALLS_AND_ANIMATIONS]);
    expect(row(t, Y - 1, X - 2, X + 2)).toEqual(Array(5).fill(NIGHT));
  });

  it("lets light through an open door's swing tile, which keeps the door code (InternalDoorTravelCost)", () => {
    const t = tactical((s) => {
      s.add(gridNo(X - 1, Y - 2), 0, syntheticStructure(StructureFlags.DOOR | StructureFlags.OPEN, Orientation.INSIDE_RIGHT));
    });
    t.world.costs.force(WALL_AT, Direction.NORTH, 0, OPEN_DOOR_ONE_TILE_WEST);
    const l = lamp(t, 'L-R05.LHT');
    expect(nodesAt(t, l, WALL_AT)).toEqual([EVERYTHING]);
    expect(level(t, X, Y - 3)).toBeLessThan(NIGHT);
  });

  it('gives a merc node 7/10 of a step on a ray that ends south-east of the light (LIGHT_BACKLIGHT), and the full light elsewhere', () => {
    const t = tactical();
    const l = lamp(t, 'L-R05.LHT');
    const [south] = visitsAt(t, l, gridNo(X + 2, Y + 2));
    expect(south).toMatchObject({ mercAmount: Math.trunc(((south?.amount ?? 0) * 7) / 10) });
    expect(south?.mercAmount).toBeLessThan(south?.amount ?? 0);
    const [north] = visitsAt(t, l, gridNo(X - 2, Y - 2));
    expect(north?.mercAmount).toBe(north?.amount);
  });

  it('lights a template node once, by the first ray that reaches it, even a blocked ray that lit only its walls', () => {
    const t = tactical((s) => s.add(gridNo(X, Y), 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT)));
    const template = {
      name: 'TWO-RAYS',
      lights: [
        { dx: 0, dy: 0, light: 0 },
        { dx: 0, dy: 0, light: 3 },
        { dx: 1, dy: 0, light: 2 },
        { dx: 0, dy: 1, light: 2 },
        { dx: 1, dy: 1, light: 1 },
      ],
      rays: [LIGHT_NEW_RAY, 1, 2, LIGHT_NEW_RAY, 1, 3, 4, 2],
    };
    const l = lightSpriteFromTemplate(t, template);
    if (!l) throw new Error('no sprite');
    lightSpritePower(l, true);
    lightSpritePosition(t, l, X, Y);
    expect([level(t, X, Y + 1), level(t, X + 1, Y + 1)]).toEqual([NIGHT - 2, NIGHT - 1]);
    expect(level(t, X + 1, Y)).toBe(NIGHT);
    expect(nodesAt(t, l, gridNo(X + 1, Y))).toEqual([WALLS_AND_ANIMATIONS]);
  });

  it('lights the walls and the ground of a cave tile a step reaches across a wall', () => {
    const t = tactical((s) => s.add(WALL_AT, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT)));
    t.lighting.caves = true;
    const l = lamp(t, 'L-R05.LHT');
    expect(nodesAt(t, l, WALL_AT)).toEqual([WALLS_AND_ANIMATIONS]);
    expect(nodesAt(t, l, gridNo(X, Y - 1))).toEqual([EVERYTHING]);
  });
});

describe('map lights and the clock', () => {
  const map = {
    ambient: null,
    lights: {
      colors: [[0, 0, 0] as const],
      sprites: [
        { x: X, y: Y, flags: LightTime.NIGHT_TIME, template: 'L-R03.LHT' },
        { x: X + 20, y: Y, flags: LightTime.PRIME_TIME, template: 'L-R03.LHT' },
        { x: X + 40, y: Y, flags: 0, template: 'L-R03.LHT' },
      ],
    },
  };

  it('powers night lights from 21:00 to 7:00 and prime-time lights until midnight', () => {
    expect([12, 21, 23, 0, 6, 7].map(lightTimeAt)).toEqual([
      0,
      LightTime.NIGHT_TIME | LightTime.PRIME_TIME,
      LightTime.NIGHT_TIME | LightTime.PRIME_TIME,
      LightTime.NIGHT_TIME,
      LightTime.NIGHT_TIME,
      0,
    ]);
    const t = tactical();
    initLighting(t, map, 2, NIGHT);
    expect([level(t, X, Y), level(t, X + 20, Y), level(t, X + 40, Y)]).toEqual([NIGHT - 3, NIGHT, NIGHT - 3]);
    initLighting(t, map, 12, NORMAL_LIGHTLEVEL_DAY);
    expect([level(t, X, Y), level(t, X + 20, Y), level(t, X + 40, Y)]).toEqual([3, 3, 1]);
  });

  it('switches scheduled lights by power only, so they show after the next render', () => {
    const t = tactical();
    initLighting(t, map, 12, NIGHT);
    turnOnNightLights(t);
    expect(level(t, X, Y)).toBe(NIGHT);
    lightSetBaseLevel(t, NIGHT);
    expect(level(t, X, Y)).toBe(NIGHT - 3);
    turnOffNightLights(t);
    expect(level(t, X, Y)).toBe(NIGHT - 3);
    lightSpriteRenderAll(t);
    expect(level(t, X, Y)).toBe(NIGHT);
  });

  it('tells every set of the base light, the level unchanged too, which draws every light again (LightSetBaseLevel)', () => {
    const sim = newCombatSim(content);
    sim.drainEvents();
    sim.setAmbientLight(NORMAL_LIGHTLEVEL_DAY);
    sim.setAmbientLight(NORMAL_LIGHTLEVEL_DAY);
    expect(sim.drainEvents().filter((e) => e.type === 'ambientLightSet')).toMatchObject([
      { level: NORMAL_LIGHTLEVEL_DAY },
      { level: NORMAL_LIGHTLEVEL_DAY },
    ]);
  });

  it('takes the ambient level of an underground map and keeps cave lights off', () => {
    const t = tactical();
    initLighting(t, { ...map, ambient: { basement: false, caves: true, lightLevel: 9 } }, 2, NORMAL_LIGHTLEVEL_DAY);
    expect(t.lighting.ambient).toBe(9);
    expect(t.lighting.underground).toBe(true);
    for (let g = 0; g < WORLD_MAX; g += 997) expect(lightTrueLevel(t, g, 0)).toBe(9);
  });
});

describe('cave lights (Fog_Of_War.cc RemoveFogFromGridNo)', () => {
  const CAVES = { basement: false, caves: true, lightLevel: 11 };
  const twoLampsOnOneTile = {
    colors: [[0, 0, 0] as const],
    sprites: [
      { x: X, y: Y, flags: 0, template: 'L-R03.LHT' },
      { x: X, y: Y, flags: 0, template: 'L-R03.LHT' },
      { x: X + 20, y: Y, flags: 0, template: 'L-R03.LHT' },
    ],
  };
  const powered = (t: TacticalState) => t.lighting.sprites.flatMap((l) => (l ? [(l.flags & LightSpriteFlags.ON) !== 0] : []));

  it('switches on one unlit light of the tile per reveal and draws it at once, without waiting for a render', () => {
    const t = tactical();
    initLighting(t, { ambient: CAVES, lights: twoLampsOnOneTile }, 12, NORMAL_LIGHTLEVEL_DAY);
    expect(powered(t)).toEqual([false, false, false]);
    switchOnCaveLightAt(t, gridNo(X, Y));
    expect(powered(t)).toEqual([true, false, false]);
    expect(level(t, X, Y)).toBe(CAVES.lightLevel - 3);
    switchOnCaveLightAt(t, gridNo(X, Y));
    switchOnCaveLightAt(t, gridNo(X, Y));
    expect(powered(t)).toEqual([true, true, false]);
    expect(level(t, X, Y)).toBe(CAVES.lightLevel - 6);
  });

  it('leaves the lights of a basement and of the surface alone', () => {
    for (const ambient of [{ ...CAVES, caves: false, basement: true }, null]) {
      const t = tactical();
      initLighting(
        t,
        { ambient, lights: { ...twoLampsOnOneTile, sprites: [{ x: X, y: Y, flags: LightTime.NIGHT_TIME, template: 'L-R03.LHT' }] } },
        12,
        NIGHT,
      );
      switchOnCaveLightAt(t, gridNo(X, Y));
      expect(powered(t)).toEqual([false]);
    }
  });
});

describe('the stub village', () => {
  const source = readFileSync(join(import.meta.dirname, '../../../../stubs/maps/village.map.txt'), 'utf8');
  const map = parseMap(writeMap(stubMapToMapDef(parseStubMapSource(source, parseTileTables(readDataJson(TILE_TABLES_PATH))))));

  it('has one street lamp that burns at night only', () => {
    const lamp = map.lights?.sprites[0];
    if (!lamp) throw new Error('no stub light');
    expect(map.lights?.sprites).toHaveLength(1);
    const t = tactical();
    initLighting(t, map, 23, NIGHT);
    expect(level(t, lamp.x, lamp.y)).toBe(NIGHT - 5);
    expect(level(t, lamp.x + 6, lamp.y)).toBe(NIGHT);
    initLighting(t, map, 12, NORMAL_LIGHTLEVEL_DAY);
    expect(level(t, lamp.x, lamp.y)).toBe(NORMAL_LIGHTLEVEL_DAY);
  });
});
