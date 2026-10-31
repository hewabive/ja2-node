// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc CheckForEndOfCombatMode and CheckForEndOfBattle (the merc quotes),
// @src WeSawSomeoneThisTurn, NumEnemyInSectorNotDeadOrDying, NumBloodcatsInSectorNotDeadOrDying; the creature lair's
// @src QUOTE_WORRIED_ABOUT_CREATURE_PRESENCE is not ported (gaps "Creature quest scripting"), the COOL1 battle sound of
// @src SayBattleSoundFromAnyBodyInSector after bloodcats is not drawn (deviation "Battle sound after bloodcats").

import { Opp } from '../perception/opp.ts';
import { Body, OKLIFE, Side, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { MercQuote, sayQuoteFromAnyBodyInSector } from './merc-quotes.ts';

const MAX_NUM_SOLDIERS = 148;
const FIRST_ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];

export function weSawSomeoneThisTurn(t: TacticalState): boolean {
  return mercs(t).some((s) => s.team === Team.OUR && s.oppList.subarray(FIRST_ENEMY_ID, MAX_NUM_SOLDIERS).includes(Opp.SEEN_THIS_TURN));
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
  if (quoteDue && t.sectorHooks.inCreatureLair(t)) return;
  if (numBloodcatsInSectorNotDeadOrDying(t) > 0) return;
  if (quoteDue && numEnemyInSectorNotDeadOrDying(t) > 0) sayQuoteFromAnyBodyInSector(t, MercQuote.WARNING_OUTSTANDING_ENEMY_AFTER_RT);
}

export function sayBattleEndQuote(t: TacticalState, anEnemyRetreated: boolean): void {
  if (anEnemyRetreated) sayQuoteFromAnyBodyInSector(t, MercQuote.ENEMY_RETREATED);
  else if (t.turn.lastMercKill?.bodyType !== Body.BLOODCAT) sayQuoteFromAnyBodyInSector(t, MercQuote.SECTOR_SAFE);
}
