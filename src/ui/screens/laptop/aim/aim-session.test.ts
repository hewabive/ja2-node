import { describe, expect, it } from 'vitest';
import type { AimMercView } from '../../../../protocol/view.ts';
import { AIM_ASCEND, AIM_DESCEND, AimSession, AimSortCriterion, aimMemory, sortedAimOrder } from './aim-session.ts';

function merc(profile: number, week: number, marksmanship: number): AimMercView {
  return {
    profile,
    salary: { day: 0, week, twoWeeks: 0 },
    stats: { experience: 1, marksmanship, medical: 0, explosives: 0, mechanical: 0 },
  } as unknown as AimMercView;
}

const MERCS = [merc(10, 500, 70), merc(11, 900, 90), merc(12, 500, 80), merc(13, 200, 90)];

describe('the A.I.M. member order', () => {
  it('sorts by the chosen criterion and keeps the listing order between equals', () => {
    expect(sortedAimOrder(MERCS, AimSortCriterion.PRICE, AIM_DESCEND)).toEqual([11, 10, 12, 13]);
    expect(sortedAimOrder(MERCS, AimSortCriterion.PRICE, AIM_ASCEND)).toEqual([13, 10, 12, 11]);
    expect(sortedAimOrder(MERCS, AimSortCriterion.MARKSMANSHIP, AIM_DESCEND)).toEqual([11, 13, 12, 10]);
  });

  it('starts from the listing order and wraps the previous and next buttons', () => {
    const memory = aimMemory();
    const session = new AimSession(memory);
    expect(session.ordered(MERCS).map((m) => m.profile)).toEqual([10, 11, 12, 13]);
    session.step(MERCS, -1);
    expect(session.current(MERCS)?.profile).toBe(13);
    session.step(MERCS, 1);
    expect(session.current(MERCS)?.profile).toBe(10);
    memory.sortCriterion = AimSortCriterion.PRICE;
    memory.listMode = AIM_ASCEND;
    session.sortOrder(MERCS);
    expect(session.current(MERCS)?.profile).toBe(13);
    session.resetOrder(MERCS);
    expect(memory.order).toEqual([10, 11, 12, 13]);
  });
});
