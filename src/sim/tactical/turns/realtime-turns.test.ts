import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { Opp } from '../perception/opp.ts';
import { Team } from '../soldier.ts';
import { createRealtimeClock, type TacticalState } from '../state.ts';
import { exitCombatMode, handleRealtimeTurns, handleTacticalEndTurn } from './turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NOW = 100_000;
const DECAY_PERIOD_SECONDS = 20;

function rememberedEnemy(): { t: TacticalState; world: { seconds: number }; enemyId: number } {
  const sim = newCombatSim(content);
  const t = sim.state;
  spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(110, 110), Direction.SOUTH);
  const world = { seconds: NOW };
  t.worldClock = world;
  const ours = t.perception.publicOpp[Team.OUR];
  if (ours) ours[enemy.id] = Opp.SEEN_THIS_TURN;
  return { t, world, enemyId: enemy.id };
}

function publicValue(t: TacticalState, id: number): number {
  return t.perception.publicOpp[Team.OUR]?.[id] ?? Opp.NOT_HEARD_OR_SEEN;
}

describe('real-time turns', () => {
  it('fall on the 20 ms overhead counter, so a turn comes every 5020 ms', () => {
    const t = newCombatSim(content).state;
    t.inCombat = false;
    const clock = createRealtimeClock();
    const turns: number[] = [];
    for (t.clockMs = 5; t.clockMs <= 15_100; t.clockMs += 5) {
      const before = clock.lastTurnMs;
      handleRealtimeTurns(t, clock);
      if (clock.lastTurnMs !== before) turns.push(t.clockMs);
    }
    expect(turns).toEqual([5020, 10040, 15060]);
  });
});

describe('the real-time opplist decay', () => {
  it('waits 20 world seconds, however far the tactical clock runs', () => {
    const { t, world, enemyId } = rememberedEnemy();
    const clock = createRealtimeClock();
    clock.lastOpplistDecaySeconds = NOW;
    t.clockMs += 60_000;
    world.seconds = NOW + DECAY_PERIOD_SECONDS - 1;
    handleTacticalEndTurn(t, clock);
    expect([publicValue(t, enemyId), clock.lastOpplistDecaySeconds]).toEqual([Opp.SEEN_THIS_TURN, NOW]);
    world.seconds = NOW + DECAY_PERIOD_SECONDS;
    handleTacticalEndTurn(t, clock);
    expect([publicValue(t, enemyId), clock.lastOpplistDecaySeconds]).toEqual([Opp.SEEN_LAST_TURN, NOW + DECAY_PERIOD_SECONDS]);
  });

  it('compares the stamp as UINT32, so a stamp ahead of the clock decays at once', () => {
    const { t, enemyId } = rememberedEnemy();
    const clock = createRealtimeClock();
    clock.lastOpplistDecaySeconds = NOW + 1;
    handleTacticalEndTurn(t, clock);
    expect([publicValue(t, enemyId), clock.lastOpplistDecaySeconds]).toEqual([Opp.SEEN_LAST_TURN, NOW]);
  });

  it('runs once more right after combat, after the real-time turn of leaving it', () => {
    const due = rememberedEnemy();
    const clock = createRealtimeClock();
    due.t.inCombat = true;
    clock.lastOpplistDecaySeconds = NOW - DECAY_PERIOD_SECONDS;
    exitCombatMode(due.t);
    handleRealtimeTurns(due.t, clock);
    expect([publicValue(due.t, due.enemyId), clock.lastOpplistDecaySeconds]).toEqual([Opp.SEEN_2_TURNS_AGO, NOW]);
    const recent = rememberedEnemy();
    const recentClock = createRealtimeClock();
    recent.t.inCombat = true;
    recentClock.lastOpplistDecaySeconds = NOW - 1;
    exitCombatMode(recent.t);
    handleRealtimeTurns(recent.t, recentClock);
    expect([publicValue(recent.t, recent.enemyId), recentClock.lastOpplistDecaySeconds]).toEqual([Opp.SEEN_LAST_TURN, NOW]);
  });
});
