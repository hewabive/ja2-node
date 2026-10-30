// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.cc InitSoldierOppList, ResetLastKnownLocs.

import { NOWHERE, type Soldier, TOTAL_SOLDIERS } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { Opp } from './opp.ts';

export type OppListTables = Pick<TacticalState, 'mercSlots' | 'perception' | 'turn'>;

export function resetLastKnownLocs(t: Pick<TacticalState, 'mercSlots' | 'perception'>, s: Soldier): void {
  const publicLastKnown = t.perception.publicLastKnown[s.team];
  for (const other of mercs(t)) {
    s.lastKnownOpp[other.id] = NOWHERE;
    if (publicLastKnown) publicLastKnown[other.id] = NOWHERE;
  }
}

export function initSoldierOppList(t: OppListTables, s: Soldier): void {
  s.oppList.fill(Opp.NOT_HEARD_OR_SEEN);
  s.ai.oppCount = 0;
  resetLastKnownLocs(t, s);
  t.turn.seenOpponents.fill(0, s.id * TOTAL_SOLDIERS, (s.id + 1) * TOTAL_SOLDIERS);
}
