import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { Direction, gridNo, WORLD_CLIFF_HEIGHT } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { recompileLocalMovementCosts, TravelCost } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { buildTacticalWorldFromInputs, loadTacticalWorldInputs } from '../../content/world/tactical-world.ts';
import { TileFlags } from '../../content/world/tile-database.ts';
import { typeIndex } from '../../content/world/tile-tables.ts';
import { animName } from './anim-states.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import { soldierToSoldierChanceToGetThrough } from './combat/bullets.ts';
import { soldierToSoldierLos } from './combat/positions.ts';
import { swapStructureForPartner } from './doors.ts';
import { isJumpableFenceAt } from './movement.ts';
import { findHigherLevel } from './roofs.ts';
import { type Soldier, Team } from './soldier.ts';
import { TacticalSim } from './tactical-sim.ts';

const VILLAGE = 'stubs/world/maps/village.dat';
const YARD_X = 106;
const YARD_Y = 66;
const SIGHT_TILES = 20;
const SLOW_SCENARIO_MS = 30_000;

const at = (x: number, y: number) => gridNo(YARD_X + x, YARD_Y + y);

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
}, SLOW_SCENARIO_MS);

afterAll(async () => {
  await kit.dispose();
});

function village(seed = 7): TacticalSim {
  return new TacticalSim(kit.world(VILLAGE), kit.content, seed);
}

function crouch(sim: TacticalSim, s: Soldier): void {
  initNewSoldierAnim(sim.state, s, states(sim.state.content.animations).CROUCHING, 0, true);
}

function walk(sim: TacticalSim, s: Soldier, to: number): Set<string> {
  expect(sim.dispatch({ type: 'move', soldier: s.id, to, mode: 'walk' }).ok).toBe(true);
  const seen = new Set<string>();
  for (let i = 0; i < 20_000 && !sim.isIdle(); i++) {
    sim.step();
    seen.add(animName(sim.state.content, s.state));
  }
  return seen;
}

function structureAt(sim: TacticalSim, g: number, flags: number) {
  const s = sim.state.world.structures.find(g, flags);
  if (!s) throw new Error(`no structure with flags ${flags} at ${g}`);
  return s;
}

describe('the stub tile yard in the village', { timeout: SLOW_SCENARIO_MS }, () => {
  it('hops the wooden fence of the pen, the only way out', () => {
    const sim = village();
    const merc = spawnSoldier(sim, 0, Team.OUR, at(2, 3), Direction.NORTH);
    expect(isJumpableFenceAt(sim.state, at(2, 1))).toBe(true);
    expect(sim.state.world.costs.get(at(2, 1), Direction.NORTH, 0)).toBe(TravelCost.FENCE);
    expect(sim.state.world.costs.get(at(1, 1), Direction.EAST, 0)).toBe(TravelCost.OBSTACLE);
    const seen = walk(sim, merc, at(2, 0));
    expect(seen.has('HOPFENCE')).toBe(true);
    expect(merc.gridNo).toBe(at(2, 0));
  });

  it('hops a row of low sandbags but not the high ones', () => {
    const sim = village();
    expect(isJumpableFenceAt(sim.state, at(2, 11))).toBe(true);
    expect(sim.state.world.costs.get(at(2, 11), Direction.NORTH, 0)).toBe(TravelCost.FENCE);
    expect(sim.state.world.costs.get(at(2, 11), Direction.EAST, 0)).toBe(TravelCost.OBSTACLE);
    expect(isJumpableFenceAt(sim.state, at(8, 9))).toBe(false);
    expect(sim.state.world.costs.get(at(8, 9), Direction.NORTH, 0)).toBe(TravelCost.OBSTACLE);
    const merc = spawnSoldier(sim, 0, Team.OUR, at(2, 12), Direction.NORTH);
    const seen = walk(sim, merc, at(2, 10));
    expect(seen.has('HOPFENCE')).toBe(true);
    expect(merc.gridNo).toBe(at(2, 10));
  });

  it('blocks movement at the wire fence until it is cut, and sees through it', () => {
    const sim = village();
    const t = sim.state;
    const g = at(2, 8);
    expect(isJumpableFenceAt(t, g)).toBe(false);
    expect(t.world.costs.get(g, Direction.NORTH, 0)).toBe(TravelCost.OBSTACLE);
    const viewer = spawnSoldier(sim, 0, Team.OUR, at(2, 6), Direction.SOUTH);
    const other = spawnSoldier(sim, 1, Team.OUR, at(2, 10), Direction.NORTH);
    expect(soldierToSoldierLos(t, viewer, other, SIGHT_TILES, true)).toBeGreaterThan(0);
    const cut = swapStructureForPartner(t, structureAt(sim, g, StructureFlags.WIREFENCE));
    expect(cut?.def.flags).toBe(
      (StructureFlags.WIREFENCE | StructureFlags.TRANSPARENT | StructureFlags.OPEN | StructureFlags.PASSABLE) >>> 0,
    );
    recompileLocalMovementCosts(t.world.costs, t.world, g);
    expect(t.world.costs.get(g, Direction.NORTH, 0)).toBe(TravelCost.NOT_STANDING);
    expect(t.world.costs.get(g, Direction.WEST, 0)).toBe(TravelCost.OBSTACLE);
  });

  it('gives a crouched target behind the sandbags cover that the same target in the open lacks', () => {
    const sim = village();
    const t = sim.state;
    const shooter = spawnSoldier(sim, 0, Team.OUR, at(8, 1), Direction.SOUTH);
    const covered = spawnSoldier(sim, 20, Team.ENEMY, at(8, 10), Direction.NORTH);
    const control = spawnSoldier(sim, 1, Team.OUR, at(12, 1), Direction.SOUTH);
    const open = spawnSoldier(sim, 21, Team.ENEMY, at(12, 10), Direction.NORTH);
    crouch(sim, covered);
    crouch(sim, open);
    const behind = soldierToSoldierChanceToGetThrough(t, shooter, covered);
    const inTheOpen = soldierToSoldierChanceToGetThrough(t, control, open);
    expect(inTheOpen).toBeGreaterThan(0);
    expect(behind).toBeLessThan(inTheOpen);
  });

  it('lets sight and bullets through the window but not the stone wall', () => {
    const sim = village();
    const t = sim.state;
    const shooter = spawnSoldier(sim, 0, Team.OUR, at(18, 2), Direction.SOUTH);
    const target = spawnSoldier(sim, 20, Team.ENEMY, at(18, 10), Direction.NORTH);
    const wallShooter = spawnSoldier(sim, 1, Team.OUR, at(16, 2), Direction.SOUTH);
    const wallTarget = spawnSoldier(sim, 21, Team.ENEMY, at(16, 10), Direction.NORTH);
    expect(soldierToSoldierLos(t, shooter, target, SIGHT_TILES, true)).toBeGreaterThan(0);
    expect(soldierToSoldierLos(t, wallShooter, wallTarget, SIGHT_TILES, true)).toBe(0);
    expect(soldierToSoldierChanceToGetThrough(t, shooter, target)).toBeGreaterThan(0);
    expect(soldierToSoldierChanceToGetThrough(t, wallShooter, wallTarget)).toBe(0);
    expect(t.world.costs.get(at(18, 6), Direction.NORTH, 0)).toBe(TravelCost.WALL);
  });

  it('sees along the wall from its tiles, the wall filling one edge of each tile like the original walls', () => {
    const sim = village();
    const t = sim.state;
    const viewer = spawnSoldier(sim, 0, Team.OUR, at(15, 6), Direction.EAST);
    const other = spawnSoldier(sim, 1, Team.OUR, at(21, 6), Direction.WEST);
    const wall = structureAt(sim, at(16, 6), StructureFlags.WALL);
    expect([...wall.tile.shape].filter((cubes) => cubes !== 0)).toHaveLength(5);
    expect(soldierToSoldierLos(t, viewer, other, SIGHT_TILES, true)).toBeGreaterThan(0);
    expect(soldierToSoldierChanceToGetThrough(t, viewer, other)).toBeGreaterThan(0);
  });

  it('shatters the window glass with a shot through it', () => {
    const sim = village();
    const window = at(18, 6);
    const shooter = spawnSoldier(sim, 0, Team.OUR, at(18, 2), Direction.SOUTH, { marksmanship: 90 });
    const target = spawnSoldier(sim, 20, Team.ENEMY, at(18, 10), Direction.NORTH);
    expect(structureAt(sim, window, StructureFlags.WALLNWINDOW).def.partnerDelta).toBe(1);
    sim.lookAround();
    sim.drainEvents();
    expect(sim.dispatch({ type: 'attack', soldier: shooter.id, target: target.gridNo }).ok).toBe(true);
    runUntilIdle(sim);
    expect(structureAt(sim, window, StructureFlags.WALLNWINDOW).def.flags & StructureFlags.OPEN).not.toBe(0);
  });

  it('climbs onto the flat roof but finds no climb point at the slanted and the high roof', () => {
    const sim = village();
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, at(25, 4), Direction.NORTH);
    const slanted = spawnSoldier(sim, 1, Team.OUR, at(25, 10), Direction.NORTH);
    const high = spawnSoldier(sim, 2, Team.OUR, at(30, 10), Direction.NORTH);
    expect(findHigherLevel(t, merc)).toBe(Direction.NORTH);
    expect(findHigherLevel(t, slanted)).toBe(-1);
    expect(findHigherLevel(t, high)).toBe(-1);
    expect(structureAt(sim, at(25, 9), StructureFlags.ROOF).def.flags).toBe(StructureFlags.SLANTED_ROOF);
    expect(structureAt(sim, at(30, 9), StructureFlags.ROOF).def.flags).toBe(StructureFlags.TALL_ROOF);
    expect(t.world.costs.get(at(25, 8), Direction.NORTH, 1)).toBe(TravelCost.OBSTACLE);
    expect(t.world.costs.get(at(25, 2), Direction.NORTH, 1)).toBe(TravelCost.FLAT);
    expect(sim.dispatch({ type: 'climb', soldier: merc.id })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.level).toBe(1);
    expect(merc.gridNo).toBe(at(25, 3));
  });

  it('stops movement and sight at the cliff, and a raised plateau behind it is a step nobody walks', async () => {
    const sim = village();
    const t = sim.state;
    const cliff = at(36, 3);
    for (let d = 0; d < 8; d++) expect(t.world.costs.get(cliff, d, 0)).toBe(TravelCost.OBSTACLE);
    const viewer = spawnSoldier(sim, 0, Team.OUR, at(36, 0), Direction.SOUTH);
    const other = spawnSoldier(sim, 1, Team.OUR, at(36, 6), Direction.NORTH);
    expect(soldierToSoldierLos(t, viewer, other, SIGHT_TILES, true)).toBe(0);
    const world = kit.world(VILLAGE);
    const lip = levelTilesAt(world.level.layers.objects, at(36, 2))[0] ?? -1;
    expect((world.tiles[lip]?.flags ?? 0) & TileFlags.CLIFFHANG).not.toBe(0);
    const inputs = await loadTacticalWorldInputs(kit.read, VILLAGE);
    const heights = inputs.map.heights.slice();
    for (let x = 34; x <= 38; x++) for (let y = 0; y <= 2; y++) heights[at(x, y)] = WORLD_CLIFF_HEIGHT;
    const raised = buildTacticalWorldFromInputs({ ...inputs, map: { ...inputs.map, heights } });
    expect(raised.costs.get(at(36, 1), Direction.WEST, 0)).toBe(TravelCost.FLAT);
    expect(raised.costs.get(at(34, 1), Direction.WEST, 0)).toBe(TravelCost.OBSTACLE);
    expect(raised.costs.get(at(33, 1), Direction.WEST, 0)).toBe(TravelCost.FLAT);
  });

  it('walks over loose rocks like open ground', () => {
    const sim = village();
    const t = sim.state;
    for (let x = 34; x <= 36; x++) {
      const g = at(x, 8);
      expect(levelTilesAt(t.world.level.layers.objects, g)).toHaveLength(1);
      expect(t.world.structures.at(g)).toHaveLength(0);
      for (let d = 0; d < 8; d++) expect(t.world.costs.get(g, d, 0)).toBe(TravelCost.FLAT);
    }
    const merc = spawnSoldier(sim, 0, Team.OUR, at(32, 8), Direction.EAST);
    walk(sim, merc, at(38, 8));
    expect(merc.gridNo).toBe(at(38, 8));
  });

  it('places an item tile from the stub item sheets without a structure', () => {
    const world = kit.world(VILLAGE);
    const g = at(36, 10);
    const [tile] = levelTilesAt(world.level.layers.structs, g);
    const te = tile === undefined ? undefined : world.tiles[tile];
    expect(te?.type).toBe(typeIndex(world.tables, 'P1ITEMS'));
    expect(te?.surfacePath).toMatch(/items1\.sprite\.json$/);
    expect((te?.flags ?? 0) & TileFlags.OBJECTLAYER_USEZHEIGHT).not.toBe(0);
    expect(world.structures.at(g)).toHaveLength(0);
    expect(world.costs.get(g, Direction.NORTH, 0)).toBe(TravelCost.FLAT);
  });
});
