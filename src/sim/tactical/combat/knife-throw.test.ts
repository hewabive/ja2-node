import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation, type StructureDef } from '../../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags, StructureTileFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { calcThrownChanceToHit } from '../explosions/throwing.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { Visibility } from '../world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const KNIFE_STATUS_IN_POCKET = 77;
const TABLE_AT_SECOND_CUBE = { cubes: 0b0010, height: 25 };
const SHELF_AT_TOP_CUBE = { cubes: 0b1000, height: 50 };
const MISSED_KNIFE_SEED = 1;
const MAX_FLIGHT_TICKS = 1000;

function simWith(place: Parameters<typeof syntheticWorld>[1]): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), place);
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 3);
}

function raisedSurface(cubes: number, tileFlags = 0): StructureDef {
  const surface = syntheticStructure(StructureFlags.GENERIC);
  const tiles = surface.tiles.map((tile) => ({ ...tile, flags: tileFlags, shape: new Uint8Array(tile.shape.length).fill(cubes) }));
  return { ...surface, tiles };
}

const thrownKnives = (sim: TacticalSim, name: string) =>
  sim.state.worldItems.filter((i) => content.items.byIndex.get(i.object.item)?.name === name);

function knifeDuel() {
  const sim = newCombatSim(content);
  const thrower = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.EAST, { gun: 'THROWING_KNIFE', marksmanship: 90 });
  const knife = content.items.byName.get('THROWING_KNIFE')?.index ?? -1;
  thrower.inv[InvSlot.SMALLPOCK1] = createItem(content.items, knife, KNIFE_STATUS_IN_POCKET);
  const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(85, 70), Direction.WEST);
  sim.lookAround();
  sim.drainEvents();
  return { sim, thrower, target, knife };
}

describe('throwing a knife (Handle_Items.cc HandleItem, Weapons.cc UseGun)', () => {
  it('throws at the thrown chance to hit and then takes the next knife from a pocket into the hand', () => {
    const { sim, thrower, target, knife } = knifeDuel();
    const chance = calcThrownChanceToHit(sim.state, thrower, target.gridNo, 0);
    expect(estimateAttack(sim, { soldier: 0, target: target.gridNo }).data).toMatchObject({ chanceToHit: chance });
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events).toContainEqual(expect.objectContaining({ type: 'shotFired', soldier: 0, chance }));
    expect(thrower.inv[InvSlot.HAND]).toMatchObject({ item: knife, status: [KNIFE_STATUS_IN_POCKET] });
    expect(thrower.inv[InvSlot.SMALLPOCK1]?.item ?? 0).toBe(0);
    expect(sim.state.turn.attackBusyCount).toBe(0);
  });

  it('loses a knife that strikes a wall: StructureHit leaves one on the map only where it falls to the ground', () => {
    const wallRow = 84;
    const walls = Array.from({ length: 9 }, (_, k) => gridNo(76 + k, wallRow));
    const sim = newCombatSim(content, walls);
    const thrower = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: 'THROWING_KNIFE', marksmanship: 90 });
    const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    sim.state.inCombat = true;
    thrower.oppList[target.id] = Opp.SEEN_CURRENTLY;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'bulletStopped')).toMatchObject({ reason: 'structure' });
    expect(target.life).toBe(80);
    expect(sim.state.worldItems.filter((i) => content.items.byIndex.get(i.object.item)?.name === 'THROWING_KNIFE')).toEqual([]);
    expect(sim.state.turn.attackBusyCount).toBe(0);
  });

  it('makes the thrower look for items at his next frame when his missed knife falls to the ground (Weapons.cc StructureHit)', () => {
    const sim = newCombatSim(content, [], MISSED_KNIFE_SEED);
    const thrower = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: 'THROWING_KNIFE', marksmanship: 1 });
    const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    sim.state.inCombat = true;
    thrower.oppList[target.id] = Opp.SEEN_CURRENTLY;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    for (let k = 0; k < MAX_FLIGHT_TICKS && thrownKnives(sim, 'THROWING_KNIFE').length === 0; k++) sim.step();
    expect(thrownKnives(sim, 'THROWING_KNIFE')).toMatchObject([{ level: 0, visible: Visibility.INVISIBLE }]);
    expect(target.life).toBe(80);
    expect(thrower.lookForItems).toBe(true);
  });

  it('lays a knife stopped by a window on the raised table at the window, where a dropped item would lie under it', () => {
    const window = gridNo(80, 84);
    const sim = simWith((structures) => {
      structures.add(window, 0, syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.OUTSIDE_LEFT));
      structures.add(window, 0, raisedSurface(TABLE_AT_SECOND_CUBE.cubes));
    });
    const thrower = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: 'THROWING_KNIFE', marksmanship: 90 });
    const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    sim.state.inCombat = true;
    thrower.oppList[target.id] = Opp.SEEN_CURRENTLY;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'bulletStopped')).toMatchObject({ reason: 'structure' });
    expect(target.life).toBe(80);
    expect(thrownKnives(sim, 'THROWING_KNIFE')).toMatchObject([
      { gridNo: window, level: 0, zHeight: TABLE_AT_SECOND_CUBE.height, flags: 0, visible: Visibility.VISIBLE },
    ]);
  });

  it('lays the bloody knife of a target with full pockets on the raised shelf over his tile, not under it', () => {
    const at = gridNo(80, 84);
    const sim = simWith((structures) => {
      structures.add(at, 0, raisedSurface(SHELF_AT_TOP_CUBE.cubes, StructureTileFlags.PASSABLE));
    });
    const thrower = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 82), Direction.SOUTH, { gun: 'THROWING_KNIFE', marksmanship: 100 });
    const target = spawnSoldier(sim, 20, Team.ENEMY, at, Direction.NORTH);
    const rock = content.items.byName.get('ROCK')?.index ?? -1;
    for (let k = InvSlot.BIGPOCK1; k <= InvSlot.SMALLPOCK8; k++) target.inv[k] = createItem(content.items, rock, 100);
    sim.state.inCombat = true;
    thrower.oppList[target.id] = Opp.SEEN_CURRENTLY;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(target.life).toBeLessThan(80);
    expect(thrownKnives(sim, 'BLOODY_THROWING_KNIFE')).toMatchObject([
      { gridNo: at, level: 0, zHeight: SHELF_AT_TOP_CUBE.height, flags: 0, visible: Visibility.VISIBLE },
    ]);
  });
});
