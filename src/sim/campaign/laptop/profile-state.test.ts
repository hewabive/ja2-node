import { describe, expect, it } from 'vitest';
import { MercStatus, type ProfileProgress } from '../../tactical/profiles.ts';
import { calcCompetence, calcMedicalDeposit, isMercHireable } from './profile-state.ts';

function profile(stats: Partial<ProfileProgress['stats']>, traits: [number, number] = [0, 0]): ProfileProgress {
  return {
    stats: {
      lifeMax: 84,
      agility: 81,
      dexterity: 78,
      wisdom: 74,
      medical: 31,
      explosives: 22,
      mechanical: 28,
      marksmanship: 83,
      experience: 3,
      strength: 72,
      leadership: 61,
      ...stats,
    },
    skillTrait: traits[0],
    skillTrait2: traits[1],
  } as ProfileProgress;
}

describe('the A.I.M. medical deposit', () => {
  it('follows CalcCompetence with integer stats, truncated skills and the fifth root of the level', () => {
    expect(calcCompetence(profile({}))).toBe(329);
    expect(calcMedicalDeposit(profile({}))).toBe(1600);
  });

  it('adds five percent per skill trait and uses the table at levels 1 and 10', () => {
    expect(calcCompetence(profile({}, [1, 0]))).toBe(346);
    expect(calcCompetence(profile({}, [1, 2]))).toBe(362);
    expect(calcCompetence(profile({ experience: 1 }))).toBe(245);
    expect(calcCompetence(profile({ experience: 10 }))).toBe(479);
  });

  it('rounds the deposit to the nearest hundred, half up', () => {
    expect(calcMedicalDeposit(profile({ marksmanship: 50, medical: 0, mechanical: 0, explosives: 0 }))).toBe(300);
  });
});

describe('IsMercHireable', () => {
  it('accepts the available and the slightly annoyed only while the countdown is zero', () => {
    expect(isMercHireable({ mercStatus: MercStatus.OK, dayBecomesAvailable: 0 })).toBe(true);
    expect(isMercHireable({ mercStatus: MercStatus.ANNOYED_BUT_CAN_STILL_CONTACT, dayBecomesAvailable: 0 })).toBe(true);
    expect(isMercHireable({ mercStatus: MercStatus.ANNOYED_WONT_CONTACT, dayBecomesAvailable: 0 })).toBe(true);
    expect(isMercHireable({ mercStatus: MercStatus.OK, dayBecomesAvailable: 2 })).toBe(false);
    for (const status of [7, -1, -4, -5, -6, -7, -8]) expect(isMercHireable({ mercStatus: status, dayBecomesAvailable: 0 })).toBe(false);
  });
});
