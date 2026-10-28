// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Hiring.cc GetMercArrivalTimeOfDay, HireMerc (contract end), MercArrivesCallback;
// @src Merc_Hiring.h MERC_ARRIVE_TIME_SLOT_*, MIN_FLIGHT_PREP_TIME; Strategic/Merc_Contract.cc GetHourWhenContractDone,
// @src ContractIsExpiring, ContractIsGoingToExpireSoon; Strategic/MapScreen.cc (contract column and info panel);
// @src Laptop/Personnel.cc (contract time left).

import { i32, u32 } from '../../../core/int.ts';
import { NUM_MIN_IN_DAY, NUM_MIN_IN_HOUR } from '../../strategic/time/constants.ts';

export const MERC_ARRIVE_TIME_SLOTS = [7 * 60 + 30, 13 * 60 + 30, 19 * 60 + 30] as const;
export const MIN_FLIGHT_PREP_TIME = 6;
const LAST_FLIGHT_HOUR = 13;
const FIRST_SLOT_LATEST_HOUR = 7;
const SECOND_SLOT_LATEST_HOUR = 13;
const WARNING_HOURS = 2;
const LONG_CONTRACT_DAYS = 3;
const SHORT_REMAINDER_MINUTES = 5;
const FLASH_REMAINDER_MINUTES = 240;

export interface ClockReading {
  readonly totalMinutes: number;
  readonly day: number;
  readonly hour: number;
}

export function clockReading(totalMinutes: number): ClockReading {
  const day = Math.trunc(totalMinutes / NUM_MIN_IN_DAY);
  return { totalMinutes, day, hour: Math.trunc((totalMinutes - day * NUM_MIN_IN_DAY) / NUM_MIN_IN_HOUR) };
}

export function midnightOfFutureDay(now: number, days: number): number {
  return now + days * NUM_MIN_IN_DAY - (now % NUM_MIN_IN_DAY);
}

export function mercArrivalTimeOfDay(now: number): number {
  const { day, hour } = clockReading(now);
  const today = day * NUM_MIN_IN_DAY;
  if (hour > LAST_FLIGHT_HOUR) return midnightOfFutureDay(now, 1) + MERC_ARRIVE_TIME_SLOTS[0];
  const earliest = hour + MIN_FLIGHT_PREP_TIME;
  if (earliest <= FIRST_SLOT_LATEST_HOUR) return today + MERC_ARRIVE_TIME_SLOTS[0];
  if (earliest <= SECOND_SLOT_LATEST_HOUR) return today + MERC_ARRIVE_TIME_SLOTS[1];
  return today + MERC_ARRIVE_TIME_SLOTS[2];
}

export function hourWhenContractDone(timeWillArrive: number): number {
  const t = u32(timeWillArrive);
  return Math.trunc((t - Math.trunc(t / NUM_MIN_IN_DAY) * NUM_MIN_IN_DAY) / NUM_MIN_IN_HOUR);
}

export function contractEndAtHire(now: number, length: number, timeWillArrive: number, gameJustStarted: boolean): number {
  const days = gameJustStarted ? length : 1 + length;
  return i32(midnightOfFutureDay(now, days) + hourWhenContractDone(timeWillArrive) * NUM_MIN_IN_HOUR);
}

export function contractEndAtArrival(now: number, length: number, timeWillArrive: number): number {
  return i32(midnightOfFutureDay(now, length) + hourWhenContractDone(timeWillArrive) * NUM_MIN_IN_HOUR);
}

export interface ContractTimes {
  readonly contractEnd: number;
  readonly timeWillArrive: number;
}

function endsOnOrBefore(c: ContractTimes, now: ClockReading): boolean {
  return Math.trunc(c.contractEnd / NUM_MIN_IN_DAY) <= now.day;
}

export function contractIsExpiring(c: ContractTimes, now: ClockReading): boolean {
  return endsOnOrBefore(c, now) && now.hour === hourWhenContractDone(c.timeWillArrive);
}

export function contractIsGoingToExpireSoon(c: ContractTimes, now: ClockReading): boolean {
  return endsOnOrBefore(c, now) && now.hour >= u32(hourWhenContractDone(c.timeWillArrive) - WARNING_HOURS);
}

export function remainingContractMinutes(contractEnd: number, totalContractLength: number, inTransit: boolean, now: number): number {
  const left = contractEnd - now;
  return inTransit ? Math.min(left, totalContractLength * NUM_MIN_IN_DAY) : left;
}

export type TeamListContract = { readonly days: number } | { readonly hours: number; readonly flashing: boolean };

export function teamListContract(remaining: number): TeamListContract {
  if (remaining >= LONG_CONTRACT_DAYS * NUM_MIN_IN_DAY) return { days: Math.trunc(remaining / NUM_MIN_IN_DAY) };
  const hours = remaining > SHORT_REMAINDER_MINUTES ? Math.trunc((remaining + NUM_MIN_IN_HOUR - 1) / NUM_MIN_IN_HOUR) : 0;
  return { hours, flashing: remaining <= FLASH_REMAINDER_MINUTES };
}

export function personnelTimeLeft(remaining: number): { readonly days: number; readonly hours: number } {
  const left = Math.max(0, remaining);
  return { days: Math.trunc(left / NUM_MIN_IN_DAY), hours: Math.trunc((left % NUM_MIN_IN_DAY) / NUM_MIN_IN_HOUR) };
}
