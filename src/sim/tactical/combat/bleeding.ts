// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CheckBleeding (with its blood amount), SoldierBleed, CalcSoldierNextBleed.

import { idiv } from '../../../core/int.ts';
import { profileProgress } from '../profiles.ts';
import { effectiveLife } from '../skills.ts';
import { BLOOD_DIVISOR, MAX_BLOOD_QUANTITY } from '../smell.ts';
import { Body, NO_PROFILE, OKLIFE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { soldierTakeDamage } from './hit.ts';
import { DamageReason } from './types.ts';

const MIN_BLEEDING_THRESHOLD = 12;
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

function bleedingBlood(s: Soldier): number {
  if (s.tilesMoved >= 1) return NO_BLOOD;
  return Math.min(idiv(s.bleeding - MIN_BLEEDING_THRESHOLD, BLOOD_DIVISOR), MAX_BLOOD_QUANTITY);
}

export function checkBleeding(t: TacticalState, s: Soldier): number {
  if (s.life === 0) return NO_BLOOD;
  if (s.bleeding <= MIN_BLEEDING_THRESHOLD && s.life >= OKLIFE) return NO_BLOOD;
  const blood = bleedingBlood(s);
  s.nextBleed = t.inCombat ? Math.fround(s.nextBleed - 1) : Math.fround(s.nextBleed - RT_NEXT_BLEED_MODIFIER);
  if (s.nextBleed > 0) return blood;
  const bandaged = s.lifeMax - s.bleeding - s.life;
  if (bandaged !== 0 && s.life >= OKLIFE) s.bleeding++;
  else if (s.life < OKLIFE) loseLifeMaxWhileDying(t, s);
  soldierTakeDamage(t, s, BLOOD_LOSS_LIFE, BLOOD_LOSS_BREATH, DamageReason.BLOODLOSS, null);
  s.nextBleed = calcSoldierNextBleed(s);
  return blood;
}
