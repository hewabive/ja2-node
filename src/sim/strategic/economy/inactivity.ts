// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Status.cc HandleEnricoEmail, LackOfProgressTolerance, UpdateLastDayOfPlayerActivity.
// See docs/18 §2.8.

import { idiv, u8, u16 } from '../../../core/int.ts';
import { worldDay } from '../time/world-clock.ts';
import { EnricoFlag } from './constants.ts';
import { decrementTownLoyaltyEverywhere } from './loyalty.ts';
import { hasAnyMineBeenAttackedByMonsters } from './mines.ts';
import type { EconomyContext } from './ports.ts';

const HARD_DIFFICULTY = 3;
const MEDIUM_DIFFICULTY = 2;
const HARD_BASE_TOLERANCE = 7;
const BASE_TOLERANCE = 6;
const PROGRESS_PER_TOLERANCE_DAY = 42;
const SOME_PROGRESS_THRESHOLD = 20;
const ABOUT_HALFWAY_THRESHOLD = 55;
const NEARLY_DONE_THRESHOLD = 80;
const MINOR_SETBACK_THRESHOLD = 5;
const MAJOR_SETBACK_THRESHOLD = 15;
const NEW_SECTORS_EQUAL_TO_ACTIVITY = 4;
const NEW_SECTORS_CARRY_DIVISOR = 3;
const SECOND_TOLERANCE = 2;
const THIRD_TOLERANCE = 3;

export type EnricoMail =
  | 'creatures'
  | 'progress20'
  | 'progress55'
  | 'progress80'
  | 'majorSetback'
  | 'minorSetback'
  | 'lackOfProgress1'
  | 'lackOfProgress2'
  | 'lackOfProgress3';

export interface EnricoOutcome {
  readonly mail: EnricoMail | null;
  readonly penalty: number;
}

export function lackOfProgressTolerance(difficulty: number, highestProgress: number): number {
  const extra = idiv(highestProgress, PROGRESS_PER_TOLERANCE_DAY);
  return u8(difficulty >= HARD_DIFFICULTY ? HARD_BASE_TOLERANCE - MEDIUM_DIFFICULTY + extra : BASE_TOLERANCE - difficulty + extra);
}

function complaintFor(days: number, tolerance: number, flags: number): EnricoMail | null {
  const sent = (flag: number) => (flags & flag) !== 0;
  if (days === tolerance) {
    if (!sent(EnricoFlag.LACK_PROGRESS1)) return 'lackOfProgress1';
    if (!sent(EnricoFlag.LACK_PROGRESS2)) return 'lackOfProgress2';
    if (!sent(EnricoFlag.LACK_PROGRESS3)) return 'lackOfProgress3';
  } else if (days === tolerance * SECOND_TOLERANCE) {
    if (!sent(EnricoFlag.LACK_PROGRESS2)) return 'lackOfProgress2';
    if (!sent(EnricoFlag.LACK_PROGRESS3)) return 'lackOfProgress3';
  } else if (days === tolerance * THIRD_TOLERANCE) {
    if (!sent(EnricoFlag.LACK_PROGRESS3)) return 'lackOfProgress3';
  }
  return null;
}

const COMPLAINT_FLAG: Readonly<Record<string, number>> = {
  lackOfProgress1: EnricoFlag.LACK_PROGRESS1,
  lackOfProgress2: EnricoFlag.LACK_PROGRESS2,
  lackOfProgress3: EnricoFlag.LACK_PROGRESS3,
};

function progressMail(current: number, flags: number): { mail: EnricoMail; flag: number } | null {
  if (current >= SOME_PROGRESS_THRESHOLD && !(flags & EnricoFlag.SOME_PROGRESS))
    return { mail: 'progress20', flag: EnricoFlag.SOME_PROGRESS };
  if (current >= ABOUT_HALFWAY_THRESHOLD && !(flags & EnricoFlag.ABOUT_HALFWAY))
    return { mail: 'progress55', flag: EnricoFlag.ABOUT_HALFWAY };
  if (current >= NEARLY_DONE_THRESHOLD && !(flags & EnricoFlag.NEARLY_DONE)) return { mail: 'progress80', flag: EnricoFlag.NEARLY_DONE };
  return null;
}

export function handleEnricoEmail(ctx: EconomyContext): EnricoOutcome {
  const status = ctx.state.status;
  const activity = ctx.state.map.activity;
  const current = ctx.ai.progressPercentage();
  const highest = status.highestProgress;
  const setback = highest - current;
  if (hasAnyMineBeenAttackedByMonsters(ctx) && !(status.enricoEmailFlags & EnricoFlag.CREATURES)) {
    status.enricoEmailFlags = u16(status.enricoEmailFlags | EnricoFlag.CREATURES);
    return { mail: 'creatures', penalty: 0 };
  }
  const progress = progressMail(current, status.enricoEmailFlags);
  if (progress) {
    status.enricoEmailFlags = u16(status.enricoEmailFlags | progress.flag);
    return { mail: progress.mail, penalty: 0 };
  }
  let mail: EnricoMail | null = null;
  let penalty = 0;
  const flags = status.enricoEmailFlags;
  if (
    (setback >= MAJOR_SETBACK_THRESHOLD || (setback >= MINOR_SETBACK_THRESHOLD && flags & EnricoFlag.SETBACK_OVER)) &&
    !(flags & EnricoFlag.MAJOR_SETBACK)
  ) {
    mail = 'majorSetback';
    status.enricoEmailFlags = u16(flags | EnricoFlag.MAJOR_SETBACK);
  } else if (setback >= MINOR_SETBACK_THRESHOLD && !(flags & (EnricoFlag.MINOR_SETBACK | EnricoFlag.MAJOR_SETBACK))) {
    mail = 'minorSetback';
    status.enricoEmailFlags = u16(flags | EnricoFlag.MINOR_SETBACK);
  } else if (highest === current && flags & EnricoFlag.MINOR_SETBACK) {
    status.enricoEmailFlags = u16(flags | EnricoFlag.SETBACK_OVER);
  } else if (worldDay(ctx.state.clock) > activity.lastDayOfPlayerActivity) {
    activity.daysOfInactivity = u8(activity.daysOfInactivity + 1);
    const tolerance = lackOfProgressTolerance(ctx.state.options.difficulty, highest);
    if (activity.daysOfInactivity >= tolerance) {
      const complaint = complaintFor(activity.daysOfInactivity, tolerance, status.enricoEmailFlags);
      if (complaint) {
        mail = complaint;
        status.enricoEmailFlags = u16(status.enricoEmailFlags | (COMPLAINT_FLAG[complaint] ?? 0));
      }
      const graceDay = status.enricoEmailFlags & EnricoFlag.LACK_PROGRESS2 ? 1 : 0;
      penalty = (ctx.economy.loyalty.amounts.PENALTY_INACTIVE ?? 0) * (activity.daysOfInactivity - tolerance + graceDay);
      decrementTownLoyaltyEverywhere(ctx, penalty);
    }
  }
  activity.newSectorsVisitedToday = idiv(
    Math.min(activity.newSectorsVisitedToday, NEW_SECTORS_EQUAL_TO_ACTIVITY),
    NEW_SECTORS_CARRY_DIVISOR,
  );
  return { mail, penalty };
}
