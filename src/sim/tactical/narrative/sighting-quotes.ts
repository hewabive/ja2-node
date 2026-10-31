// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.cc SaySeenQuote, RadioSightings (the first creature sighting's quote); Soldier_Macros.h
// @src OK_ENEMY_MERC; Soldier_Profile_Type.h PROFILE_MISC_FLAG_HAVESEENCREATURE.

import { idiv } from '../../../core/int.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { Opp, SeenCreature } from '../perception/opp.ts';
import { profileProgress } from '../profiles.ts';
import { isMonster, NO_PROFILE, OKLIFE, Side, type Soldier } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { inMeanwhile } from './meanwhile-rules.ts';
import { MercQuote, markQuoteSaid, QuoteSaidFlag, quoteSaid } from './merc-quotes.ts';

export type SightingBattleSound = 'ENEMY' | 'CURSE1';

const ENEMIES_MORE_THAN_ALLIES = 2;
const MULTIPLE_CREATURES_ABOVE = 2;
const PERCENT = 100;
const ENEMY_BATTLE_SOUND_CHANCE = 30;

function say(t: TacticalState, s: Soldier, quote: number): void {
  t.narrative.sayQuote(s, quote);
}

function okEnemyMerc(s: Soldier): boolean {
  return !s.neutral && s.side !== Side.FRIENDLY && s.life >= OKLIFE;
}

export function hasSeenCreatures(t: TacticalState, s: Soldier): boolean {
  const p = s.profile === NO_PROFILE ? null : profileProgress(t, s.profile);
  return ((p?.miscFlags ?? 0) & ProfileFlag.HAVESEENCREATURE) !== 0;
}

export function sayFirstCreatureSightingQuote(t: TacticalState, s: Soldier): void {
  const p = s.profile === NO_PROFILE ? null : profileProgress(t, s.profile);
  if (p) p.miscFlags |= ProfileFlag.HAVESEENCREATURE;
  say(t, s, MercQuote.FIRSTTIME_GAME_SEE_CREATURE);
}

function outnumbered(t: TacticalState, s: Soldier): boolean {
  const present = mercs(t);
  const enemies = present.filter(okEnemyMerc).length;
  const allies = present.filter((m) => !okEnemyMerc(m) && m.ai.oppCount >= idiv(enemies, 2)).length;
  return s.ai.oppCount - allies > ENEMIES_MORE_THAN_ALLIES;
}

function saidInTrouble(t: TacticalState, s: Soldier): boolean {
  if (quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.IN_SHIT || !outnumbered(t, s)) return false;
  say(t, s, MercQuote.IN_TROUBLE_SLASH_IN_BATTLE);
  markQuoteSaid(t, s, QuoteSaidFlag.IN_SHIT);
  return true;
}

function creaturesSeenCurrently(t: TacticalState, s: Soldier): number {
  return mercs(t).filter((m) => okEnemyMerc(m) && isMonster(m) && s.oppList[m.id] === Opp.SEEN_CURRENTLY).length;
}

function sayCreatureQuote(t: TacticalState, s: Soldier): void {
  if (!hasSeenCreatures(t, s)) {
    sayFirstCreatureSightingQuote(t, s);
    return;
  }
  if (quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.MULTIPLE_CREATURES || creaturesSeenCurrently(t, s) <= MULTIPLE_CREATURES_ABOVE) {
    say(t, s, MercQuote.SEE_CREATURE);
    return;
  }
  markQuoteSaid(t, s, QuoteSaidFlag.MULTIPLE_CREATURES);
  say(t, s, MercQuote.ATTACKED_BY_MULTIPLE_CREATURES);
}

function sayEnemyQuote(t: TacticalState, s: Soldier, virginSector: boolean): SightingBattleSound | null {
  if (virginSector) {
    say(t, s, MercQuote.SEE_ENEMY_VARIATION);
    return null;
  }
  if (t.content.sightingBattleSound && t.rng.int(PERCENT) < ENEMY_BATTLE_SOUND_CHANCE) return 'ENEMY';
  say(t, s, MercQuote.SEE_ENEMY);
  return null;
}

export function saySeenQuote(t: TacticalState, s: Soldier, virginSector: boolean): SightingBattleSound | null {
  if (inMeanwhile(t) || saidInTrouble(t, s)) return null;
  const seen = t.perception.playerTeamSawCreatures;
  if (seen === SeenCreature.CREATURE) sayCreatureQuote(t, s);
  else if (seen === SeenCreature.BLOODCAT) say(t, s, MercQuote.SPOTTED_BLOODCAT);
  else return sayEnemyQuote(t, s, virginSector);
  return null;
}

export function clearBattleSightingQuotes(t: Pick<TacticalState, 'narrative'>, s: Soldier): void {
  const said = t.narrative.quoteSaidFlags(s);
  if (said) said.quoteSaidFlags &= ~(QuoteSaidFlag.IN_SHIT | QuoteSaidFlag.MULTIPLE_CREATURES);
}
