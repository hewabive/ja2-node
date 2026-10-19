import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, readDataJson, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { LightTime, parseMap, writeMap } from '../../../content/formats/map.ts';
import { parseStubMapSource, stubMapToMapDef } from '../../../content/formats/stub-map.ts';
import { gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { compileWorldMovementCosts } from '../../../content/world/movement-costs.ts';
import { StructureFlags, type WorldStructures } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import { parseTileTables, TILE_TABLES_PATH } from '../../../content/world/tile-tables.ts';
import { Rng } from '../../../core/rng.ts';
import type { TacticalContent } from '../content.ts';
import { createTacticalState, type TacticalState } from '../state.ts';
import {
  initLighting,
  type LightSprite,
  lightSetBaseLevel,
  lightSpriteCreate,
  lightSpriteDestroy,
  lightSpritePosition,
  lightSpritePower,
  lightSpriteRenderAll,
  lightTimeAt,
  lightTrueLevel,
  NORMAL_LIGHTLEVEL_DAY,
  NORMAL_LIGHTLEVEL_NIGHT,
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
    t.world.costs.values.set(compileWorldMovementCosts(t.world).values);
    expect(row(t, Y, X + 3, X + 6)).toEqual(lit);
    lightSpriteRenderAll(t);
    expect(row(t, Y, X + 3, X + 6)).toEqual([NIGHT, NIGHT, NIGHT, NIGHT]);
  });

  it('does not climb onto higher ground', () => {
    const t = tactical();
    t.world.level.heights[gridNo(X + 1, Y)] = 10;
    lamp(t, 'L-R03.LHT');
    expect(level(t, X + 1, Y)).toBe(NIGHT);
    expect(level(t, X + 2, Y)).toBe(NIGHT - 2);
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

  it('takes generated templates first, then the shipped ones, and refuses others', () => {
    const t = tactical();
    expect(lightSpriteCreate(t, 'light3')?.template.name).toBe('Light3');
    expect(lightSpriteCreate(t, 'l-r03.lht')?.template.name).toBe('L-R03.LHT');
    expect(lightSpriteCreate(t, 'Light9')).toBeNull();
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

  it('takes the ambient level of an underground map and keeps cave lights off', () => {
    const t = tactical();
    initLighting(t, { ...map, ambient: { basement: false, caves: true, lightLevel: 9 } }, 2, NORMAL_LIGHTLEVEL_DAY);
    expect(t.lighting.ambient).toBe(9);
    expect(t.lighting.underground).toBe(true);
    for (let g = 0; g < WORLD_MAX; g += 997) expect(lightTrueLevel(t, g, 0)).toBe(9);
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
