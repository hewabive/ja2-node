import { describe, expect, it } from 'vitest';
import { noCampaignFields } from '../../tactical/profiles.ts';
import { calcNewSalary, MAX_DAILY_SALARY, MAX_LARGE_SALARY, raiseSalaries, roundOffSalary } from './salary.ts';

describe('salary increases', () => {
  it('rounds to the multiple of its band, half up', () => {
    expect(roundOffSalary(248)).toBe(250);
    expect(roundOffSalary(253)).toBe(250);
    expect(roundOffSalary(255)).toBe(260);
    expect(roundOffSalary(312)).toBe(310);
    expect(roundOffSalary(1012)).toBe(1000);
    expect(roundOffSalary(1013)).toBe(1000);
    expect(roundOffSalary(1025)).toBe(1050);
    expect(roundOffSalary(31250)).toBe(32000);
  });

  it('raises by a quarter, rounds, caps and keeps a free merc free', () => {
    expect(calcNewSalary(0, MAX_DAILY_SALARY)).toBe(0);
    expect(calcNewSalary(1, MAX_DAILY_SALARY)).toBe(5);
    expect(calcNewSalary(250, MAX_DAILY_SALARY)).toBe(310);
    expect(calcNewSalary(251, MAX_DAILY_SALARY)).toBe(310);
    expect(calcNewSalary(1999, MAX_DAILY_SALARY)).toBe(2500);
    expect(calcNewSalary(25000, MAX_DAILY_SALARY)).toBe(30000);
    expect(calcNewSalary(29000, MAX_DAILY_SALARY)).toBe(30000);
    expect(calcNewSalary(29000, MAX_LARGE_SALARY)).toBe(36000);
    expect(calcNewSalary(499999, MAX_LARGE_SALARY)).toBe(MAX_LARGE_SALARY);
  });

  it('raises all salaries and the deposit once per level', () => {
    const p = { ...noCampaignFields(), salary: 300, weeklySalary: 1900, biWeeklySalary: 3500, medicalDepositAmount: 600 };
    raiseSalaries(p as never, 2);
    expect([p.salary, p.weeklySalary, p.biWeeklySalary, p.medicalDepositAmount]).toEqual([480, 3000, 5500, 925]);
  });
});
