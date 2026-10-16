import { beforeAll, describe, expect, it } from 'vitest';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { type ArmyContent, parseArmyCompositions, parseGarrisonGroups, parsePatrolGroups } from './army.ts';
import { parseSectorId } from './sector-ids.ts';

let army: ArmyContent;

beforeAll(async () => {
  army = await loadArmyTestContent();
});

describe('army content from data/externalized', () => {
  it('loads the 27 compositions, 57 garrisons and 29 patrols in file order', () => {
    expect(army.compositions).toHaveLength(27);
    expect(army.compositions[0]).toMatchObject({ name: 'QUEEN_DEFENCE', priority: 100, elitePct: 100, desired: 32, start: 32 });
    expect(army.compositions[25]).toMatchObject({ name: 'ROADBLOCK', priority: 20, elitePct: 2, troopPct: 98, desired: 8, start: 0 });
    expect(army.garrisons).toHaveLength(57);
    expect(army.garrisons[0]).toEqual({ sector: parseSectorId('P3'), composition: 0 });
    expect(army.garrisons[25]).toEqual({ sector: parseSectorId('H1'), composition: 8 });
    expect(army.garrisons[56]).toEqual({ sector: parseSectorId('C5'), composition: 26 });
    expect(army.patrols).toHaveLength(29);
    expect(army.patrols[3]).toEqual({
      size: 6,
      priority: 30,
      points: [parseSectorId('B10'), parseSectorId('B12'), 0, 0],
      fillDayMod100: -1,
    });
  });

  it('reads the strategic AI policy and the progress weights', () => {
    expect(army.policy.queensPoolOfTroops).toEqual([150, 200, 400]);
    expect(army.policy.timeEvaluateVariance).toEqual([240, 180, 120]);
    expect(army.policy.refillDefeatedPatrolGroups).toBe(false);
    expect(army.progress).toMatchObject({ weightKills: 25, weightControl: 25, weightIncome: 50, killsPerPoint: [7, 10, 15] });
  });

  it('rejects unknown compositions, unaligned or too many patrol points and bad counts', () => {
    expect(() => parseGarrisonGroups([{ sector: 'A1', composition: 'NOPE' }], army.compositions)).toThrow(/unknown composition/);
    expect(() => parsePatrolGroups([{ size: 5, priority: 5, points: ['A1', 'B2'] }])).toThrow(/axis-aligned/);
    expect(() => parsePatrolGroups([{ size: 5, priority: 5, points: ['A1', 'A2', 'A3', 'A4', 'A5'] }])).toThrow(/points/);
    expect(() => parseArmyCompositions([])).toThrow(/compositions/);
  });
});
