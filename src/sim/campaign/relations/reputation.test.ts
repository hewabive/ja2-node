import { describe, expect, it } from 'vitest';
import { noCampaignFields, noRelations, type ProfileProgress } from '../../tactical/profiles.ts';
import {
  calcDeathRate,
  mercThinksBadReputationTooHigh,
  mercThinksDeathRateTooHigh,
  mercThinksHisMoraleIsTooLow,
  modifyPlayerReputation,
} from './reputation.ts';

function profile(deathRate: number, reputationTolerance: number): ProfileProgress {
  const stats = {
    lifeMax: 80,
    agility: 80,
    dexterity: 80,
    wisdom: 80,
    medical: 20,
    explosives: 20,
    mechanical: 20,
    marksmanship: 80,
    experience: 3,
    strength: 80,
    leadership: 40,
  };
  return {
    id: 7,
    evolution: 0,
    attitude: 0,
    buddies: [],
    hated: [],
    ...noRelations(),
    life: 80,
    stats,
    gains: { ...stats },
    statChangeChances: [],
    statChangeSuccesses: [],
    kills: 0,
    assists: 0,
    shotsFired: 0,
    shotsHit: 0,
    timesWounded: 0,
    ...noCampaignFields(),
    deathRate,
    reputationTolerance,
  };
}

describe('death rate', () => {
  it('is 0 until a man-day has been played', () => {
    expect(calcDeathRate({ mercDeaths: 3, manDaysPlayed: 0 })).toBe(0);
  });

  it('truncates deaths per hundred man-days and wraps as an unsigned byte', () => {
    expect(calcDeathRate({ mercDeaths: 1, manDaysPlayed: 3 })).toBe(33);
    expect(calcDeathRate({ mercDeaths: 2, manDaysPlayed: 3 })).toBe(66);
    expect(calcDeathRate({ mercDeaths: 3, manDaysPlayed: 1 })).toBe(44);
  });

  it('is ignored by mercs whose tolerance is 101 and compared strictly otherwise', () => {
    const status = { mercDeaths: 1, manDaysPlayed: 10, badReputation: 0 };
    expect(mercThinksDeathRateTooHigh(status, profile(10, 50))).toBe(false);
    expect(mercThinksDeathRateTooHigh(status, profile(9, 50))).toBe(true);
    expect(mercThinksDeathRateTooHigh({ ...status, mercDeaths: 3, manDaysPlayed: 1 }, profile(101, 50))).toBe(false);
  });
});

describe('reputation', () => {
  it('moves the bad reputation against the change and clamps it to 0..100', () => {
    const status = { badReputation: 2 };
    modifyPlayerReputation(status, 5);
    expect(status.badReputation).toBe(0);
    modifyPlayerReputation(status, -30);
    expect(status.badReputation).toBe(30);
    modifyPlayerReputation(status, -100);
    expect(status.badReputation).toBe(100);
  });

  it('treats the per-level death penalty as a signed byte', () => {
    const status = { badReputation: 0 };
    modifyPlayerReputation(status, 0xf6);
    expect(status.badReputation).toBe(10);
  });

  it('refuses a bad reputation above the tolerance unless it is 101', () => {
    expect(mercThinksBadReputationTooHigh({ badReputation: 41 }, profile(50, 40))).toBe(true);
    expect(mercThinksBadReputationTooHigh({ badReputation: 40 }, profile(50, 40))).toBe(false);
    expect(mercThinksBadReputationTooHigh({ badReputation: 100 }, profile(50, 101))).toBe(false);
  });

  it('derives the morale tolerance from the reputation tolerance', () => {
    expect(mercThinksHisMoraleIsTooLow(profile(50, 40), 29)).toBe(true);
    expect(mercThinksHisMoraleIsTooLow(profile(50, 40), 30)).toBe(false);
    expect(mercThinksHisMoraleIsTooLow(profile(50, 101), 0)).toBe(false);
  });
});
