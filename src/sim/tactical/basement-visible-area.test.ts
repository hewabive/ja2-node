import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { handleNextTile } from './movement.ts';
import { findBestPath, newOKDestination } from './pathfinding.ts';
import { Team } from './soldier.ts';
import { onVisibleWorldTile, whoIsThere } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

const BASEMENT = 'stubs/world/maps/a10_b1.dat';
const SURFACE = 'stubs/world/maps/a9.dat';
const INSIDE = gridNo(80, 80);
const NEAR_EDGE = gridNo(100, 80);
const OUTSIDE = gridNo(112, 80);

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function simOn(path: string, seed = 1): TacticalSim {
  return new TacticalSim(kit.world(path), kit.content, seed);
}

describe('the visible area of a basement map', () => {
  it('gives terrain and movement costs only to the tiles inside the basement render bounds', () => {
    const basement = kit.world(BASEMENT);
    expect(basement.map.info.restrictedScrollId).toBe(1);
    expect([basement.costs.get(OUTSIDE, Direction.EAST, 0), basement.costs.get(OUTSIDE, Direction.EAST, 1)]).toEqual([
      TravelCost.OFF_MAP,
      TravelCost.OFF_MAP,
    ]);
    expect(basement.terrain[OUTSIDE]).toBe(0);
    expect(basement.terrain[NEAR_EDGE]).not.toBe(0);
    expect(kit.world(SURFACE).costs.get(OUTSIDE, Direction.EAST, 0)).not.toBe(TravelCost.OFF_MAP);
  });

  it('refuses a destination outside it that the full map would allow', () => {
    for (const [path, allowed] of [
      [BASEMENT, false],
      [SURFACE, true],
    ] as const) {
      const sim = simOn(path);
      const merc = spawnSoldier(sim, 0, Team.OUR, INSIDE, Direction.EAST);
      expect(newOKDestination(sim.state.pathEnv, merc, OUTSIDE, true, 0)).toBe(allowed);
    }
  });

  it('finds no path from a soldier standing outside it', () => {
    const sim = simOn(BASEMENT);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, Direction.WEST);
    expect(merc.offMap).toBe(true);
    expect(merc.placed).toBe(false);
    expect(findBestPath(t.pathEnv, merc, NEAR_EDGE, 0).length).toBe(0);
    expect(whoIsThere(t, OUTSIDE, 0)).toBeNull();
    expect(handleNextTile(t, merc, Direction.WEST, OUTSIDE, NEAR_EDGE)).toBe(true);
  });

  it('removes a missed bullet as soon as it leaves the basement', () => {
    const stops = [BASEMENT, SURFACE].map((path) => {
      const sim = simOn(path, 1);
      const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(96, 80), Direction.EAST, { marksmanship: 1 });
      const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(106, 80), Direction.WEST);
      sim.state.inCombat = true;
      merc.oppList[enemy.id] = 1;
      expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo }).ok).toBe(true);
      const stop = runUntilIdle(sim).find((e) => e.type === 'bulletStopped');
      return { sim, stop: stop?.type === 'bulletStopped' ? stop : null };
    });
    const [basement, surface] = stops;
    expect(basement?.stop?.reason).toBe('offMap');
    expect(basement && onVisibleWorldTile(basement.sim.state, basement.stop?.gridNo ?? -1)).toBe(true);
    expect(surface?.stop?.reason).toBe('ground');
  });
});
