import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { createItem } from '../../items/object.ts';
import { soldierToSoldierLos } from '../combat/positions.ts';
import type { TacticalContent } from '../content.ts';
import { SmokeTile } from '../explosions/smoke.ts';
import { InvSlot } from '../inventory.ts';
import { lightSetBaseLevel, NORMAL_LIGHTLEVEL_NIGHT } from '../lighting/lighting.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { HeightClass, type LosWorld, type SightTarget, soldierToSoldierLineOfSight } from './los.ts';
import { distanceVisible, MAX_DISTANCE_VISIBLE } from './sight.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ANY_DIRECTION = -1;
const VIEWER_AT = gridNo(80, 80);
const FULL_RANGE = MAX_DISTANCE_VISIBLE;
const GASSED_RANGE = 2;
const ENEMY = TEAM_FIRST_ID[Team.ENEMY];

function viewerAndTarget(targetAt = gridNo(80, 90)): { t: TacticalState; viewer: Soldier; target: Soldier } {
  const sim = newCombatSim(content);
  const viewer = spawnSoldier(sim, 0, Team.OUR, VIEWER_AT, Direction.SOUTH);
  const target = spawnSoldier(sim, ENEMY, Team.ENEMY, targetAt, Direction.NORTH);
  return { t: sim.state, viewer, target };
}

function wear(s: Soldier, item: string): void {
  s.inv[InvSlot.HEAD1] = createItem(content.items, content.items.byName.get(item)?.index ?? 0, 100);
}

function fill(t: TacticalState, flag: number, tiles: readonly number[], level = 0): void {
  const layer = t.explosives.smokeTiles[level > 0 ? 1 : 0];
  for (const g of tiles) layer[g] = flag;
}

function standing(g: number): SightTarget {
  return {
    gridNo: g,
    level: 0,
    heightClass: HeightClass.STAND,
    bodyType: Body.REGMALE,
    camo: 0,
    tilesMoved: 0,
    overTerrain: Terrain.FLAT_GROUND,
  };
}

const column = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => gridNo(80, from + k));

describe('gas and tanks in the vision range (OppList.cc DistanceVisible)', () => {
  const range = (t: TacticalState, viewer: Soldier, g = gridNo(80, 90), level = 0) =>
    distanceVisible(t, viewer, ANY_DIRECTION, ANY_DIRECTION, g, level);

  it('sees two tiles at most from tear gas or mustard gas without a gas mask; smoke and creature gas leave the range alone', () => {
    const rangeIn = (flag: number, mask = false) => {
      const { t, viewer } = viewerAndTarget();
      if (mask) wear(viewer, 'GASMASK');
      fill(t, flag, [viewer.gridNo]);
      return range(t, viewer);
    };
    expect(rangeIn(0)).toBe(FULL_RANGE);
    expect(rangeIn(SmokeTile.TEARGAS)).toBe(GASSED_RANGE);
    expect(rangeIn(SmokeTile.MUSTARDGAS)).toBe(GASSED_RANGE);
    expect(rangeIn(SmokeTile.TEARGAS, true)).toBe(FULL_RANGE);
    expect(rangeIn(SmokeTile.SMOKE)).toBe(FULL_RANGE);
    expect(rangeIn(SmokeTile.CREATUREGAS)).toBe(FULL_RANGE);
  });

  it('reads the gas of his own tile on the level he looks at, not on the level he stands on', () => {
    const { t, viewer } = viewerAndTarget();
    const roofTile = gridNo(80, 90);
    fill(t, SmokeTile.TEARGAS, [viewer.gridNo]);
    expect(range(t, viewer, roofTile, 1)).toBe(FULL_RANGE + 2);
    fill(t, 0, [viewer.gridNo]);
    fill(t, SmokeTile.TEARGAS, [viewer.gridNo], 1);
    expect(range(t, viewer)).toBe(FULL_RANGE);
    expect(range(t, viewer, roofTile, 1)).toBe(GASSED_RANGE);
  });

  it('sees a tank and lets a tank see at least the daylight range in the dark', () => {
    const { t, viewer, target } = viewerAndTarget();
    lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_NIGHT);
    const darkRange = range(t, viewer, gridNo(80, 95));
    expect(darkRange).toBeLessThan(FULL_RANGE);
    expect(range(t, viewer)).toBe(darkRange);
    target.bodyType = Body.TANK_NW;
    expect(range(t, viewer)).toBe(FULL_RANGE);
    expect(range(t, target, viewer.gridNo)).toBe(FULL_RANGE);
  });

  it('lets anyone see a tank behind his back, while a tank sees nobody behind its own', () => {
    const { t, viewer, target } = viewerAndTarget();
    const behind = (s: Soldier, g: number) => distanceVisible(t, s, Direction.NORTH, Direction.SOUTH, g, 0);
    expect(behind(viewer, target.gridNo)).toBe(0);
    target.bodyType = Body.TANK_NE;
    expect(behind(viewer, target.gridNo)).toBe(FULL_RANGE);
    expect(behind(target, viewer.gridNo)).toBe(0);
  });

  it('lets a tank look only the way it is turning, also when a look ignores the facing or the soldier it looks at fires', () => {
    const { t, viewer, target } = viewerAndTarget();
    target.bodyType = Body.TANK_NW;
    const tankRange = () => range(t, target, viewer.gridNo);
    target.desiredDirection = Direction.NORTH;
    expect(tankRange()).toBeGreaterThan(FULL_RANGE);
    target.desiredDirection = Direction.SOUTH;
    expect(tankRange()).toBe(0);
    viewer.muzzleFlash = true;
    expect(tankRange()).toBe(0);
    expect(distanceVisible(t, target, Direction.SOUTH, Direction.NORTH, viewer.gridNo, 0)).toBe(0);
    target.bodyType = Body.REGMALE;
    expect(distanceVisible(t, target, Direction.SOUTH, Direction.NORTH, viewer.gridNo, 0)).toBe(FULL_RANGE);
  });

  it('lets the robot see all around', () => {
    const { t, viewer, target } = viewerAndTarget();
    const behind = () => distanceVisible(t, viewer, Direction.NORTH, Direction.SOUTH, target.gridNo, 0);
    expect(behind()).toBe(0);
    viewer.bodyType = Body.ROBOTNOWEAPON;
    expect(behind()).toBe(FULL_RANGE);
  });
});

describe('eye heights of bodies and water (LOS.cc CalculateSoldierZPos)', () => {
  const TARGET_AT = gridNo(80, 90);
  const MIDWAY = gridNo(80, 85);
  const BESIDE_THE_VIEWER = gridNo(80, 81);
  const BESIDE_THE_TARGET = gridNo(80, 89);
  const KNEE_HIGH = 1;
  const WAIST_HIGH = 2;
  const CHEST_HIGH = 3;

  function crate(at: number, height: number): LosWorld {
    const w = syntheticWorld(testDoorCosts(), (s) =>
      s.add(at, 0, syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { height })),
    );
    return { structures: w.structures, heights: w.level.heights };
  }

  const sees = (world: LosWorld, viewer: Partial<SightTarget>, target: Partial<SightTarget> = viewer) =>
    soldierToSoldierLineOfSight(world, { ...standing(VIEWER_AT), ...viewer }, { ...standing(TARGET_AT), ...target }, FULL_RANGE, true) > 0;

  it('looks from and at a crouched eye in shallow water and a prone one in deep water or for a crow, whatever the stance', () => {
    const waistHigh = crate(MIDWAY, WAIST_HIGH);
    const kneeHigh = crate(MIDWAY, KNEE_HIGH);
    expect(sees(waistHigh, {})).toBe(true);
    expect(sees(waistHigh, { overTerrain: Terrain.LOW_WATER })).toBe(false);
    expect(sees(waistHigh, { overTerrain: Terrain.MED_WATER })).toBe(false);
    expect(sees(kneeHigh, { overTerrain: Terrain.MED_WATER })).toBe(true);
    expect(sees(kneeHigh, { overTerrain: Terrain.DEEP_WATER })).toBe(false);
    expect(sees(kneeHigh, { bodyType: Body.CROW })).toBe(false);
  });

  it("puts a kid's eye at two thirds of a man's, a bloodcat's, the robot's and a young creature's at a third and a tank's at four thirds", () => {
    expect(sees(crate(MIDWAY, WAIST_HIGH), { bodyType: Body.KIDCIV })).toBe(false);
    expect(sees(crate(MIDWAY, WAIST_HIGH), { bodyType: Body.HATKIDCIV })).toBe(false);
    for (const bodyType of [Body.BLOODCAT, Body.ROBOTNOWEAPON, Body.LARVAE_MONSTER, Body.INFANT_MONSTER])
      expect(sees(crate(MIDWAY, KNEE_HIGH), { bodyType })).toBe(false);
    expect(sees(crate(BESIDE_THE_VIEWER, CHEST_HIGH), {})).toBe(false);
    expect(sees(crate(BESIDE_THE_VIEWER, CHEST_HIGH), { bodyType: Body.TANK_NW }, {})).toBe(true);
    expect(sees(crate(BESIDE_THE_TARGET, CHEST_HIGH), {}, { bodyType: Body.TANK_NE })).toBe(true);
  });

  it('reads the body and the water of both soldiers of a look in the sector', () => {
    const sim = newCombatSim(content, [], 3, new Set(), (w) =>
      w.structures.add(MIDWAY, 0, syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { height: KNEE_HIGH })),
    );
    const viewer = spawnSoldier(sim, 0, Team.OUR, VIEWER_AT, Direction.SOUTH);
    const target = spawnSoldier(sim, ENEMY, Team.ENEMY, TARGET_AT, Direction.NORTH);
    const seen = () => soldierToSoldierLos(sim.state, viewer, target, FULL_RANGE, true) > 0;
    expect(seen()).toBe(true);
    viewer.overTerrain = Terrain.DEEP_WATER;
    target.overTerrain = Terrain.DEEP_WATER;
    expect(seen()).toBe(false);
    viewer.overTerrain = Terrain.FLAT_GROUND;
    target.overTerrain = Terrain.FLAT_GROUND;
    viewer.bodyType = Body.BLOODCAT;
    target.bodyType = Body.BLOODCAT;
    expect(seen()).toBe(false);
  });
});

describe('smoke and gas on the ray (LOS.cc LineOfSightTest)', () => {
  it('loses sight at the third tile of smoke on the way, which never stops a creature smelling', () => {
    const { t, viewer, target } = viewerAndTarget();
    const clear = soldierToSoldierLos(t, viewer, target, FULL_RANGE, true);
    fill(t, SmokeTile.SMOKE, column(84, 85));
    expect(soldierToSoldierLos(t, viewer, target, FULL_RANGE, true)).toBe(clear);
    fill(t, SmokeTile.SMOKE, column(86, 86));
    expect(soldierToSoldierLos(t, viewer, target, FULL_RANGE, true)).toBe(0);
    viewer.bodyType = Body.ADULTFEMALEMONSTER;
    expect(soldierToSoldierLos(t, viewer, target, FULL_RANGE, true)).toBeGreaterThan(0);
  });

  it('takes two tiles of range for each tile of tear gas, for a creature smelling too', () => {
    const { t, viewer, target } = viewerAndTarget(gridNo(80, 83));
    const sees = (tiles: number) => soldierToSoldierLos(t, viewer, target, tiles, true);
    const clear = sees(FULL_RANGE);
    fill(t, SmokeTile.TEARGAS, column(81, 82));
    expect(sees(FULL_RANGE)).toBeGreaterThan(clear);
    expect(sees(5)).toBeGreaterThan(0);
    expect(sees(4)).toBe(0);
    viewer.bodyType = Body.ADULTFEMALEMONSTER;
    expect(sees(4)).toBe(0);
  });

  it('reads the smoke of the roof layer for a ray on high ground', () => {
    const smoke = content.explosions.smokeEffects.get('SMOKE') ?? null;
    const smoked = new Set(column(84, 86));
    const sees = (landHeight: number, smokeLevel: number) => {
      const w = syntheticWorld(testDoorCosts());
      const world: LosWorld = {
        structures: w.structures,
        heights: new Uint8Array(WORLD_MAX).fill(landHeight),
        smokeAt: (g, level) => (level === smokeLevel && smoked.has(g) ? smoke : null),
      };
      return soldierToSoldierLineOfSight(world, standing(VIEWER_AT), standing(gridNo(80, 90)), FULL_RANGE, true);
    };
    expect([sees(0, 0), sees(0, 1)]).toEqual([0, 100]);
    expect([sees(20, 0), sees(20, 1)]).toEqual([100, 0]);
  });
});

describe('camouflage and tanks on the ray (LOS.cc SoldierToSoldierLineOfSightTest)', () => {
  const TREE_AT = gridNo(80, 87);

  function world(trees: readonly number[] = []): LosWorld {
    const w = syntheticWorld(testDoorCosts(), (s) => {
      for (const g of trees) s.add(g, 0, syntheticStructure(StructureFlags.TREE, Orientation.NONE, { height: 3 }));
    });
    return { structures: w.structures, heights: w.level.heights };
  }

  const prone = (g: number, camo: Partial<SightTarget> = {}): SightTarget => ({
    ...standing(g),
    heightClass: HeightClass.PRONE,
    ...camo,
  });

  it('hides a camouflaged soldier low on open ground from an unaware viewer by up to a third of the range, less for every tile he moved', () => {
    const far = gridNo(80, 100);
    const sees = (target: SightTarget, aware = false) =>
      soldierToSoldierLineOfSight(world(), standing(VIEWER_AT), target, FULL_RANGE, aware) > 0;
    expect(sees(prone(far))).toBe(true);
    expect(sees(prone(far, { camo: 100 }))).toBe(false);
    expect(sees(prone(far, { camo: 100 }), true)).toBe(true);
    expect(sees(prone(far, { camo: 100, heightClass: HeightClass.STAND }))).toBe(true);
    expect(sees(prone(far, { camo: 100, overTerrain: Terrain.PAVED_ROAD }))).toBe(true);
    expect(sees(prone(far, { camo: 100, tilesMoved: 20 }))).toBe(true);
  });

  it('counts any camouflage on a bloodcat as full camouflage', () => {
    const sees = (target: SightTarget) => soldierToSoldierLineOfSight(world(), standing(VIEWER_AT), target, FULL_RANGE, false) > 0;
    const cat = prone(gridNo(80, 100), { bodyType: Body.BLOODCAT });
    expect(sees(cat)).toBe(true);
    expect(sees({ ...cat, camo: 1 })).toBe(false);
    expect(sees({ ...cat, bodyType: Body.REGMALE, camo: 1 })).toBe(true);
  });

  it('lets foliage hide a camouflaged soldier from an unaware viewer up to twice as well', () => {
    const behindTheTree = standing(gridNo(80, 89));
    const sees = (target: SightTarget, aware = false) =>
      soldierToSoldierLineOfSight(world([TREE_AT]), standing(VIEWER_AT), target, FULL_RANGE, aware) > 0;
    expect(sees(behindTheTree)).toBe(true);
    expect(sees({ ...behindTheTree, camo: 100 })).toBe(false);
    expect(sees({ ...behindTheTree, camo: 100 }, true)).toBe(true);
  });

  it('keeps a soldier prone within eight tiles or crouched within four out of the sight of a tank', () => {
    const tank = { ...standing(VIEWER_AT), bodyType: Body.TANK_NW };
    const tankSees = (target: SightTarget) => soldierToSoldierLineOfSight(world(), tank, target, FULL_RANGE, true) > 0;
    const crouched = (g: number) => ({ ...standing(g), heightClass: HeightClass.CROUCH });
    expect([tankSees(prone(gridNo(80, 88))), tankSees(prone(gridNo(80, 89)))]).toEqual([false, true]);
    expect([tankSees(crouched(gridNo(80, 84))), tankSees(crouched(gridNo(80, 85)))]).toEqual([false, true]);
    expect(tankSees(standing(gridNo(80, 81)))).toBe(true);
  });

  it('lets no foliage hide a tank', () => {
    const farBehindTheTree = gridNo(80, 104);
    const sees = (target: SightTarget) => soldierToSoldierLineOfSight(world([TREE_AT]), standing(VIEWER_AT), target, FULL_RANGE, false);
    expect(sees(standing(farBehindTheTree))).toBe(0);
    expect(sees({ ...standing(farBehindTheTree), bodyType: Body.TANK_NE })).toBeGreaterThan(0);
  });
});
