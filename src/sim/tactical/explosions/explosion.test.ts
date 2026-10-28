import { beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { countDraws, itemId, objectOf, runExplosivesUntilIdle, stepWithExplosives } from '../../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { u8 } from '../../../core/int.ts';
import { deleteObject } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { CivGroupHostility } from '../narrative/constants.ts';
import { CivilianGroup, type Soldier, Team } from '../soldier.ts';
import { NO_SECTOR_HOOKS, type TacticalState } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, itemsAt, Visibility } from '../world-items.ts';
import { armourVersusExplosivesPercent, reduceDamageAmount } from './blast-damage.ts';
import { igniteExplosion, stepExplosions } from './explosion.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const BOMB = gridNo(80, 80);
const north = (tiles: number) => BOMB - 160 * tiles;
const south = (tiles: number) => BOMB + 160 * tiles;

function simWith(place: (g: (x: number, y: number) => number) => readonly number[] = () => [], hitPoints = 100): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), (structures) => {
    for (const g of place(gridNo)) {
      structures.add(g, 0, { ...syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT, { armour: 12 }), hitPoints });
    }
  });
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 3);
}

function bystander(sim: TacticalSim, id: number, at: number): Soldier {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH, { life: 100 });
  deleteObject(s.inv[InvSlot.HAND] as NonNullable<(typeof s.inv)[number]>);
  return s;
}

function recordRolls(t: TacticalState): number[] {
  const rolls: number[] = [];
  const draw = t.pre.int.bind(t.pre);
  vi.spyOn(t.pre, 'int').mockImplementation((n: number) => {
    const v = draw(n);
    if (n === 100) rolls.push(v);
    return v;
  });
  return rolls;
}

const blastWound = (damage: number, radius: number, roll: number, distance: number) =>
  reduceDamageAmount(damage + Math.trunc((damage * roll) / 100), radius, distance);

describe('blast falloff', () => {
  it('matches the HAND_GRENADE example from the spec', () => {
    expect([0, 1, 2, 3, 4].map((d) => blastWound(25, 4, 50, d))).toEqual([37, 28, 19, 10, 4]);
    expect(reduceDamageAmount(100, 0, 0)).toBe(100);
  });

  it('wounds soldiers along a ray by distance with one PreRandom roll per tile', () => {
    const sim = simWith();
    const t = sim.state;
    const victims = [BOMB, north(1), north(2), north(3), north(4)].map((g, k) => bystander(sim, k, g));
    const rolls = recordRolls(t);
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
    runExplosivesUntilIdle(sim);
    const rollIndexOfDistance = [0, 1, 4, 6, 7];
    victims.forEach((s, d) => {
      const roll = rolls[rollIndexOfDistance[d] ?? 0] ?? 0;
      expect(100 - s.life).toBe(blastWound(25, 4, roll, d));
    });
    expect(rolls).toHaveLength(49);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(t.perception.disallowSight).toBe(false);
  });

  it('lets explosive armour soak part of the first 35 points', () => {
    const sim = simWith();
    const t = sim.state;
    const s = bystander(sim, 0, BOMB);
    s.inv[InvSlot.VEST] = objectOf(t, 'FLAK_JACKET');
    expect(armourVersusExplosivesPercent(t, s)).toBe(38);
    const rolls = recordRolls(t);
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
    runExplosivesUntilIdle(sim);
    const wound = blastWound(25, 4, rolls[0] ?? 0, 0);
    expect(100 - s.life).toBe(wound - Math.trunc((Math.min(wound, 35) * 38) / 100));
    expect(s.inv[InvSlot.VEST]?.status[0]).toBeLessThanOrEqual(100);
  });

  it('damages the whole radius at the animation key frame, then releases the barrier', () => {
    const sim = simWith();
    const t = sim.state;
    const s = bystander(sim, 0, south(2));
    const animation = t.content.explosions.animations.get('BLAST_1');
    if (!animation) throw new Error('no BLAST_1');
    const start = t.clockMs;
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
    expect(t.turn.attackBusyCount).toBe(1);
    expect(t.perception.disallowSight).toBe(true);
    let hitAt = -1;
    let endAt = -1;
    while (t.explosives.aniTiles.length > 0) {
      const now = t.clockMs;
      stepWithExplosives(sim);
      if (hitAt < 0 && s.life < 100) hitAt = now;
      if (endAt < 0 && t.explosives.aniTiles.length === 0) endAt = now;
    }
    expect(hitAt - start).toBe(animation.damageKeyframe * (animation.blastSpeed + 5));
    expect(endAt - start).toBe(animation.frames * (animation.blastSpeed + 5));
    expect(t.perception.disallowSight).toBe(false);
  });

  it('raises the barrier but makes no explosion for creature gas without an animation', () => {
    const sim = simWith();
    const t = sim.state;
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'SMALL_CREATURE_GAS'), 0);
    expect(t.turn.attackBusyCount).toBe(1);
    expect(t.explosives.aniTiles).toEqual([]);
  });
});

describe('blasts and structures', () => {
  it('hits the wall on the edge of the bomb tile through the walls-only pass, less its material armour', () => {
    const wall = north(1);
    const sim = simWith(() => [wall]);
    const t = sim.state;
    expect(t.world.costs.get(wall, Direction.NORTH, 0)).toBe(TravelCost.WALL);
    const rolls = recordRolls(t);
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'TNT'), 0);
    const events = runExplosivesUntilIdle(sim);
    const armour = Math.trunc((t.content.materialArmour[12] ?? 0) / 2);
    const damage = Math.max(0, u8(blastWound(50, 5, rolls[0] ?? 0, 0)) - armour);
    const structure = t.world.structures.find(wall, StructureFlags.WALL);
    expect(damage).toBeGreaterThan(0);
    expect(damage).toBeLessThan(100);
    expect(structure?.hitPoints).toBe(100 - damage);
    expect(events.some((e) => e.type === 'structureDamaged')).toBe(false);
  });

  it('keeps a weak hut wall standing until its hit points run out', () => {
    const wall = north(1);
    const sim = simWith(() => [wall], 10);
    const t = sim.state;
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'TNT'), 0);
    const events = runExplosivesUntilIdle(sim);
    expect(t.world.structures.find(wall, StructureFlags.WALL)).toBeNull();
    expect(events.filter((e) => e.type === 'structureDamaged')).toEqual([expect.objectContaining({ gridNo: wall, destroyed: true })]);
  });

  it('stops the blast at a wall but not in the open', () => {
    const sim = simWith((g) => Array.from({ length: 9 }, (_, k) => g(76 + k, 78)));
    const t = sim.state;
    const sheltered = bystander(sim, 0, north(3));
    const exposed = bystander(sim, 1, south(3));
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
    runExplosivesUntilIdle(sim);
    expect(sheltered.life).toBe(100);
    expect(exposed.life).toBeLessThan(100);
  });
});

describe('structure damage listeners (OnStructureDamaged)', () => {
  interface Report {
    readonly gridNo: number;
    readonly damage: number;
    readonly standing: boolean;
    readonly kingpinHostile: boolean;
  }

  function listen(t: TacticalState): Report[] {
    const reports: Report[] = [];
    t.sectorHooks = {
      ...NO_SECTOR_HOOKS,
      structureDamaged: (at, g, damage) =>
        reports.push({
          gridNo: g,
          damage,
          standing: at.world.structures.find(g, StructureFlags.WALL) !== null,
          kingpinHostile: at.civGroups.hostility[CivilianGroup.KINGPIN] === CivGroupHostility.HOSTILE,
        }),
    };
    return reports;
  }

  it('reports every damaging hit with its tile and the wound before armour, while the structure still stands', () => {
    for (const hitPoints of [100, 10]) {
      const wall = north(1);
      const sim = simWith(() => [wall], hitPoints);
      const t = sim.state;
      const reports = listen(t);
      const rolls = recordRolls(t);
      igniteExplosion(t, null, 0, BOMB, itemId(t, 'TNT'), 0);
      runExplosivesUntilIdle(sim);
      const wound = u8(blastWound(50, 5, rolls[0] ?? 0, 0));
      expect(reports).toEqual([{ gridNo: wall, damage: wound, standing: true, kingpinHostile: false }]);
    }
  });

  it("runs the brothel listener before the strategic one: a blown brothel wall turns Kingpin's men first", () => {
    const wall = north(1);
    const sim = simWith(() => [wall], 10);
    const t = sim.state;
    const rooms = new Uint8Array(WORLD_MAX);
    rooms[wall] = 100;
    Object.assign(t.world, { map: { ...t.world.map, rooms } });
    t.sector = { x: 5, y: 3, z: 0 };
    const goon = spawnSoldier(sim, 116, Team.CIV, south(30), Direction.NORTH);
    goon.civilianGroup = CivilianGroup.KINGPIN;
    expect(goon.neutral).toBe(true);
    const reports = listen(t);
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'TNT'), 0);
    runExplosivesUntilIdle(sim);
    expect(reports.map((r) => r.kingpinHostile)).toEqual([true]);
    expect(goon.neutral).toBe(false);
  });
});

describe('destruction partners and explosive structures', () => {
  it('swaps a wrecked structure to its damaged partner, which the same blast then hits again', () => {
    const sim = simWith();
    const t = sim.state;
    const intact = { ...syntheticStructure(StructureFlags.GENERIC), number: 0, hitPoints: 1, destructionPartner: -2 };
    const damaged = { ...syntheticStructure(StructureFlags.GENERIC), number: 1 };
    const file = { structureCount: 2, auxData: null, tileLocations: [], structures: [intact, damaged] };
    t.world.structures.add(BOMB, 0, intact, undefined, file);
    const rolls = recordRolls(t);
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'TNT'), 0);
    const events = runExplosivesUntilIdle(sim);
    const left = t.world.structures.find(BOMB, StructureFlags.GENERIC);
    expect(left?.def).toBe(damaged);
    expect(left?.hitPoints).toBe(100 - blastWound(50, 5, rolls[0] ?? 0, 0));
    expect(events.filter((e) => e.type === 'structureDamaged')).toEqual([expect.objectContaining({ gridNo: BOMB, destroyed: false })]);
  });

  it('blows up an explosive barrel caught in a blast', () => {
    const sim = simWith();
    const t = sim.state;
    const barrel = syntheticStructure(StructureFlags.GENERIC | StructureFlags.EXPLOSIVE, Orientation.NONE, { armour: 22 });
    t.world.structures.add(north(1), 0, barrel);
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
    const events = runExplosivesUntilIdle(sim);
    expect(t.world.structures.find(north(1), StructureFlags.EXPLOSIVE)).toBeNull();
    expect(events.filter((e) => e.type === 'explosion').map((e) => ('item' in e ? e.item : 0))).toEqual([
      itemId(t, 'HAND_GRENADE'),
      itemId(t, 'STRUCTURE_EXPLOSION'),
    ]);
    expect(t.turn.attackBusyCount).toBe(0);
  });
});

describe('items in the blast', () => {
  it('damages items on the ground and sets off volatile explosives', () => {
    const sim = simWith();
    const t = sim.state;
    addItemToPool(t, north(1), objectOf(t, 'TNT'), Visibility.VISIBLE, 0);
    addItemToPool(t, south(1), objectOf(t, 'MEDICKIT'), Visibility.VISIBLE, 0);
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
    const events = runExplosivesUntilIdle(sim);
    const explosions = events.filter((e) => e.type === 'explosion');
    const tntLeft = itemsAt(t, north(1), 0);
    expect(explosions).toHaveLength(2);
    expect(explosions[1]).toMatchObject({ gridNo: north(1), item: itemId(t, 'TNT') });
    expect(tntLeft).toEqual([]);
    const kit = itemsAt(t, south(1), 0)[0];
    expect(kit?.object.status[0]).toBeGreaterThanOrEqual(10);
    expect(kit?.object.status[0]).toBeLessThan(100);
  });
});

describe('RNG per blast', () => {
  it('draws one PreRandom(100) per affected tile and nothing on the main stream in the open', () => {
    const sim = simWith();
    const t = sim.state;
    igniteExplosion(t, null, 0, BOMB, itemId(t, 'HAND_GRENADE'), 0);
    const draws = countDraws(t, () => {
      while (t.explosives.aniTiles.length > 0) {
        stepExplosions(t);
        t.clockMs += 5;
      }
    });
    expect(draws).toEqual({ pre: 49, main: 0 });
  });
});
