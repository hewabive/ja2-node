// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc HandleKilledQuote (gLastMercTalkedAboutKilling), ShouldMercSayHappyWithGunQuote,
// @src MIN_DEADLINESS_FOR_LIKE_GUN_QUOTE, SayBuddyWitnessedQuoteFromKill; the laugh-or-cool CoinToss is not drawn
// @src (deviation "Cosmetic draws in attacks").

import { ItemClass } from '../../../content/items/items.ts';
import { gunQuoteOf } from '../../../content/narrative/quote-speakers.ts';
import { u8 } from '../../../core/int.ts';
import { animName } from '../anim-states.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { isGassed } from '../explosions/smoke.ts';
import { distanceVisible } from '../perception/sight.ts';
import { Body, CivilianGroup, isMonster, NOWHERE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import type { EnemyKilledOnAttack } from '../turns/turn-state.ts';
import { Profile } from './constants.ts';
import {
  awakeSpeaker,
  type BuddyComment,
  buddyCommentOn,
  MercQuote,
  markExtQuoteSaid,
  markQuoteSaid,
  okControllableMerc,
  QuoteSaidFlag,
  quoteSaid,
} from './merc-quotes.ts';

const DIRECTION_IRRELEVANT = -1;
const LOS_CUBE_LEVEL = 3;
const PERCENT = 100;
const KILLER_SAYS_HEADSHOT_CHANCE = 40;
const KILLER_SAYS_KILL_BESIDE_WITNESS_CHANCE = 50;
const LIKES_GUN_CHANCE = 20;
const MIN_DEADLINESS_FOR_LIKE_GUN_QUOTE = 20;
const KILL_QUOTE_CHANCE = 33;
const BUDDY_WITNESS_CHANCE = 20;
const HEADSHOT_DEATH = 'JFK_HITDEATH';

interface BuddyWitness {
  readonly soldier: Soldier;
  readonly comment: BuddyComment;
}

function say(t: TacticalState, s: Soldier, quote: number): void {
  t.narrative.sayQuote(s, quote);
}

function seesLocation(t: TacticalState, s: Soldier, gridNo: number, level: number): boolean {
  const visible = distanceVisible(t, s, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, gridNo, level);
  return soldierTo3DLocationLos(t, s, gridNo, level, LOS_CUBE_LEVEL, u8(visible), true) !== 0;
}

function plainCivilian(s: Soldier): boolean {
  return s.team === Team.CIV && s.civilianGroup === CivilianGroup.NONE;
}

function shouldSayHappyWithGunQuote(t: TacticalState, killer: Soldier): boolean {
  if (gunQuoteOf(t.content.quoteSpeakers, killer.profile) !== MercQuote.SATISFACTION_WITH_GUN_AFTER_KILL) return false;
  if (quoteSaid(t, killer).quoteSaidFlags & QuoteSaidFlag.LIKESGUN) return false;
  const weapon = t.content.items.byIndex.get(killer.attackingWeapon);
  if (weapon?.itemClass !== ItemClass.GUN) return false;
  if ((weapon.weapon?.deadliness ?? 0) <= MIN_DEADLINESS_FOR_LIKE_GUN_QUOTE) return false;
  return t.rng.int(PERCENT) < LIKES_GUN_CHANCE;
}

function killerComments(t: TacticalState, victim: Soldier, killer: Soldier): void {
  if (shouldSayHappyWithGunQuote(t, killer)) {
    say(t, killer, MercQuote.SATISFACTION_WITH_GUN_AFTER_KILL);
    markQuoteSaid(t, killer, QuoteSaidFlag.LIKESGUN);
  } else if (t.rng.int(PERCENT) < KILL_QUOTE_CHANCE && victim.bodyType !== Body.BLOODCAT)
    say(t, killer, isMonster(victim) ? MercQuote.KILLED_A_CREATURE : MercQuote.KILLED_AN_ENEMY);
}

function headshotWitness(t: TacticalState, s: Soldier, k: EnemyKilledOnAttack): boolean {
  if (s === k.killer || !okControllableMerc(t, s) || isGassed(t, s) || t.narrative.isEpc(s)) return false;
  return seesLocation(t, s, k.gridNo, k.level);
}

function headshotComments(t: TacticalState, k: EnemyKilledOnAttack, killerSees: boolean): void {
  const { victim, killer } = k;
  if (t.rng.int(PERCENT) < KILLER_SAYS_HEADSHOT_CHANCE) {
    say(t, killer, MercQuote.HEADSHOT);
    return;
  }
  const witnesses = teamMembers(t, Team.OUR).filter((s) => headshotWitness(t, s, k));
  const chosen = witnesses.length > 0 ? witnesses[t.rng.int(witnesses.length)] : undefined;
  if (chosen) {
    if (t.rng.int(PERCENT) < KILLER_SAYS_KILL_BESIDE_WITNESS_CHANCE && !plainCivilian(victim)) say(t, killer, MercQuote.KILLED_AN_ENEMY);
    say(t, chosen, MercQuote.HEADSHOT);
  } else if (killerSees && !plainCivilian(victim)) say(t, killer, MercQuote.KILLED_AN_ENEMY);
}

function buddyWitness(t: TacticalState, s: Soldier, k: EnemyKilledOnAttack): BuddyWitness | null {
  if (!awakeSpeaker(t, s) || s.gridNo === NOWHERE) return null;
  const comment = buddyCommentOn(t, s, k.killer);
  if (!comment || quoteSaid(t, s).quoteSaidExtFlags & comment.witnessed) return null;
  if (!seesLocation(t, s, k.killer.gridNo, k.killer.level) || !seesLocation(t, s, k.gridNo, k.level)) return null;
  return { soldier: s, comment };
}

function sayBuddyWitnessedQuoteFromKill(t: TacticalState, k: EnemyKilledOnAttack): void {
  const witnesses = teamMembers(t, Team.OUR)
    .map((s) => buddyWitness(t, s, k))
    .filter((w): w is BuddyWitness => w !== null);
  if (witnesses.length === 0 || t.rng.int(PERCENT) >= BUDDY_WITNESS_CHANCE) return;
  const chosen = witnesses[t.rng.int(witnesses.length)];
  if (!chosen) return;
  markExtQuoteSaid(t, chosen.soldier, chosen.comment.witnessed);
  say(t, chosen.soldier, chosen.comment.quote);
}

export function handleKilledQuote(t: TacticalState, k: EnemyKilledOnAttack): void {
  const { victim, killer } = k;
  t.turn.lastMercKill = victim;
  const killerSees = seesLocation(t, killer, k.gridNo, k.level);
  if (victim.profile === Profile.MIKE && t.narrative.isAimMerc(killer)) {
    if (killerSees) say(t, killer, MercQuote.AIM_KILLED_MIKE);
  } else if (victim.profile === Profile.DOREEN) say(t, killer, MercQuote.KILLED_FACTORY_MANAGER);
  else if (animName(t.content, victim.state) === HEADSHOT_DEATH) headshotComments(t, k, killerSees);
  else if (killerSees && !plainCivilian(victim)) {
    killerComments(t, victim, killer);
    sayBuddyWitnessedQuoteFromKill(t, k);
  }
}
