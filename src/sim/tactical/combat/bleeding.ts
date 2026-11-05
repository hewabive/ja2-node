// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CheckBleeding (with its blood amount, the dying quote and the bleeding
// @src warning; the patient being bandaged or doctored, 2026-11-01), SoldierBleed, CalcSoldierNextBleed; Overhead.cc
// @src HandleBloodForNewGridNo (2026-11-04).

import { idiv } from '../../../core/int.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { profileProgress } from '../profiles.ts';
import { effectiveLife } from '../skills.ts';
import { BLOOD_DIVISOR, dropBlood, MAX_BLOOD_QUANTITY } from '../smell.ts';
import { Body, NO_PROFILE, OKLIFE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { soldierTakeDamage } from './hit.ts';
import { CONSCIOUSNESS, DamageReason } from './types.ts';

export const MIN_BLEEDING_THRESHOLD = 12;
const RT_NEXT_BLEED_MODIFIER = 0.5;
const BLOOD_LOSS_LIFE = 1;
const BLOOD_LOSS_BREATH = 100;

const isVehicleOrRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON || s.bodyType >= Body.HUMVEE;

export function calcSoldierNextBleed(s: Soldier): number {
  return Math.fround(1 + Math.fround(effectiveLife(s)) / (10 + s.tilesMoved));
}

export function bleedsAtTurnStart(s: Soldier): boolean {
  return !isVehicleOrRobot(s) && (s.bleeding !== 0 || s.life < OKLIFE);
}

function loseLifeMaxWhileDying(t: TacticalState, s: Soldier): void {
  if (s.lifeMax < OKLIFE) return;
  s.lifeMax--;
  s.bleeding--;
  if (s.profile === NO_PROFILE) return;
  const progress = profileProgress(t, s.profile);
  if (!progress) return;
  progress.stats.lifeMax--;
  progress.life--;
}

export const NO_BLOOD = 40;

function bloodOfWound(s: Soldier): number {
  return Math.min(idiv(s.bleeding - MIN_BLEEDING_THRESHOLD, BLOOD_DIVISOR), MAX_BLOOD_QUANTITY);
}

function bleedingBlood(s: Soldier): number {
  if (s.tilesMoved >= 1) return NO_BLOOD;
  return bloodOfWound(s);
}

const TRAIL_BLOOD_SPREAD = 7;

export function handleBloodForNewGridNo(t: TacticalState, s: Soldier): void {
  if (s.bleeding <= MIN_BLEEDING_THRESHOLD) return;
  const blood = bloodOfWound(s) - t.rng.int(TRAIL_BLOOD_SPREAD);
  if (blood >= 0) dropBlood(t, s, blood);
}

function underCare(t: TacticalState, s: Soldier): boolean {
  return s.serviceCount !== 0 || t.narrative.anyDoctorWhoCanHeal(s);
}

export function checkBleeding(t: TacticalState, s: Soldier): number {
  if (s.life === 0) return NO_BLOOD;
  if (s.bleeding <= MIN_BLEEDING_THRESHOLD && s.life >= OKLIFE) return NO_BLOOD;
  if (underCare(t, s)) return NO_BLOOD;
  const blood = bleedingBlood(s);
  s.nextBleed = t.inCombat ? Math.fround(s.nextBleed - 1) : Math.fround(s.nextBleed - RT_NEXT_BLEED_MODIFIER);
  if (s.nextBleed > 0) return blood;
  const bandaged = s.lifeMax - s.bleeding - s.life;
  if (bandaged !== 0 && s.life >= OKLIFE) s.bleeding++;
  else if (s.life < OKLIFE) {
    sayDyingQuote(t, s);
    loseLifeMaxWhileDying(t, s);
  }
  soldierTakeDamage(t, s, BLOOD_LOSS_LIFE, BLOOD_LOSS_BREATH, DamageReason.BLOODLOSS, null);
  if (warnsOfBleeding(t, s)) {
    t.narrative.sayQuote(s, MercQuote.STARTING_TO_BLEED);
    s.warnedAboutBleeding = true;
  }
  s.nextBleed = calcSoldierNextBleed(s);
  return blood;
}

function sayDyingQuote(t: TacticalState, s: Soldier): void {
  if (s.life < CONSCIOUSNESS || s.dyingComment) return;
  t.narrative.sayQuote(s, MercQuote.SERIOUSLY_WOUNDED);
  s.dyingComment = true;
}

function warnsOfBleeding(t: TacticalState, s: Soldier): boolean {
  return s.life >= OKLIFE && !s.dyingComment && !s.warnedAboutBleeding && !t.pathEnv.autoBandage;
}
