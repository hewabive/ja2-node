// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.h DialogQuoteIDs (the tactical merc quotes); Dialogue_Control.cc
// @src SayQuoteFromAnyBodyInSector (ChooseRedIfPresentAndAirRaid has no caller with QUOTE_AIR_RAID); Soldier_Macros.h
// @src OkControllableMerc; Soldier_Control.h SOLDIER_QUOTE_SAID_*, SOLDIER_QUOTE_SAID_BUDDY_*_WITNESSED; Soldier_Ani.cc
// @src SayBuddyWitnessedQuoteFromKill and SkillCheck.cc SkillCheck (the buddy quote of each buddy slot).

import { isGassed } from '../explosions/smoke.ts';
import { BuddySlot, profileProgress, whichBuddy } from '../profiles.ts';
import { NO_PROFILE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { onSquad } from './assignment.ts';
import { Profile } from './constants.ts';
import type { QuoteSaidRecord } from './port.ts';
import { isRobot } from './robot.ts';

export const MercQuote = {
  SEE_ENEMY: 0,
  SEE_ENEMY_VARIATION: 1,
  IN_TROUBLE_SLASH_IN_BATTLE: 2,
  SEE_CREATURE: 3,
  FIRSTTIME_GAME_SEE_CREATURE: 4,
  ATTACKED_BY_MULTIPLE_CREATURES: 10,
  KILLED_AN_ENEMY: 27,
  KILLED_A_CREATURE: 28,
  AIM_KILLED_MIKE: 32,
  HEADSHOT: 33,
  BUDDY_1_GOOD: 51,
  BUDDY_2_GOOD: 52,
  LEARNED_TO_LIKE_WITNESSED: 53,
  DEFINITE_CANT_DO: 57,
  ENEMY_PRESENCE: 59,
  WARNING_OUTSTANDING_ENEMY_AFTER_RT: 60,
  SATISFACTION_WITH_GUN_AFTER_KILL: 62,
  SECTOR_SAFE: 65,
  KILLED_FACTORY_MANAGER: 67,
  SPOTTED_BLOODCAT: 68,
  ENEMY_RETREATED: 70,
} as const;

export const QuoteSaidFlag = {
  IN_SHIT: 0x0001,
  LOW_MORAL: 0x0010,
  MULTIPLE_CREATURES: 0x0020,
  ANNOYING_MERC: 0x0040,
  LIKESGUN: 0x0080,
  PERSONALITY: 0x4000,
  FOUND_SOMETHING_NICE: 0x8000,
} as const;

export const QuoteSaidExtFlag = {
  BUDDY_1_WITNESSED: 0x0040,
  BUDDY_2_WITNESSED: 0x0080,
  BUDDY_3_WITNESSED: 0x0100,
} as const;

const BUDDY_WITNESSED_FLAGS = QuoteSaidExtFlag.BUDDY_1_WITNESSED | QuoteSaidExtFlag.BUDDY_2_WITNESSED | QuoteSaidExtFlag.BUDDY_3_WITNESSED;

export interface BuddyComment {
  readonly quote: number;
  readonly witnessed: number;
}

const BUDDY_COMMENTS: Readonly<Record<number, BuddyComment>> = {
  [BuddySlot.SLOT1]: { quote: MercQuote.BUDDY_1_GOOD, witnessed: QuoteSaidExtFlag.BUDDY_1_WITNESSED },
  [BuddySlot.SLOT2]: { quote: MercQuote.BUDDY_2_GOOD, witnessed: QuoteSaidExtFlag.BUDDY_2_WITNESSED },
  [BuddySlot.LEARNED_TO_LIKE]: { quote: MercQuote.LEARNED_TO_LIKE_WITNESSED, witnessed: QuoteSaidExtFlag.BUDDY_3_WITNESSED },
};

const SKIPPED_WITHOUT_ARMY_FOUGHT: ReadonlyMap<number, ReadonlySet<number>> = new Map<number, ReadonlySet<number>>([
  [MercQuote.SECTOR_SAFE, new Set([Profile.IRA, Profile.MIGUEL, Profile.SHANK])],
  [MercQuote.ENEMY_PRESENCE, new Set([Profile.DIMITRI, Profile.DYNAMO, Profile.IRA, Profile.SHANK])],
]);

const NO_QUOTE_SAID: QuoteSaidRecord = { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };

export function quoteSaid(t: Pick<TacticalState, 'narrative'>, s: Soldier): QuoteSaidRecord {
  return t.narrative.quoteSaidFlags(s) ?? { ...NO_QUOTE_SAID };
}

export function markQuoteSaid(t: Pick<TacticalState, 'narrative'>, s: Soldier, flag: number): void {
  const said = t.narrative.quoteSaidFlags(s);
  if (said) said.quoteSaidFlags |= flag;
}

export function markExtQuoteSaid(t: Pick<TacticalState, 'narrative'>, s: Soldier, flag: number): void {
  const said = t.narrative.quoteSaidFlags(s);
  if (said) said.quoteSaidExtFlags |= flag;
}

export function clearBuddyWitnessedQuotes(t: Pick<TacticalState, 'narrative'>, s: Soldier): void {
  const said = t.narrative.quoteSaidFlags(s);
  if (said) said.quoteSaidExtFlags &= ~BUDDY_WITNESSED_FLAGS;
}

export function buddyCommentOn(t: Pick<TacticalState, 'profiles' | 'content'>, s: Soldier, buddy: Soldier): BuddyComment | null {
  const p = s.profile === NO_PROFILE ? null : profileProgress(t, s.profile);
  return p ? (BUDDY_COMMENTS[whichBuddy(p, buddy.profile)] ?? null) : null;
}

export function okControllableMerc(t: Pick<TacticalState, 'narrative'>, s: Soldier): boolean {
  return s.life >= OKLIFE && s.placed && s.team === Team.OUR && onSquad(t, s);
}

export function awakeSpeaker(t: TacticalState, s: Soldier): boolean {
  return okControllableMerc(t, s) && !t.narrative.isEpc(s) && !isGassed(t, s) && !isRobot(s) && !t.narrative.mercAsleep(s);
}

function skippedWithoutArmyFought(t: TacticalState, s: Soldier, quote: number): boolean {
  if ((t.turn.numFoughtInBattle[Team.ENEMY] ?? 0) !== 0) return false;
  return SKIPPED_WITHOUT_ARMY_FOUGHT.get(quote)?.has(s.profile) ?? false;
}

export function sayQuoteFromAnyBodyInSector(t: TacticalState, quote: number): void {
  const speakers = teamMembers(t, Team.OUR).filter((s) => awakeSpeaker(t, s) && !skippedWithoutArmyFought(t, s, quote));
  if (speakers.length === 0) return;
  const chosen = speakers[t.rng.int(speakers.length)];
  if (chosen) t.narrative.sayQuote(chosen, quote);
}
