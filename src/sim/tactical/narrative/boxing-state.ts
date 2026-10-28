// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead_Types.h BoxingStates; Tactical/Boxing.h BOXING_RING, DisqualificationReasons;
// @src Tactical/Boxing.cc gsBoxerGridNo;
// @src TacticalAI/DecideAction.cc CENTER_OF_RING (the state tests of Overhead.cc, Soldier_Control.cc, TeamTurns.cc, AIMain.cc,
// @src AIList.cc, AIUtils.cc, OppList.cc, Soldier_Ani.cc).

import type { BoxingRecord } from '../../strategic/narrative/facts.ts';
import type { BoxingStateName, DisqualificationName } from './boxing-events.ts';

export const BoxingState = {
  NOT_BOXING: 0,
  WAITING_FOR_PLAYER: 1,
  PRE_BOXING: 2,
  BOXING: 3,
  DISQUALIFIED: 4,
  WON_ROUND: 5,
  LOST_ROUND: 6,
} as const;

export const BOXING_STATE_NAMES: readonly BoxingStateName[] = [
  'notBoxing',
  'waitingForPlayer',
  'preBoxing',
  'boxing',
  'disqualified',
  'wonRound',
  'lostRound',
];

export const Disqualification = { BOXER_OUT_OF_RING: 0, NON_BOXER_IN_RING: 1, BAD_ATTACK: 2 } as const;
export const DISQUALIFICATION_NAMES: readonly DisqualificationName[] = ['outOfRing', 'nonBoxerInRing', 'badAttack'];

export const BOXING_RING = 29;
export const BOXER_GRIDNOS: readonly number[] = [11393, 11233, 11073];
export const CENTER_OF_RING = 11237;

type WithBoxing = { readonly boxing: BoxingRecord };

export function boxingStateName(state: number): BoxingStateName {
  return BOXING_STATE_NAMES[state] ?? 'notBoxing';
}

export function boxingActive(t: WithBoxing): boolean {
  return t.boxing.state !== BoxingState.NOT_BOXING;
}

export function boxingFight(t: WithBoxing): boolean {
  return t.boxing.state === BoxingState.BOXING;
}

export function boxingHalvesPoints(t: { readonly boxing?: BoxingRecord }): boolean {
  const state = t.boxing?.state;
  return state === BoxingState.PRE_BOXING || state === BoxingState.BOXING;
}

export function boxingRoundDecided(t: WithBoxing): boolean {
  const state = t.boxing.state;
  return state === BoxingState.DISQUALIFIED || state === BoxingState.WON_ROUND || state === BoxingState.LOST_ROUND;
}

export function boxingTracksMovement(t: WithBoxing): boolean {
  const state = t.boxing.state;
  return state === BoxingState.WAITING_FOR_PLAYER || state === BoxingState.PRE_BOXING || state === BoxingState.BOXING;
}

export function boxingIdlesNonBoxers(t: WithBoxing): boolean {
  const state = t.boxing.state;
  return (
    state === BoxingState.PRE_BOXING || state === BoxingState.BOXING || state === BoxingState.WON_ROUND || state === BoxingState.LOST_ROUND
  );
}
