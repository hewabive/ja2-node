import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { reduceAttackBusyCount } from './barrier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const SHOOTER_AT = gridNo(80, 120);
const FIRST_BURST = 12;
const SECOND_BURST = 14;
const STANCE_TICKS = 400;

function suppressedMerc() {
  const base = syntheticWorld(testDoorCosts(), () => {});
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  const sim = new TacticalSim(world, content, 3);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
  const shooter = spawnSoldier(sim, 20, Team.ENEMY, SHOOTER_AT, Direction.NORTH);
  t.inCombat = true;
  merc.suppressionPoints = FIRST_BURST;
  t.turn.attackBusyCount = 1;
  reduceAttackBusyCount(t, shooter, false);
  return { sim, merc };
}

function runUntil(sim: TacticalSim, ticks: number, done: () => boolean): void {
  for (let tick = 0; tick < ticks && !done(); tick++) sim.step();
}

describe('a suppression stance change started at the end of the previous one', () => {
  it('plays to its end and releases its attack busy count', () => {
    const { sim, merc } = suppressedMerc();
    const t = sim.state;
    expect(animName(t.content, merc.state)).toBe('KNEEL_DOWN');
    expect(t.turn.attackBusyCount).toBe(1);
    merc.suppressionPoints = SECOND_BURST;
    runUntil(sim, STANCE_TICKS, () => animName(t.content, merc.state) !== 'KNEEL_DOWN');
    expect(animName(t.content, merc.state)).toBe('PRONE_DOWN');
    runUntil(sim, STANCE_TICKS, () => t.turn.attackBusyCount === 0);
    expect(animName(t.content, merc.state)).toBe('PRONE');
    expect(t.turn.attackBusyCount).toBe(0);
    expect(merc.changingStanceDueToSuppression).toBe(false);
  });
});
