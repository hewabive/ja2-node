import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { CompressMode } from '../../strategic/time/constants.ts';
import type { TacticalContent } from '../content.ts';
import { Opp } from '../perception/opp.ts';
import { Body, type Soldier, Team } from '../soldier.ts';
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
  const world = { seconds: NOW, paused: false, mode: CompressMode.X1 };
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

  it('wait while the game is paused, their timer running on, so the first counter after the pause brings one (HandleStrategicTurn)', () => {
    const t = newCombatSim(content).state;
    t.inCombat = false;
    const world = { seconds: NOW, paused: true, mode: CompressMode.X1 };
    t.worldClock = world;
    const clock = createRealtimeClock();
    const turns: number[] = [];
    const runTo = (endMs: number) => {
      for (t.clockMs += 5; t.clockMs <= endMs; t.clockMs += 5) {
        const before = clock.lastTurnMs;
        handleRealtimeTurns(t, clock);
        if (clock.lastTurnMs !== before) turns.push(t.clockMs);
      }
      t.clockMs -= 5;
    };
    t.clockMs = 0;
    runTo(12_000);
    expect(turns).toEqual([]);
    world.paused = false;
    runTo(17_100);
    expect(turns).toEqual([12_020, 17_040]);
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

describe('the real-time turn of our team', () => {
  function turnCounters(s: Soldier): number[] {
    return [s.numHitsThisTurn, s.shock];
  }

  it('skips the robot and our vehicles (IsMechanical), so their APs and per-turn counters wait for combat', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.inCombat = false;
    t.worldClock = { seconds: NOW, paused: false, mode: CompressMode.X1 };
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
    const robot = spawnSoldier(sim, 1, Team.OUR, gridNo(62, 60), Direction.NORTH, { body: Body.ROBOTNOWEAPON });
    const jeep = spawnSoldier(sim, 2, Team.OUR, gridNo(66, 60), Direction.NORTH, { body: Body.JEEP });
    for (const s of [merc, robot, jeep]) {
      s.actionPoints = 0;
      s.numHitsThisTurn = 3;
      s.shock = 6;
    }
    handleTacticalEndTurn(t, createRealtimeClock());
    expect(turnCounters(merc)).toEqual([0, 3]);
    expect(merc.actionPoints).toBeGreaterThan(0);
    expect([robot.actionPoints, ...turnCounters(robot)]).toEqual([0, 3, 6]);
    expect([jeep.actionPoints, ...turnCounters(jeep)]).toEqual([0, 3, 6]);
  });
});
