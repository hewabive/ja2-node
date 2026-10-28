import { beforeAll, describe, expect, it } from 'vitest';
import { loadArmyTestContent, newCampaign } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { sectorFromId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Rng } from '../../../core/rng.ts';
import { getGroup } from '../forces/groups.ts';
import { sectorInfo } from '../map/sectors.ts';
import { NUM_SEC_IN_DAY } from '../time/constants.ts';
import type { QueenContext } from './context.ts';
import {
  garrisonReinforcementsRequested,
  garrisonWeight,
  permittedToFillPatrolGroup,
  recalculateGarrisonWeight,
  recalculateGroupWeight,
  recalculatePatrolWeight,
  reinforcementsAvailable,
} from './weights.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

function totalsMatchWeights(q: QueenContext): void {
  const queen = q.state.queen;
  const positive =
    queen.garrisons.reduce((n, g) => n + Math.max(0, g.weight), 0) + queen.patrols.reduce((n, p) => n + Math.max(0, p.weight), 0);
  const negative = queen.garrisons.reduce((n, g) => n - Math.min(0, g.weight), 0);
  expect(queen.requestPoints).toBe(positive);
  expect(queen.reinforcementPoints).toBe(negative);
}

describe('garrison and patrol weights', () => {
  it('scales garrison weights by priority with a magnitude of at least 2', () => {
    expect(garrisonWeight(20, 20, 50)).toBe(0);
    expect(garrisonWeight(20, 19, 10)).toBe(2);
    expect(garrisonWeight(20, 0, 96)).toBe(60);
    expect(garrisonWeight(32, 0, 100)).toBe(100);
    expect(garrisonWeight(16, 20, 95)).toBe(-2);
    expect(garrisonWeight(8, 20, 20)).toBe(-30);
  });

  it('caps patrol demand with min(…, 2) and drops a destroyed patrol to the full size', () => {
    const q = newCampaign({ content, army, difficulty: 2 });
    const pg = q.state.queen.patrols[0];
    const g = getGroup(q, pg?.group ?? 0);
    if (!pg || !g) throw new Error('patrol');
    g.size = pg.size - 1;
    recalculatePatrolWeight(q, pg);
    expect(pg.weight).toBe(1);
    g.size = 0;
    recalculatePatrolWeight(q, pg);
    expect(pg.weight).toBe(2);
    g.size = pg.size + 3;
    recalculatePatrolWeight(q, pg);
    expect(pg.weight).toBe(0);
    totalsMatchWeights(q);
  });

  it('tags a destroyed patrol with the mod-100 grace period', () => {
    const q = newCampaign({ content, army, difficulty: 3 });
    const pg = q.state.queen.patrols[5];
    const g = getGroup(q, pg?.group ?? 0);
    if (!pg || !g) throw new Error('patrol');
    q.state.clock.seconds = 95 * NUM_SEC_IN_DAY;
    g.size = 0;
    recalculateGroupWeight(q, g);
    expect(pg.group).toBe(0);
    expect(pg.fillDayMod100).toBe(3);
    expect(permittedToFillPatrolGroup(q, 5)).toBe(true);
    q.state.clock.seconds = 102 * NUM_SEC_IN_DAY;
    expect(permittedToFillPatrolGroup(q, 5)).toBe(false);
    q.state.clock.seconds = 103 * NUM_SEC_IN_DAY;
    expect(permittedToFillPatrolGroup(q, 5)).toBe(true);
  });

  it('keeps the totals consistent after any sequence of recalculations', () => {
    const q = newCampaign({ content, army, difficulty: 1 });
    const rng = Rng.fromSeed(42);
    for (let gi = 0; gi < q.state.queen.garrisons.length; gi++) recalculateGarrisonWeight(q, gi);
    for (let step = 0; step < 500; step++) {
      const queen = q.state.queen;
      const gi = rng.int(queen.garrisons.length);
      const gg = queen.garrisons[gi];
      if (!gg) continue;
      const si = sectorInfo(q.state.map, sectorFromId(gg.sector));
      si.numTroops = rng.int(30);
      si.numAdmins = rng.int(5);
      recalculateGarrisonWeight(q, gi);
      const pg = queen.patrols[rng.int(queen.patrols.length)];
      if (pg) recalculatePatrolWeight(q, pg);
    }
    for (const pg of q.state.queen.patrols) recalculatePatrolWeight(q, pg);
    totalsMatchWeights(q);
  });

  it('only lets spawning compositions offer their surplus and wraps the P3 extra quirk', () => {
    const q = newCampaign({ content, army, difficulty: 2 });
    const meduna = q.state.queen.garrisons.findIndex((g) => g.composition === 1);
    const level1 = q.state.queen.garrisons.findIndex((g) => g.composition === 3);
    expect(reinforcementsAvailable(q, meduna)).toBe(0);
    expect(reinforcementsAvailable(q, level1)).toBe(20 - 12);
    const p3 = sectorInfo(q.state.map, sectorFromId(q.state.queen.garrisons[0]?.sector ?? 0));
    p3.numElites = 0;
    q.state.queen.garrisonDenied[0] = 12;
    expect(garrisonReinforcementsRequested(q, 0)).toEqual({ requested: 20, extra: (20 - 32) & 0xff });
    p3.numElites = 30;
    expect(garrisonReinforcementsRequested(q, 0)).toEqual({ requested: 2, extra: 3 });
  });
});
