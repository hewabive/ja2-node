// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc EVENT_BeginMercTurn (the personality switch); TacticalAI/AIUtils.cc
// @src DistanceToClosestFriend (a soldier in the sector); Tactical/Soldier_Profile_Type.h NERVOUS_RADIUS.

import { spacesAway } from '../../../content/world/grid.ts';
import { handleMoraleEvent, MoraleEvent } from '../combat/morale.ts';
import { clearQuoteSaid, MercQuote, markQuoteSaid, QuoteSaidFlag, quoteSaid } from '../narrative/merc-quotes.ts';
import { mercSeesCreature } from '../perception/opp.ts';
import { NO_PROFILE, OKLIFE, Personality, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';

const CLAUSTROPHOBIA_DIE_BASE = 6;
const NERVOUS_RADIUS = 10;
const NERVOUS_ALONE_BELOW_MORALE = 50;
const NERVOUS_QUOTE_RESET_ABOVE_MORALE = 45;
const NO_FRIEND_DISTANCE = 1000;

function distanceToClosestFriend(t: TacticalState, s: Soldier): number {
  let closest = NO_FRIEND_DISTANCE;
  for (const friend of teamMembers(t, s.team)) {
    if (friend === s || friend.life < OKLIFE) continue;
    closest = Math.min(closest, spacesAway(s.gridNo, friend.gridNo));
  }
  return closest;
}

function sayPersonalityQuote(t: TacticalState, s: Soldier): void {
  if (quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.PERSONALITY) return;
  t.narrative.sayQuote(s, MercQuote.PERSONALITY_TRAIT);
  markQuoteSaid(t, s, QuoteSaidFlag.PERSONALITY);
}

function phobiaStrikes(t: TacticalState, s: Soldier, event: number): void {
  handleMoraleEvent(t, s, event);
  sayPersonalityQuote(t, s);
}

function claustrophobiaStrikesUnderground(t: TacticalState): boolean {
  const z = t.sector?.z ?? 0;
  return z > 0 && t.rng.int(CLAUSTROPHOBIA_DIE_BASE - z) === 0;
}

function nervousAtTurnStart(t: TacticalState, s: Soldier): void {
  if (distanceToClosestFriend(t, s) <= NERVOUS_RADIUS) {
    if (s.morale > NERVOUS_QUOTE_RESET_ABOVE_MORALE) clearQuoteSaid(t, s, QuoteSaidFlag.PERSONALITY);
    return;
  }
  if (s.morale < NERVOUS_ALONE_BELOW_MORALE) phobiaStrikes(t, s, MoraleEvent.NERVOUS_ALONE);
}

export function handlePersonalityAtTurnStart(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.OUR || s.profile === NO_PROFILE) return;
  switch (s.personalityTrait) {
    case Personality.FEAR_OF_INSECTS:
      if (mercSeesCreature(t, s)) phobiaStrikes(t, s, MoraleEvent.INSECT_PHOBIC_SEES_CREATURE);
      return;
    case Personality.CLAUSTROPHOBIC:
      if (claustrophobiaStrikesUnderground(t)) phobiaStrikes(t, s, MoraleEvent.CLAUSTROPHOBE_UNDERGROUND);
      return;
    case Personality.NERVOUS:
      nervousAtTurnStart(t, s);
      return;
    default:
      return;
  }
}
