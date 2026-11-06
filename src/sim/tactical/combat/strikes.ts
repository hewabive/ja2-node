// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-06. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc HaultSoldierFromSighting (its list of attacks that do not involve an object)

import { scriptRanOpcode, scriptReachesOpcode } from '../animation.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { reduceAttackBusyCount } from './barrier.ts';

const STRIKES: readonly string[] = ['THROW_KNIFE', 'SLICE', 'STAB', 'CROUCH_STAB', 'PUNCH', 'PUNCH_LOW', 'CROWBAR_ATTACK'];
const FIRE_WEAPON = 430;
const TAKE_ATTACK_BUSY_COUNT = 757;
const RELEASE_ATTACK_BUSY_COUNT = 753;

function isStrike(t: TacticalState, state: number): boolean {
  return STRIKES.includes(t.content.animations.controls[state]?.id ?? '');
}

export function strikePending(t: TacticalState, s: Soldier): boolean {
  return isStrike(t, s.pendingAnimation);
}

function blowQueued(t: TacticalState, s: Soldier): boolean {
  return t.gameEvents.some((e) => e.kind === 'fireWeapon' && e.soldier === s.id);
}

function blowStillAhead(t: TacticalState, s: Soldier): boolean {
  return scriptReachesOpcode(t, s.state, s.pc, FIRE_WEAPON) && !blowQueued(t, s);
}

function animationHoldStillTaken(t: TacticalState, s: Soldier): boolean {
  return scriptRanOpcode(t, s.state, s.pc, TAKE_ATTACK_BUSY_COUNT) && scriptReachesOpcode(t, s.state, s.pc, RELEASE_ATTACK_BUSY_COUNT);
}

export function holdsTheStrikeWillRelease(t: TacticalState, s: Soldier): number {
  if (strikePending(t, s)) return 1;
  if (!isStrike(t, s.state)) return 0;
  return (blowStillAhead(t, s) ? 1 : 0) + (animationHoldStillTaken(t, s) ? 1 : 0);
}

export function giveBackWhatACutStrikeHeld(t: TacticalState, s: Soldier, holdsBeforeTheCut: number): void {
  for (let held = holdsBeforeTheCut - holdsTheStrikeWillRelease(t, s); held > 0; held--) reduceAttackBusyCount(t, s, false);
}

export function cutStrikeGivingBackItsHolds(t: TacticalState, s: Soldier, cut: () => void): void {
  const holds = holdsTheStrikeWillRelease(t, s);
  cut();
  giveBackWhatACutStrikeHeld(t, s, holds);
}
