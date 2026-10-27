import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../tests/support/combat.ts';
import { loadTestContent } from '../../tests/support/tactical.ts';
import { Direction, gridNo } from '../content/world/grid.ts';
import { BulletFlag } from '../sim/tactical/combat/bullets.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { BulletFlights } from './bullet-flights.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('bullet flights', () => {
  it('dates a knife from the tick it was first seen in the ticks of the session', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.SOUTH);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 90) }).ok).toBe(true);
    const flights = new BulletFlights();
    while (flights.views(sim.state, 0).length === 0) sim.step();
    for (const b of sim.state.bullets) b.flags |= BulletFlag.KNIFE;
    const sessionTick = 1000;
    expect(flights.views(sim.state, sessionTick)[0]?.knife?.since).toBe(sessionTick);
    sim.step();
    expect(flights.views(sim.state, sessionTick + 1)[0]?.knife?.since).toBe(sessionTick);
  });
});
