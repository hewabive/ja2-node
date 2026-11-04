// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc LookForAndMayCommentOnSeeingCorpse (with BeginMultiPurposeLocator at the look's
// @src tile and level, 2026-11-03), GetCorpseAtGridNo (the level it ignores).

import { grossedOutByCorpses } from '../../../content/narrative/quote-speakers.ts';
import { i8 } from '../../../core/int.ts';
import type { Corpse } from '../combat/death.ts';
import { corpseAt, ROTTING_STAGE2 } from '../rotting-corpses.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { MercQuote } from './merc-quotes.ts';

const TOLERANCE_WITHOUT_CROWS = 0;
const TOLERANCE_WITH_CROWS = 1;
const TOLERANCE_RESET_CHOICES = 3;
const TOLERANCE_RESET_BASE = 1;
const SQUAD_HARDENING_ODDS = 2;
const SQUAD_HARDENS = 1;

function toleranceThreshold(corpse: Corpse): number {
  return corpse.servicingCrows > 0 ? TOLERANCE_WITH_CROWS : TOLERANCE_WITHOUT_CROWS;
}

function hardensAgainstCorpses(s: Soldier): boolean {
  return s.life >= OKLIFE && s.gridNo !== NOWHERE;
}

function hardenSquad(t: TacticalState): void {
  for (const s of teamMembers(t, Team.OUR)) {
    if (!hardensAgainstCorpses(s)) continue;
    const record = t.narrative.corpseQuoteRecord(s);
    if (record) record.corpseQuoteTolerance = i8(record.corpseQuoteTolerance + 1);
  }
}

export function lookForAndMayCommentOnSeeingCorpse(t: TacticalState, s: Soldier, gridNo: number, level: number): void {
  if (!grossedOutByCorpses(t.content.quoteSpeakers, s.profile)) return;
  const corpse = corpseAt(t, gridNo);
  if (!corpse || corpse.type !== ROTTING_STAGE2) return;
  const record = t.narrative.corpseQuoteRecord(s);
  if (!record || record.corpseQuoteTolerance > toleranceThreshold(corpse)) return;
  t.narrative.sayQuote(s, MercQuote.HEADSHOT);
  t.events.push({ type: 'corpseLocated', gridNo, level });
  record.corpseQuoteTolerance = t.rng.int(TOLERANCE_RESET_CHOICES) + TOLERANCE_RESET_BASE;
  if (t.rng.int(SQUAD_HARDENING_ODDS) === SQUAD_HARDENS) hardenSquad(t);
}
