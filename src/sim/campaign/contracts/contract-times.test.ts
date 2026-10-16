import { describe, expect, it } from 'vitest';
import {
  clockReading,
  contractEndAtArrival,
  contractEndAtHire,
  contractIsExpiring,
  contractIsGoingToExpireSoon,
  hourWhenContractDone,
  mercArrivalTimeOfDay,
  personnelTimeLeft,
  remainingContractMinutes,
  teamListContract,
} from './contract-times.ts';

const at = (day: number, hour: number, minute = 0) => day * 1440 + hour * 60 + minute;

describe('arrival slots', () => {
  it.each([
    [0, at(5, 7, 30)],
    [1, at(5, 7, 30)],
    [2, at(5, 13, 30)],
    [7, at(5, 13, 30)],
    [8, at(5, 19, 30)],
    [13, at(5, 19, 30)],
    [14, at(6, 7, 30)],
    [23, at(6, 7, 30)],
  ])('hiring at %i:15 lands at the next slot with six hours of flight preparation', (hour, slot) => {
    expect(mercArrivalTimeOfDay(at(5, hour, 15))).toBe(slot);
  });

  it('takes the contract hour from the arrival slot, not from the end time', () => {
    expect(hourWhenContractDone(at(1, 7, 30))).toBe(7);
    expect(hourWhenContractDone(at(3, 13, 30))).toBe(13);
    expect(hourWhenContractDone(at(9, 19, 30))).toBe(19);
  });
});

describe('contract end', () => {
  it('ends the opening squad at 07:00 of day 1 + length, counted from the hire', () => {
    const hired = at(1, 1);
    expect(contractEndAtHire(hired, 7, at(1, 7, 30), true)).toBe(at(8, 7));
    expect(contractEndAtArrival(at(1, 7), 7, at(1, 7, 30))).toBe(at(8, 7));
  });

  it('adds the flight day at hire and recomputes the end at arrival', () => {
    const hired = at(5, 10);
    const slot = mercArrivalTimeOfDay(hired);
    expect(slot).toBe(at(5, 19, 30));
    expect(contractEndAtHire(hired, 1, slot, false)).toBe(at(7, 19));
    expect(contractEndAtArrival(at(5, 19, 30), 1, slot)).toBe(at(6, 19));
  });

  it('makes a 02:00 hire on a 13:30 flight end 30 minutes short of seven days', () => {
    const slot = mercArrivalTimeOfDay(at(4, 2));
    expect(slot).toBe(at(4, 13, 30));
    expect(contractEndAtArrival(slot, 7, slot)).toBe(at(11, 13));
  });
});

describe('expiry tests', () => {
  const contract = { contractEnd: at(8, 7), timeWillArrive: at(1, 7, 30) };

  it('warns from two hours before the contract hour on the last day', () => {
    expect(contractIsGoingToExpireSoon(contract, clockReading(at(8, 4, 59)))).toBe(false);
    expect(contractIsGoingToExpireSoon(contract, clockReading(at(8, 5, 30)))).toBe(true);
    expect(contractIsGoingToExpireSoon(contract, clockReading(at(7, 23)))).toBe(false);
  });

  it('expires only during the contract hour of the last or a later day', () => {
    expect(contractIsExpiring(contract, clockReading(at(8, 7, 30)))).toBe(true);
    expect(contractIsExpiring(contract, clockReading(at(8, 8)))).toBe(false);
    expect(contractIsExpiring(contract, clockReading(at(9, 7, 30)))).toBe(true);
    expect(contractIsGoingToExpireSoon(contract, clockReading(at(10, 6)))).toBe(true);
  });

  it('never warns for contract hours 0 and 1 because the hour subtraction is unsigned', () => {
    for (const hour of [0, 1]) {
      const c = { contractEnd: at(3, hour), timeWillArrive: at(1, hour) };
      expect(contractIsGoingToExpireSoon(c, clockReading(at(3, 23)))).toBe(false);
      expect(contractIsExpiring(c, clockReading(at(3, hour, 30)))).toBe(true);
    }
  });
});

describe('contract displays', () => {
  it('clamps an in-transit merc to the bought days', () => {
    expect(remainingContractMinutes(at(9, 7), 7, true, at(1, 2))).toBe(7 * 1440);
    expect(remainingContractMinutes(at(9, 7), 7, false, at(1, 2))).toBe(at(9, 7) - at(1, 2));
  });

  it('shows days from three days on, else rounded-up hours that flash from four hours down', () => {
    expect(teamListContract(3 * 1440)).toEqual({ days: 3 });
    expect(teamListContract(3 * 1440 - 1)).toEqual({ hours: 72, flashing: false });
    expect(teamListContract(241)).toEqual({ hours: 5, flashing: false });
    expect(teamListContract(240)).toEqual({ hours: 4, flashing: true });
    expect(teamListContract(5)).toEqual({ hours: 0, flashing: true });
    expect(teamListContract(6)).toEqual({ hours: 1, flashing: true });
  });

  it('gives the personnel screen whole days and hours, never negative', () => {
    expect(personnelTimeLeft(2 * 1440 + 3 * 60 + 59)).toEqual({ days: 2, hours: 3 });
    expect(personnelTimeLeft(-30)).toEqual({ days: 0, hours: 0 });
  });
});
