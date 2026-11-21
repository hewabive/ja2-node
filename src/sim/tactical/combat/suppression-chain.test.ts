import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticMap, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { animName } from '../anim-states.ts';
import { AnimHeight, endHeight, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { Attitude, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { beginMercTurn } from '../turns/turns.ts';
import { handleSuppressionFire, reduceAttackBusyCount } from './barrier.ts';
import { AiMorale } from './types.ts';

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
  const world = { ...base, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld;
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

describe('the suppression tolerance of a soldier without a profile (Overhead.cc CalcSuppressionTolerance)', () => {
  const POINTS_THAT_SHOW_ONE_TOLERANCE = 6;
  const EXPERIENCE = 3;

  function apsLost(attitude: number): number {
    const base = syntheticWorld(testDoorCosts(), () => {});
    const sim = new TacticalSim({ ...base, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld, content, 3);
    const guard = spawnSoldier(sim, 20, Team.ENEMY, MERC_AT, Direction.SOUTH);
    guard.stats.experience = EXPERIENCE;
    guard.ai.morale = AiMorale.NORMAL;
    guard.ai.attitude = attitude;
    guard.suppressionPoints = POINTS_THAT_SHOW_ONE_TOLERANCE;
    handleSuppressionFire(sim.state, null, null);
    return guard.apsLostToSuppression;
  }

  it('adds one for AGGRESSIVE, and nothing for CUNNINGAID', () => {
    expect(apsLost(Attitude.AGGRESSIVE)).toBe(2);
    expect(apsLost(Attitude.CUNNINGAID)).toBe(3);
  });
});

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

describe('the APs suppression costs (Overhead.cc HandleSuppressionFire)', () => {
  const HEAVY_FIRE = 100;
  const MAX_APS_SUPPRESSED = 8;
  const TURN_APS = 10;

  function mercUnderFire(state: 'PRONE' | 'CROUCHING') {
    const base = syntheticWorld(testDoorCosts(), () => {});
    const sim = new TacticalSim({ ...base, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld, content, 3);
    const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    merc.state = states(content.animations)[state];
    merc.actionPoints = TURN_APS;
    merc.suppressionPoints = HEAVY_FIRE;
    return { sim, merc };
  }

  it('costs a merc APs about once: the counter of APs lost to suppression is never reset, so a turn later the same fire takes none', () => {
    const { sim, merc } = mercUnderFire('PRONE');
    handleSuppressionFire(sim.state, null, null);
    expect([merc.actionPoints, merc.apsLostToSuppression]).toEqual([TURN_APS - MAX_APS_SUPPRESSED, MAX_APS_SUPPRESSED]);
    beginMercTurn(sim.state, merc);
    expect(merc.apsLostToSuppression).toBe(MAX_APS_SUPPRESSED);
    const turnStart = merc.actionPoints;
    merc.suppressionPoints = HEAVY_FIRE;
    handleSuppressionFire(sim.state, null, null);
    expect(merc.actionPoints).toBe(turnStart);
  });

  it('gives a crouched merc it lays prone AP_PRONE back less the loss, so a loss below AP_PRONE leaves him more APs than before', () => {
    const { sim, merc } = mercUnderFire('CROUCHING');
    expect(endHeight(content, merc.state)).toBe(AnimHeight.CROUCH);
    merc.apsLostToSuppression = MAX_APS_SUPPRESSED - 1;
    handleSuppressionFire(sim.state, null, null);
    expect(merc.actionPoints).toBe(TURN_APS + 1);
    expect(merc.apsLostToSuppression).toBe(MAX_APS_SUPPRESSED);
    expect(animName(content, merc.state)).toBe('PRONE_DOWN');
  });
});
