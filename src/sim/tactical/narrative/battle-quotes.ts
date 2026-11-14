// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc CheckForEndOfCombatMode and CheckForEndOfBattle (the merc quotes),
// @src WeSawSomeoneThisTurn, NumEnemyInSectorNotDeadOrDying, NumBloodcatsInSectorNotDeadOrDying;
// @src SayBattleSoundFromAnyBodyInSector's candidates for the COOL1 after bloodcats, whose Random(n) the client draws
// @src (deviation "Battle sound after bloodcats", 2026-11-14);
// @src WeSawSomeoneThisTurn's FOR_EACH_MERC, the helicopter's passengers included (2026-11-08).

import { Opp } from '../perception/opp.ts';
import { Body, OKLIFE, Side, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { mercsInSector, type TacticalState, teamMembers } from '../state.ts';
import { awakeSpeaker, MercQuote, sayQuoteFromAnyBodyInSector } from './merc-quotes.ts';

const MAX_NUM_SOLDIERS = 148;
const FIRST_ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];

export function weSawSomeoneThisTurn(t: TacticalState): boolean {
  return mercsInSector(t).some(
    (s) => s.team === Team.OUR && s.oppList.subarray(FIRST_ENEMY_ID, MAX_NUM_SOLDIERS).includes(Opp.SEEN_THIS_TURN),
  );
}

function hostileNotDeadOrDying(s: Soldier | undefined): boolean {
  return s?.placed === true && !s.dead && s.life >= OKLIFE && !s.neutral && s.side !== Side.FRIENDLY;
}

function numEnemyInSectorNotDeadOrDying(t: TacticalState): number {
  return t.soldiers.filter((s) => hostileNotDeadOrDying(s)).length;
}

function numBloodcatsInSectorNotDeadOrDying(t: TacticalState): number {
  return t.soldiers.filter((s) => hostileNotDeadOrDying(s) && s?.bodyType === Body.BLOODCAT).length;
}

export function sayLullQuote(t: TacticalState, quoteDue: boolean): void {
  if (quoteDue && t.sectorHooks.inCreatureLair(t)) {
    sayQuoteFromAnyBodyInSector(t, MercQuote.WORRIED_ABOUT_CREATURE_PRESENCE);
    return;
  }
  if (numBloodcatsInSectorNotDeadOrDying(t) > 0) return;
  if (quoteDue && numEnemyInSectorNotDeadOrDying(t) > 0) sayQuoteFromAnyBodyInSector(t, MercQuote.WARNING_OUTSTANDING_ENEMY_AFTER_RT);
}

function battleSoundSpeakers(t: TacticalState): number[] {
  return teamMembers(t, Team.OUR)
    .filter((s) => awakeSpeaker(t, s))
    .map((s) => s.id);
}

export function sayBattleEndQuote(t: TacticalState, anEnemyRetreated: boolean): readonly number[] {
  if (anEnemyRetreated) sayQuoteFromAnyBodyInSector(t, MercQuote.ENEMY_RETREATED);
  else if (t.turn.lastMercKill?.bodyType !== Body.BLOODCAT) sayQuoteFromAnyBodyInSector(t, MercQuote.SECTOR_SAFE);
  else return battleSoundSpeakers(t);
  return [];
}
