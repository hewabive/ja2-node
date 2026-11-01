// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleCreatureTenseQuote, DoCreatureTensionQuote; Tactical/Soldier_Add.cc
// @src InternalAddSoldierToSector (the creature quote flags cleared on entry); Strategic/StrategicMap.cc
// @src SetCurrentWorldSector (the first delay).

import { u32 } from '../../../core/int.ts';
import type { Rng } from '../../../core/rng.ts';
import { Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import { type Soldier, Team } from '../soldier.ts';
import { type RealtimeClock, type TacticalState, teamMembers } from '../state.ts';
import { awakeSpeaker, clearQuoteSaid, MercQuote, markQuoteSaid, QuoteSaidFlag, quoteSaid } from './merc-quotes.ts';

const MS_PER_SECOND = 1000;
const FIRST_DELAY_SECONDS = 10;
const FIRST_DELAY_RANGE = 20;
const NEXT_DELAY_SECONDS = 60;
const NEXT_DELAY_RANGE = 60;

const TENSION_QUOTES = [
  { quote: MercQuote.SMELLED_CREATURE, flag: QuoteSaidFlag.SMELLED_CREATURE },
  { quote: MercQuote.TRACES_OF_CREATURE_ATTACK, flag: QuoteSaidFlag.SPOTTING_CREATURE_ATTACK },
  { quote: MercQuote.WORRIED_ABOUT_CREATURE_PRESENCE, flag: QuoteSaidFlag.WORRIED_ABOUT_CREATURES },
] as const;

const TENSION_QUOTE_FLAGS = TENSION_QUOTES.reduce((flags, q) => flags | q.flag, 0);

export function drawFirstCreatureTenseQuoteDelay(clock: RealtimeClock, rng: Rng): void {
  clock.creatureTenseQuoteDelaySeconds = FIRST_DELAY_SECONDS + rng.int(FIRST_DELAY_RANGE);
}

export function clearCreatureTensionQuotesSaid(t: Pick<TacticalState, 'narrative'>, s: Soldier): void {
  clearQuoteSaid(t, s, TENSION_QUOTE_FLAGS);
}

function tenseQuoteDue(t: TacticalState): boolean {
  if (t.narrative.questStatus(Quest.CREATURES) === QuestStatus.DONE) return false;
  if (!t.sectorHooks.inCreatureLair(t) || t.inCombat) return false;
  const clock = t.realtimeClock;
  return u32(t.clockMs - clock.lastCreatureTenseQuoteMs) > u32(clock.creatureTenseQuoteDelaySeconds * MS_PER_SECOND);
}

function doCreatureTensionQuote(t: TacticalState, s: Soldier): void {
  const tension = TENSION_QUOTES[t.rng.int(TENSION_QUOTES.length)];
  if (!tension || quoteSaid(t, s).quoteSaidFlags & tension.flag) return;
  markQuoteSaid(t, s, tension.flag);
  t.narrative.sayQuote(s, tension.quote);
}

export function handleCreatureTenseQuote(t: TacticalState): void {
  if (!tenseQuoteDue(t)) return;
  const clock = t.realtimeClock;
  clock.lastCreatureTenseQuoteMs = u32(t.clockMs);
  const candidates = teamMembers(t, Team.OUR).filter((s) => awakeSpeaker(t, s));
  const chosen = candidates.length > 0 ? candidates[t.rng.int(candidates.length)] : undefined;
  if (chosen) doCreatureTensionQuote(t, chosen);
  clock.creatureTenseQuoteDelaySeconds = NEXT_DELAY_SECONDS + t.rng.int(NEXT_DELAY_RANGE);
}
