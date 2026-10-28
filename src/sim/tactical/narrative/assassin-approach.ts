// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleAtNewGridNo (a neutral assassin stepping within 8 tiles of a PC); TacticalAI/NPC.h
// @src NPC_TALK_RADIUS.

import { NO_PROFILE, NOWHERE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { addToShouldBecomeHostileOrSayQuoteList } from './civ-hostility.ts';
import { closestPc } from './closest-pc.ts';
import { ASSASSINS } from './constants.ts';

const NPC_TALK_RADIUS = 4;
const ASSASSIN_STRIKE_DISTANCE = NPC_TALK_RADIUS * 2;

export function assassinStepsCloseToPc(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.CIV || s.profile === NO_PROFILE || !s.neutral || !ASSASSINS.has(s.profile)) return;
  const pc = closestPc(t, s);
  if (pc.gridNo === NOWHERE || pc.distance > ASSASSIN_STRIKE_DISTANCE) return;
  t.turnHooks.cancelAIAction(t, s);
  addToShouldBecomeHostileOrSayQuoteList(t, s);
}
