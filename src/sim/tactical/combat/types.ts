// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.h AIM_SHOT_*, special hit effects, damage thresholds, aim modifiers;
// @src Soldier_Control.h TAKE_DAMAGE_* reasons; Morale.h MORALE_*; Weapons.cc WEAPON_STATUS_MOD. See docs/11 §1–§5.

export const AimShot = { RANDOM: 0, HEAD: 1, TORSO: 2, LEGS: 3, GLAND: 4 } as const;

export const Special = {
  NONE: 0,
  HEAD_EXPLODE: 1,
  CHEST_EXPLODE: 2,
  LEG_FALLDOWN: 3,
  BURST: 4,
  SLEEP_DART: 5,
  BLINDED_BY_SPIT: 6,
  KNIFE_THROWN: 7,
  TOSSED_OBJECT: 8,
} as const;

export const DamageReason = {
  GUNFIRE: 0,
  BLADE: 1,
  HANDTOHAND: 2,
  FALLROOF: 3,
  BLOODLOSS: 4,
  EXPLOSION: 5,
  ELECTRICITY: 6,
  GAS: 7,
  TENTACLES: 8,
  STRUCTURE_EXPLOSION: 9,
  OBJECT: 10,
} as const;

export const AiMorale = { HOPELESS: 0, WORRIED: 1, NORMAL: 2, CONFIDENT: 3, FEARLESS: 4 } as const;

export const WeaponMode = { NORMAL: 0, BURST: 1, ATTACHED: 2 } as const;

export const CTH_MINIMUM = 1;
export const CTH_MAXIMUM = 99;
export const CONSCIOUSNESS = 10;
export const MIN_DAMAGE_FOR_INSTANT_KILL = 55;
export const MIN_DAMAGE_FOR_HEAD_EXPLOSION = 45;
export const MIN_DAMAGE_FOR_BLOWN_AWAY = 30;
export const MIN_DAMAGE_FOR_AUTO_FALL_OVER = 20;
export const MAX_DISTANCE_FOR_MESSY_DEATH = 7;
export const CRITICAL_HIT_THRESHOLD = 30;
export const BP_GET_HIT = 200;
export const BP_GET_WOUNDED = 50;
export const PUNCH_REAL_DAMAGE_PORTION = 4;
export const NUM_BUCKSHOT_PELLETS = 9;
export const HEAD_DAMAGE_MULTIPLIER = 1.5;
export const LEGS_DAMAGE_MULTIPLIER = 0.5;

export const Aim = {
  BONUS_SAME_TARGET: 10,
  BONUS_PER_AP: 10,
  BONUS_PSYCHO: 15,
  BONUS_FIRING_DOWN: 15,
  PENALTY_SMG: 5,
  PENALTY_DUAL_PISTOLS: 20,
  PENALTY_GASSED: 50,
  PENALTY_GETTINGAID: 20,
  PENALTY_PER_SHOCK: 5,
  PENALTY_TARGET_CROUCHED: 20,
  PENALTY_TARGET_PRONE: 40,
  PENALTY_BLIND: 80,
  PENALTY_FIRING_UP: 25,
} as const;

export const POINT_BLANK_RANGE = 16;
export const MIN_PRONE_RANGE = 50;
export const NORMAL_RANGE = 90;

export function weaponStatusMod(status: number): number {
  return status >= 85 ? 100 : Math.trunc((status * 100) / 85);
}

export const i8 = (v: number): number => ((v & 0xff) << 24) >> 24;
export const u8 = (v: number): number => v & 0xff;
export const i16 = (v: number): number => ((v & 0xffff) << 16) >> 16;
