import { beforeAll, describe, expect, it } from 'vitest';
import { loadArmyTestContent, queenTestContext, RecordingRolls } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import { type ArmyContent, byDifficultyLevel } from '../../../content/strategic/army.ts';
import { parseSectorId, sectorFromId, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { gameOptions } from '../../options.ts';
import { EnemyIntention, MoveType } from '../forces/constants.ts';
import { getGroup } from '../forces/groups.ts';
import type { RollSource } from '../forces/ports.ts';
import { initStrategicLayerMap } from '../map/init.ts';
import { sectorInfo } from '../map/sectors.ts';
import { getSectorMvtTimeForGroup } from '../map/travel.ts';
import { createStrategicState } from '../state.ts';
import { EventKind } from '../time/constants.ts';
import { Composition, MAX_STRATEGIC_TEAM_SIZE } from './constants.ts';
import type { QueenContext } from './context.ts';
import { initStrategicAI } from './init.ts';
import { garrisonWeight } from './weights.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

type Stream = 'zeros' | 'maxima';

class SwitchableRolls implements RollSource {
  target: RollSource;

  constructor(target: RollSource) {
    this.target = target;
  }

  int(n: number): number {
    return this.target.int(n);
  }

  chance(percent: number): boolean {
    return this.target.chance(percent);
  }
}

function initialized(difficulty: number, stream: Stream): { q: QueenContext; rolls: RecordingRolls } {
  const state = createStrategicState({ options: gameOptions({ difficulty, sciFi: false }), seed: 7 });
  const rolls = stream === 'zeros' ? RecordingRolls.zeros() : RecordingRolls.maxima();
  const random = new SwitchableRolls(state.rng);
  const q = queenTestContext({ content, army, state, random });
  initStrategicLayerMap(q, {
    initStrategicAI: () => {
      random.target = rolls;
      initStrategicAI(q);
      random.target = state.rng;
    },
  });
  return { q, rolls };
}

function scaled(value: number, percent: number, cap: number): number {
  return Math.min(cap, Math.trunc((value * percent) / 100));
}

function scaledStart(difficulty: number, ci: number): { start: number; desired: number } {
  const c = army.compositions[ci];
  if (!c) throw new Error('composition');
  let { start, desired } = c;
  if ((difficulty === 1 && ci === Composition.LEVEL2_DEFENCE) || (difficulty <= 2 && ci === Composition.LEVEL3_DEFENCE)) {
    start = 0;
    desired = 0;
  }
  const f = byDifficultyLevel(army.policy.initialGarrisonPercentages, difficulty);
  if (f === 100) return { start, desired };
  if (ci === Composition.QUEEN_DEFENCE) {
    const d = scaled(desired, f, 32);
    return { start: d, desired: d };
  }
  return { desired: scaled(desired, f, 20), start: start === 20 ? 20 : scaled(start, f, 20) };
}

function expectedGarrisonRanges(difficulty: number, stream: Stream): number[] {
  const ranges: number[] = [];
  const min = byDifficultyLevel(army.policy.minEnemyGroupSize, difficulty);
  for (const g of army.garrisons) {
    const comp = army.compositions[g.composition];
    if (!comp) throw new Error('composition');
    let { start, desired } = scaledStart(difficulty, g.composition);
    if (g.composition === Composition.ROADBLOCK) {
      ranges.push(100);
      start = stream === 'zeros' ? desired : 0;
    }
    if (g.composition === Composition.SANMONA_SMALL) start = 0;
    if (start !== 0 && g.sector !== parseSectorId('P3')) {
      if (start !== 20) {
        ranges.push(51);
        start = Math.trunc((start * (stream === 'zeros' ? 75 : 125)) / 100);
      }
      start = Math.min(Math.max(start, min), MAX_STRATEGIC_TEAM_SIZE);
    }
    if (start !== 0 && comp.adminPct === 0) for (let k = 0; k < start; k++) ranges.push(100);
    ranges.push(4);
  }
  return ranges;
}

const DIFFICULTIES = [1, 2, 3] as const;
const STREAMS: readonly Stream[] = ['zeros', 'maxima'];

describe('initStrategicAI draw order', () => {
  for (const difficulty of DIFFICULTIES) {
    for (const stream of STREAMS) {
      it(`draws in the original order on difficulty ${difficulty} with ${stream}`, () => {
        const { q, rolls } = initialized(difficulty, stream);
        const garrisonRanges = expectedGarrisonRanges(difficulty, stream);
        const variance = byDifficultyLevel(army.policy.timeEvaluateVariance, difficulty);
        expect(rolls.ranges[0]).toBe(variance);
        expect(rolls.ranges.slice(1, 1 + garrisonRanges.length)).toEqual(garrisonRanges);
        let at = 1 + garrisonRanges.length;
        const queen = q.state.queen;
        for (const pg of queen.patrols) {
          const points = pg.points.filter((p) => p !== 0).length;
          const sleeps = stream === 'zeros';
          const chunk = [3, 100, ...(sleeps ? [121] : []), 2 * (points - 1), 100, ...(sleeps ? [121] : [])];
          expect(rolls.ranges.slice(at, at + chunk.length)).toEqual(chunk);
          at += chunk.length;
          const g = getGroup(q, pg.group);
          if (!g) throw new Error('patrol group');
          const direction = g.next.x > g.sector.x ? 1 : g.next.y > g.sector.y ? 2 : g.next.x < g.sector.x ? 3 : 0;
          const traverse = getSectorMvtTimeForGroup(q, sectorId(g.sector), direction, g) + (sleeps ? 360 : 0);
          if (traverse > 1) expect(rolls.ranges[at++]).toBe(traverse - 1);
          expect(g.traverseTime).toBe(stream === 'zeros' ? 1 : Math.max(1, traverse - 1));
        }
        expect(rolls.ranges.slice(at)).toEqual([content.cacheSectors.sectors.length]);
      });
    }
  }
});

describe('state after initStrategicAI', () => {
  it('fills P3, A9, Drassen and the admin patrols as the original', () => {
    for (const difficulty of DIFFICULTIES) {
      const { q } = initialized(difficulty, 'zeros');
      const at = (s: string) => sectorInfo(q.state.map, sectorFromId(parseSectorId(s)));
      expect(at('P3').numElites).toBe(difficulty === 1 ? 22 : 32);
      expect(at('A9').numTroops).toBe([3, 4, 6][difficulty - 1]);
      expect(at('C13').numTroops + at('C13').numElites).toBe(0);
      expect(at('C13').numAdmins).toBeGreaterThanOrEqual(5);
      const patrol3 = getGroup(q, q.state.queen.patrols[3]?.group ?? 0);
      expect(patrol3?.enemy?.numTroops).toBe(0);
      expect(patrol3?.enemy?.numAdmins).toBe(patrol3?.size);
    }
  });

  it('posts one day-0 evaluation, 57 periodic checks and a patrol arrival each', () => {
    const { q } = initialized(2, 'zeros');
    const events = q.state.queue.events;
    const evaluation = events.filter((e) => e.kind === EventKind.EVALUATE_QUEEN_SITUATION);
    expect(evaluation.map((e) => e.stamp)).toEqual([(475 + 360) * 60]);
    const checks = events.filter((e) => e.kind === EventKind.CHECK_ENEMY_CONTROLLED_SECTOR);
    expect(checks).toHaveLength(57);
    const byParam = new Map(checks.map((e) => [e.param, e]));
    army.garrisons.forEach((g, gi) => {
      expect(byParam.get(g.sector)?.stamp).toBe(86400 + (475 + gi) * 60);
      expect(byParam.get(g.sector)?.offset).toBe((140 - 40) * 60);
    });
    expect(events.filter((e) => e.kind === EventKind.GROUP_ARRIVAL)).toHaveLength(29);
    expect(q.state.queen.patrols.map((p) => p.group)).toEqual(Array.from({ length: 29 }, (_, k) => k + 1));
    expect(q.state.queen.awake).toBe(false);
  });

  it('stands every patrol on one of its points with a consistent next waypoint', () => {
    for (const stream of STREAMS) {
      const { q } = initialized(3, stream);
      for (const pg of q.state.queen.patrols) {
        const g = getGroup(q, pg.group);
        if (!g?.enemy) throw new Error('patrol group');
        expect(g.enemy.intention).toBe(EnemyIntention.PATROL);
        const points = pg.points.filter((p) => p !== 0);
        const standing = points.indexOf(sectorId(g.sector));
        expect(standing).toBeGreaterThanOrEqual(0);
        if (g.moveType === MoveType.ENDTOEND_FORWARDS) expect(g.nextWaypointId).toBe(standing + 1);
        else {
          expect(g.moveType).toBe(MoveType.ENDTOEND_BACKWARDS);
          expect(g.nextWaypointId).toBe(standing - 1);
        }
        expect(g.betweenSectors).toBe(true);
        expect(g.arrivalTime - Math.trunc(q.state.clock.seconds / 60)).toBe(g.traverseTime);
      }
    }
  });

  it('keeps the request and reinforcement totals equal to the initial weights', () => {
    for (const difficulty of DIFFICULTIES) {
      const { q } = initialized(difficulty, 'zeros');
      const queen = q.state.queen;
      const positive = queen.garrisons.reduce((n, g) => n + Math.max(0, g.weight), 0);
      const negative = queen.garrisons.reduce((n, g) => n - Math.min(0, g.weight), 0);
      expect(queen.requestPoints).toBe(positive);
      expect(queen.reinforcementPoints).toBe(negative);
      expect(queen.patrols.every((p) => p.weight === 0)).toBe(true);
    }
  });

  it('weighs a new garrison by its rolled start size, not by the soldiers it got: Cambria counts its troops only, Drassen ignores its admin floor', () => {
    const { q } = initialized(2, 'zeros');
    const at = (s: string) => sectorInfo(q.state.map, sectorFromId(parseSectorId(s)));
    const weightOf = (s: string) => q.state.queen.garrisons.find((g) => g.sector === parseSectorId(s))?.weight;
    expect(at('C13')).toMatchObject({ numAdmins: 5, numTroops: 0, numElites: 0 });
    expect(weightOf('C13')).toBe(garrisonWeight(10, 6, 20));
    expect(at('F8')).toMatchObject({ numAdmins: 4, numTroops: 3, numElites: 0 });
    expect(weightOf('F8')).toBe(garrisonWeight(10, 3, 50));
  });

  it('scales patrol sizes by difficulty with the minimum group size', () => {
    const sizes = (d: number) => initialized(d, 'zeros').q.state.queen.patrols.map((p) => p.size);
    expect(sizes(1)).toEqual([5, 4, 4, 4, 4, 4, 8, 7, 7, 7, 8, 8, 8, 7, 9, 9, 7, 8, 8, 8, 9, 8, 8, 8, 9, 4, 4, 5, 8]);
    expect(sizes(2)).toEqual(army.patrols.map((p) => p.size));
    expect(sizes(3)).toEqual([10, 7, 7, 7, 8, 7, 15, 12, 12, 12, 15, 15, 15, 12, 17, 16, 13, 15, 15, 15, 16, 15, 15, 15, 17, 8, 8, 10, 15]);
  });
});
