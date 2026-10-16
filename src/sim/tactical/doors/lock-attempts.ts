// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Keys.cc AttemptToUnlockDoor, AttemptToLockDoor, AttemptToCrowbarLock, AttemptToSmashDoor,
// @src AttemptToPickLock, AttemptToBlowUpLock, DOOR::damageLock; Items.cc FindObj, FindUsableObj, DamageObj. See docs/25 §8.3.

import { LOCK_UNOPENABLE, LockType, lockAt, OPENING_NOT_POSSIBLE } from '../../../content/formats/locks.ts';
import { damageObject, removeObjects, USABLE_STATUS } from '../../items/object.ts';
import { StatCause, statChange } from '../combat/experience.ts';
import { SkillCheckReason, skillCheck } from '../combat/skill-check.ts';
import { igniteExplosionXY } from '../explosions/explosion.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import { StatKind } from '../profiles.ts';
import { effectiveStrength } from '../skills.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { findDoorInfo, removeDoorInfo, updateDoor } from './door-table.ts';
import { soldierHasKey } from './keys.ts';

export const NO_SLOT = -1;
const SMASHING_DOOR_VOLUME = 6;
const CROWBAR_DOOR_VOLUME = 4;
const IMPOSSIBLE_CHECK_MODIFIER = -100;
const CROWBAR_STRESS_MARGIN = 30;
const CROWBAR_STRESS_DIVISOR = 20;
const PRIED_OPEN_STRENGTH_GAIN = 20;
const DAMAGED_LOCK_STRENGTH_GAIN = 5;
const TOKEN_STRENGTH_GAIN = 1;
const CLOSE_CALL = -10;
const TOKEN_EFFORT = -40;
const LOCK_DAMAGE_PER_CLOSE_CALL = 10;
const MAX_LOCK_DAMAGE = 127;
const PLANTING_SUCCESS = -20;
const SHAPED_CHARGE_LOCK_DAMAGE_FACTOR = 2;
const PICK_MECHANICAL_DIVISOR = 5;
const PICK_DEXTERITY_DIVISOR = 10;

const i8 = (v: number) => (v << 24) >> 24;

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -1;
}

export function findObj(s: Soldier, item: number): number {
  return s.inv.findIndex((o) => o.item === item);
}

export function findUsableObj(s: Soldier, item: number): number {
  return s.inv.findIndex((o) => o.item === item && (o.status[0] ?? 0) >= USABLE_STATUS);
}

export function findCrowbar(t: TacticalState, s: Soldier): number {
  return findUsableObj(s, itemIndex(t, 'CROWBAR'));
}

export function findLocksmithKit(t: TacticalState, s: Soldier): number {
  return findObj(s, itemIndex(t, 'LOCKSMITHKIT'));
}

export function findShapedCharge(t: TacticalState, s: Soldier): number {
  return findObj(s, itemIndex(t, 'SHAPED_CHARGE'));
}

export function attemptToUnlockDoor(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door || !soldierHasKey(t, s, door.lockId)) return false;
  if (door.locked) updateDoor(t, gridNo, { locked: false });
  return true;
}

export function attemptToLockDoor(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door || !soldierHasKey(t, s, door.lockId)) return false;
  if (!door.locked) updateDoor(t, gridNo, { locked: true });
  return true;
}

export function damageLock(t: TacticalState, s: Soldier, gridNo: number, amount: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door) return false;
  const lockDamage = Math.min(MAX_LOCK_DAMAGE, door.lockDamage + amount);
  if (lockDamage > lockAt(t.content.locks, door.lockId).smashDifficulty) {
    removeDoorInfo(t, gridNo);
    t.events.push({ type: 'lockDestroyed', soldier: s.id, gridNo });
    return true;
  }
  updateDoor(t, gridNo, { lockDamage });
  return false;
}

function bashModifier(smashDifficulty: number, lockDamage: number): number {
  return i8(-i8(smashDifficulty - lockDamage));
}

function bashLock(t: TacticalState, s: Soldier, gridNo: number, reason: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door) return false;
  const smash = lockAt(t.content.locks, door.lockId).smashDifficulty;
  let result: number;
  if (smash === OPENING_NOT_POSSIBLE) {
    skillCheck(t, s, reason, IMPOSSIBLE_CHECK_MODIFIER);
    result = IMPOSSIBLE_CHECK_MODIFIER;
  } else result = skillCheck(t, s, reason, bashModifier(smash, door.lockDamage));
  if (result > 0) {
    statChange(t, s, StatKind.STRENGTH, PRIED_OPEN_STRENGTH_GAIN, StatCause.SUCCESS);
    removeDoorInfo(t, gridNo);
    return true;
  }
  if (result > CLOSE_CALL) {
    statChange(t, s, StatKind.STRENGTH, DAMAGED_LOCK_STRENGTH_GAIN, StatCause.SUCCESS);
    updateDoor(t, gridNo, { lockDamage: i8(door.lockDamage + i8(LOCK_DAMAGE_PER_CLOSE_CALL + result)) });
  } else if (result > TOKEN_EFFORT && s.gridNo !== s.skillCheckGridNo)
    statChange(t, s, StatKind.STRENGTH, TOKEN_STRENGTH_GAIN, StatCause.SUCCESS);
  return false;
}

export function attemptToCrowbarLock(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const slot = findCrowbar(t, s);
  if (slot === NO_SLOT) return false;
  makeNoise(t, s, s.gridNo, s.level, CROWBAR_DOOR_VOLUME, NoiseKind.DOOR_SMASHING);
  const door = findDoorInfo(t, gridNo);
  if (!door) return false;
  if (!door.locked) {
    removeDoorInfo(t, gridNo);
    return true;
  }
  if (door.lockId === LOCK_UNOPENABLE) return false;
  const stress = Math.min(effectiveStrength(s), lockAt(t.content.locks, door.lockId).smashDifficulty + CROWBAR_STRESS_MARGIN);
  const crowbar = s.inv[slot];
  const wear = t.pre.int(Math.trunc(stress / CROWBAR_STRESS_DIVISOR));
  if (crowbar) damageObject(crowbar, wear);
  return bashLock(t, s, gridNo, SkillCheckReason.OPEN_WITH_CROWBAR);
}

export function attemptToSmashDoor(t: TacticalState, s: Soldier, gridNo: number): boolean {
  makeNoise(t, s, s.gridNo, s.level, SMASHING_DOOR_VOLUME, NoiseKind.DOOR_SMASHING);
  const door = findDoorInfo(t, gridNo);
  if (!door) return false;
  if (!door.locked) {
    removeDoorInfo(t, gridNo);
    return true;
  }
  if (door.lockId === LOCK_UNOPENABLE) return false;
  return bashLock(t, s, gridNo, SkillCheckReason.SMASH_DOOR);
}

export function attemptToPickLock(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const door = findDoorInfo(t, gridNo);
  if (!door || door.lockId === LOCK_UNOPENABLE) return false;
  const lock = lockAt(t.content.locks, door.lockId);
  const electronic = lock.type === LockType.CARD || lock.type === LockType.ELECTRONIC;
  const reason = electronic ? SkillCheckReason.ELECTRONIC_LOCKPICKING : SkillCheckReason.LOCKPICKING;
  let result: number;
  if (lock.pickDifficulty === OPENING_NOT_POSSIBLE) {
    skillCheck(t, s, reason, IMPOSSIBLE_CHECK_MODIFIER);
    result = IMPOSSIBLE_CHECK_MODIFIER;
  } else result = skillCheck(t, s, reason, i8(-i8(lock.pickDifficulty)));
  if (result <= 0) return false;
  statChange(t, s, StatKind.MECHANICAL, Math.trunc(lock.pickDifficulty / PICK_MECHANICAL_DIVISOR), StatCause.SUCCESS);
  statChange(t, s, StatKind.DEXTERITY, Math.trunc(lock.pickDifficulty / PICK_DEXTERITY_DIVISOR), StatCause.SUCCESS);
  updateDoor(t, gridNo, { locked: false });
  return true;
}

function useUpShapedCharge(t: TacticalState, s: Soldier): void {
  const slot = findShapedCharge(t, s);
  const charge = slot === NO_SLOT ? null : s.inv[slot];
  if (charge) removeObjects(charge, 1);
}

export type BlowUpOutcome = 'destroyed' | 'damaged' | 'exploded' | 'noCharge';

export function attemptToBlowUpLock(t: TacticalState, s: Soldier, gridNo: number): BlowUpOutcome {
  const charge = itemIndex(t, 'SHAPED_CHARGE');
  if (findObj(s, charge) === NO_SLOT) return 'noCharge';
  const result = skillCheck(t, s, SkillCheckReason.PLANTING_BOMB, 0);
  if (result >= PLANTING_SUCCESS) {
    useUpShapedCharge(t, s);
    const blast = t.content.items.byIndex.get(charge)?.explosive?.blast?.damage ?? 0;
    return damageLock(t, s, gridNo, blast * SHAPED_CHARGE_LOCK_DAMAGE_FACTOR) ? 'destroyed' : 'damaged';
  }
  useUpShapedCharge(t, s);
  igniteExplosionXY(t, null, Math.trunc(s.x), Math.trunc(s.y), t.world.level.heights[s.gridNo] ?? 0, s.gridNo, charge, 0);
  return 'exploded';
}
