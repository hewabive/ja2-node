// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc AreInMeanwhile, GetMeanwhileID; the meanwhile tests of Tactical/Weapons.cc UseGun,
// @src UseHandToHand; Soldier_Control.cc EVENT_SoldierGotHit (interrogation punches), SoldierTakeDamage (SOLDIER_NPC_SHOOTING,
// @src bleeding), BeginSoldierGetup; Soldier_Add.cc InternalAddSoldierToSector (Elliot's life); Soldier_Ani.cc
// @src CheckForAndHandleSoldierIncompacitated; Overhead.cc InternalReduceAttackBusyCount; TeamTurns.cc
// @src DisplayHiddenTurnbased.

import { Approach } from '../../../content/narrative/npc-constants.ts';
import { OKLIFE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { Profile } from './constants.ts';

const INTERROGATION = 11;
const ELLIOT = 135;
const ELLIOT_MEANWHILE_LIFE = 25;

export function inMeanwhile(t: TacticalState): boolean {
  return t.narrative.inMeanwhile();
}

export function inInterrogation(t: TacticalState): boolean {
  return inMeanwhile(t) && t.narrative.meanwhileId() === INTERROGATION;
}

export function meanwhileKeepsAttacker(t: TacticalState, attacker: Soldier | null): boolean {
  return inMeanwhile(t) && attacker !== null && attacker.profile !== Profile.QUEEN;
}

export function slapCheckWhenIncapacitated(t: TacticalState): void {
  if (!inMeanwhile(t)) return;
  const queen = t.soldiers.find((s) => s?.placed && s.profile === Profile.QUEEN);
  if (queen) t.narrative.triggerNpcWithGivenApproach(Profile.QUEEN, Approach.DONE_SLAPPED);
}

export function keepElliotAliveInMeanwhile(t: TacticalState, s: Soldier): void {
  if (inMeanwhile(t) && s.profile === ELLIOT && s.life < OKLIFE) s.life = ELLIOT_MEANWHILE_LIFE;
}
