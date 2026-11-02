import { describe, expect, it } from 'vitest';
import { ArrivalBox } from './arrival-box.ts';

const AIM_HIRE = { profile: 3, arrivalMinute: 1860, sector: 'A9' };
const MERC_HIRE = { profile: 41, arrivalMinute: 2280, sector: 'A9' };

describe('the arrival box', () => {
  it('explains one hire per laptop session, whichever site hired, and none before a hire', () => {
    const session = new ArrivalBox();
    expect(session.take()).toBeNull();
    session.hired(AIM_HIRE);
    expect(session.take()).toEqual(AIM_HIRE);
    session.hired(MERC_HIRE);
    expect(session.take()).toBeNull();
    const next = new ArrivalBox();
    next.hired(MERC_HIRE);
    next.hired(AIM_HIRE);
    expect(next.take()).toEqual(AIM_HIRE);
  });
});
