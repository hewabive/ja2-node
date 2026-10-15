import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStubAnimationScripts } from '../../../../stubs/anim-scripts.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables } from '../../../content/anim/tables.ts';
import { parseAnimationScripts } from '../../../content/formats/ja2bin.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { parseWeapons, WEAPONS_PATH } from '../../../content/items/weapons.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { parseDoorCostTable } from '../../../content/world/movement-costs.ts';
import { StructureFlags, type WorldStructures } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { setSoldierPosition } from '../movement.ts';
import { createSoldier, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, type TacticalState } from '../state.ts';
import { HeightClass, lineOfSightTest, soldierToSoldierLineOfSight } from './los.ts';
import { allTeamsLookForAll, handleSight, Opp, SightFlags } from './sight.ts';
import { perceptionHooks } from './wiring.ts';

const dataDir = join(import.meta.dirname, '../../../../data');
const json = (path: string) => JSON.parse(readFileSync(join(dataDir, path), 'utf8'));
const doorCosts = parseDoorCostTable(json('tables/door-costs.json'));
let content: TacticalContent;

beforeAll(async () => {
  content = {
    scripts: parseAnimationScripts(await buildStubAnimationScripts()),
    animations: parseAnimationTables(json(ANIM_CONTROL_PATH), json(ANIM_SURFACES_PATH)),
    weapons: parseWeapons(json(WEAPONS_PATH)),
    profiles: [],
  };
});

const STATS = {
  agility: 60,
  dexterity: 60,
  strength: 60,
  wisdom: 60,
  leadership: 50,
  marksmanship: 60,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function tactical(place: (s: WorldStructures) => void = () => {}): TacticalState {
  const w = syntheticWorld(doorCosts, place);
  const t = createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(11));
  t.perceptionHooks = perceptionHooks(t, { checkForChangingOrders: () => {}, setNewSituation: () => {} }, () => {});
  return t;
}

function spawn(t: TacticalState, team: number, at: number, direction: number): Soldier {
  const s = createSoldier({
    id: t.soldiers.length,
    team,
    name: '',
    bodyType: 0,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    stats: STATS,
    life: 80,
    gridNo: at,
    direction,
    state: states(content.animations).STANDING,
  });
  t.soldiers.push(s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  return s;
}

const stand = (g: number) => ({ gridNo: g, level: 0, heightClass: HeightClass.STAND });

describe('line of sight', () => {
  it('sees across open ground within range and not beyond it', () => {
    const t = tactical();
    const world = { structures: t.world.structures, heights: t.world.level.heights };
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 95)), 26, true)).toBeGreaterThan(0);
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 110)), 26, true)).toBe(0);
    expect(
      lineOfSightTest(world, gridNo(80, 80), 175, gridNo(80, 80), 175, { tileLimit: 26, treeReduction: 6, aware: true, camo: 0 }),
    ).toBe(0);
  });

  it('is blocked by a wall but not by a transparent structure', () => {
    const t = tactical((w) => {
      for (let x = 70; x <= 90; x++) w.add(gridNo(x, 85), 0, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT));
      w.add(gridNo(60, 85), 0, syntheticStructure(StructureFlags.GENERIC | StructureFlags.TRANSPARENT));
    });
    const world = { structures: t.world.structures, heights: t.world.level.heights };
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 90)), 26, true)).toBe(0);
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(60, 80)), stand(gridNo(60, 90)), 26, true)).toBeGreaterThan(0);
  });

  it('loses range through foliage, more for an unaware viewer', () => {
    const t = tactical((w) => {
      for (let y = 87; y <= 88; y++) w.add(gridNo(80, y), 0, syntheticStructure(StructureFlags.TREE, Orientation.NONE, { height: 3 }));
    });
    const world = { structures: t.world.structures, heights: t.world.level.heights };
    const aware = soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 96)), 26, true);
    const unaware = soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 96)), 26, false);
    expect(aware).toBeGreaterThan(0);
    expect(unaware).toBe(0);
  });
});

describe('sighting', () => {
  it('lets mercs reveal an enemy they face and start combat', () => {
    const t = tactical();
    const merc = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(t, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    expect(enemy.visible).toBe(-1);
    allTeamsLookForAll(t);
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(enemy.visible).toBe(1);
    expect(t.combatPending).toBe(true);
    expect(t.events.some((e) => e.type === 'combatWouldStart')).toBe(true);
  });

  it('does not see behind and keeps neutral civilians out of combat', () => {
    const t = tactical();
    spawn(t, Team.OUR, gridNo(80, 80), Direction.NORTH);
    const enemy = spawn(t, Team.ENEMY, gridNo(80, 95), Direction.SOUTH);
    const civ = spawn(t, Team.CIV, gridNo(81, 79), Direction.SOUTH);
    handleSight(t, t.soldiers[0] as Soldier, SightFlags.LOOK | SightFlags.RADIO);
    expect(enemy.visible).toBe(-1);
    expect(civ.visible).toBe(1);
    expect(t.combatPending).toBe(false);
  });
});
