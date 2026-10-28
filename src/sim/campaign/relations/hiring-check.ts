// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc CanMercBeHired.

import type { StrategicStatus } from '../../strategic/ai/queen-state.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { QuoteName } from '../contracts/quotes.ts';
import { BuddySlot, getFirstBuddyOnTeam, HatedSlot, isMercOnTeamAndArrivedAndAlive, NO_RELATION, type TeamRelations } from './relations.ts';
import { mercThinksBadReputationTooHigh, mercThinksDeathRateTooHigh } from './reputation.ts';

const TOLERATED_HATED_HOURS = 24;

export type HireRefusal = 'hangover' | 'hatesTeammate' | 'deathRate' | 'reputation';

export interface HireCheck {
  readonly accepted: boolean;
  readonly quote: QuoteName | null;
  readonly refusal?: HireRefusal;
  readonly hated?: number;
}

const JOINING_QUOTES: Readonly<Record<number, QuoteName>> = {
  [BuddySlot.SLOT1]: 'JOINING_CAUSE_BUDDY_1_ON_TEAM',
  [BuddySlot.SLOT2]: 'JOINING_CAUSE_BUDDY_2_ON_TEAM',
  [BuddySlot.LEARNED_TO_LIKE]: 'JOINING_CAUSE_LEARNED_TO_LIKE_BUDDY_ON_TEAM',
};

const BIAS_QUOTES: Readonly<Record<number, QuoteName>> = {
  [HatedSlot.SLOT1]: 'PERSONALITY_BIAS_WITH_MERC_1',
  [HatedSlot.SLOT2]: 'PERSONALITY_BIAS_WITH_MERC_2',
};

const HATE_QUOTES: Readonly<Record<number, QuoteName>> = {
  [HatedSlot.SLOT1]: 'HATE_MERC_1_ON_TEAM',
  [HatedSlot.SLOT2]: 'HATE_MERC_2_ON_TEAM',
  [HatedSlot.LEARNED_TO_HATE]: 'LEARNED_TO_HATE_MERC_ON_TEAM',
};

export function canMercBeHired(r: TeamRelations, status: StrategicStatus, p: ProfileProgress): HireCheck {
  if (p.daysOfMoraleHangover > 0) return { accepted: false, quote: 'LAME_REFUSAL', refusal: 'hangover' };
  const buddy = getFirstBuddyOnTeam(r, p);
  let joinQuote: QuoteName | null = null;
  for (let slot = HatedSlot.SLOT1; slot < HatedSlot.COUNT; slot++) {
    const hated = p.hated[slot] ?? NO_RELATION;
    if (hated < 0 || !isMercOnTeamAndArrivedAndAlive(r.team, hated)) continue;
    if (buddy !== BuddySlot.NOT_FOUND) return { accepted: true, quote: JOINING_QUOTES[buddy] ?? null };
    const bias = BIAS_QUOTES[slot];
    if (bias && (p.hatedTime[slot] ?? 0) >= TOLERATED_HATED_HOURS) {
      joinQuote = bias;
      continue;
    }
    return { accepted: false, quote: HATE_QUOTES[slot] ?? null, refusal: 'hatesTeammate', hated };
  }
  if (buddy !== BuddySlot.NOT_FOUND) return { accepted: true, quote: null };
  if (mercThinksDeathRateTooHigh(status, p)) return { accepted: false, quote: 'DEATH_RATE_REFUSAL', refusal: 'deathRate' };
  if (mercThinksBadReputationTooHigh(status, p)) return { accepted: false, quote: 'REPUTATION_REFUSAL', refusal: 'reputation' };
  return { accepted: true, quote: joinQuote };
}
