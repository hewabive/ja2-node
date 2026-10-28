// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/SkillCheck.cc SkillCheck, CalcTrapDetectLevel; SkillCheck.h SkillChecks.

import { findObj } from '../../strategic/economy/kits.ts';
import {
  effectiveDexterity,
  effectiveExpLevel,
  effectiveExplosive,
  effectiveMechanical,
  effectiveStrength,
  effectiveWisdom,
  moraleModifier,
  skillCheckFatiguePenalty,
} from '../skills.ts';
import { numSkillTraits, SKILL_TRAIT_BONUS, SkillTrait, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { RandomStream } from './context.ts';

export const SkillCheckReason = {
  NONE: 0,
  LOCKPICKING: 1,
  ELECTRONIC_LOCKPICKING: 2,
  ATTACHING_DETONATOR: 3,
  ATTACHING_REMOTE_DETONATOR: 4,
  PLANTING_BOMB: 5,
  PLANTING_REMOTE_BOMB: 6,
  OPEN_WITH_CROWBAR: 7,
  SMASH_DOOR: 8,
  DISARM_TRAP: 9,
  UNJAM_GUN: 10,
  NOTICE_DART: 11,
  LIE_TO_QUEEN: 12,
  ATTACHING_SPECIAL_ITEM: 13,
  ATTACHING_SPECIAL_ELECTRONIC_ITEM: 14,
  DISARM_ELECTRONIC_TRAP: 15,
} as const;

export interface SkillCheckContext {
  readonly content: TacticalState['content'];
  readonly pre: RandomStream;
}

const R = SkillCheckReason;
const NO_SLOT = -1;
const UNREASONABLE_CHANCE = 30;
const CROWBAR_STRENGTH_BONUS = 20;
const BLEEDING_SHOCK_BLEEDING = 20;
const BLEEDING_SHOCK_SHOCK = 1;

const ZEROED_BELOW_REASONABLE: ReadonlySet<number> = new Set([
  R.LOCKPICKING,
  R.ELECTRONIC_LOCKPICKING,
  R.DISARM_TRAP,
  R.DISARM_ELECTRONIC_TRAP,
  R.OPEN_WITH_CROWBAR,
  R.SMASH_DOOR,
  R.ATTACHING_SPECIAL_ITEM,
  R.ATTACHING_SPECIAL_ELECTRONIC_ITEM,
]);

const hasElectronics = (s: Soldier) => numSkillTraits(s, SkillTrait.ELECTRONICS) > 0;

function lockpickingSkill(t: SkillCheckContext, s: Soldier, electronic: boolean): number {
  let skill = effectiveMechanical(s);
  if (skill === 0) return 0;
  skill = Math.trunc((skill * (effectiveWisdom(s) + 100)) / 200);
  skill = Math.trunc((skill * (effectiveDexterity(s) + 100)) / 200);
  skill += effectiveExpLevel(s) * 3;
  skill += (SKILL_TRAIT_BONUS[SkillTrait.LOCKPICKING] ?? 0) * numSkillTraits(s, SkillTrait.LOCKPICKING);
  if (electronic && !hasElectronics(s)) skill = Math.trunc(skill / 2);
  const kit = findObj(s.inv, t.content.items.byName.get('LOCKSMITHKIT')?.index ?? -1);
  if (kit === NO_SLOT) return 0;
  return Math.trunc((skill * (s.inv[kit]?.status[0] ?? 0)) / 100);
}

function plantingSkill(s: Soldier, remote: boolean): number {
  let skill = Math.trunc((effectiveExplosive(s) * 7 + effectiveWisdom(s) * 2 + effectiveExpLevel(s) * 10) / 10);
  if (remote && !hasElectronics(s)) skill = Math.trunc((skill * 3) / 4);
  const quarters = Math.trunc(skill / 25);
  return Math.trunc((skill + 100 * quarters) / (quarters + 1));
}

function disarmSkill(s: Soldier, electronic: boolean): number {
  const base = electronic ? Math.max(effectiveMechanical(s), effectiveExplosive(s)) : effectiveExplosive(s);
  let skill = base * 7;
  if (skill === 0) return 0;
  skill = Math.trunc((skill + effectiveDexterity(s) * 2 + effectiveExpLevel(s) * 10) / 10);
  skill -= Math.trunc((100 - effectiveWisdom(s)) / 5);
  if (electronic && !hasElectronics(s)) skill = Math.trunc((skill * 3) / 4);
  return skill;
}

function attachingDetonatorSkill(s: Soldier, remote: boolean): number {
  const explosive = effectiveExplosive(s);
  if (explosive === 0) return 0;
  const skill = Math.trunc((explosive * 3 + effectiveDexterity(s)) / 4);
  return remote && !hasElectronics(s) ? Math.trunc(skill / 2) : skill;
}

function attachingSpecialItemSkill(s: Soldier, electronic: boolean): number {
  let skill = effectiveMechanical(s);
  if (skill === 0) return 0;
  skill = Math.trunc((skill * (effectiveWisdom(s) + 100)) / 200);
  skill = Math.trunc((skill * (effectiveDexterity(s) + 100)) / 200);
  skill += effectiveExpLevel(s) * 3;
  return electronic && !hasElectronics(s) ? Math.trunc(skill / 2) : skill;
}

function baseSkill(t: SkillCheckContext, s: Soldier, reason: number): number {
  switch (reason) {
    case R.ATTACHING_DETONATOR:
    case R.ATTACHING_REMOTE_DETONATOR:
      return attachingDetonatorSkill(s, reason === R.ATTACHING_REMOTE_DETONATOR);
    case R.ATTACHING_SPECIAL_ITEM:
    case R.ATTACHING_SPECIAL_ELECTRONIC_ITEM:
      return attachingSpecialItemSkill(s, reason === R.ATTACHING_SPECIAL_ELECTRONIC_ITEM);
    case R.LOCKPICKING:
    case R.ELECTRONIC_LOCKPICKING:
      return lockpickingSkill(t, s, reason === R.ELECTRONIC_LOCKPICKING);
    case R.PLANTING_BOMB:
    case R.PLANTING_REMOTE_BOMB:
      return plantingSkill(s, reason === R.PLANTING_REMOTE_BOMB);
    case R.DISARM_TRAP:
    case R.DISARM_ELECTRONIC_TRAP:
      return disarmSkill(s, reason === R.DISARM_ELECTRONIC_TRAP);
    case R.OPEN_WITH_CROWBAR:
      return effectiveStrength(s) + CROWBAR_STRENGTH_BONUS;
    case R.SMASH_DOOR:
      return effectiveStrength(s);
    case R.UNJAM_GUN:
      return 30 + Math.trunc(effectiveMechanical(s) / 2);
    case R.NOTICE_DART:
      return Math.trunc(effectiveWisdom(s) / 10) + effectiveExpLevel(s);
    default:
      return 0;
  }
}

export function skillCheck(t: SkillCheckContext, s: Soldier, reason: number, mod: number): number {
  let skill = baseSkill(t, s, reason);
  skill -= skillCheckFatiguePenalty(s, skill);
  let chance = skill + mod;
  if (ZEROED_BELOW_REASONABLE.has(reason) && chance < UNREASONABLE_CHANCE) chance = 0;
  else chance += moraleModifier(s);
  if (chance > 99) chance = 99;
  else if (chance < 0) chance = 0;
  const roll = t.pre.int(100);
  const madeItBy = chance - roll;
  if (madeItBy < 0) {
    if (s.lastSkillCheck === reason && s.gridNo === s.skillCheckGridNo) s.skillCheckAttempts++;
    else {
      s.lastSkillCheck = reason;
      s.skillCheckAttempts = 1;
      s.skillCheckGridNo = s.gridNo;
    }
  }
  return madeItBy;
}

export function calcTrapDetectLevel(t: TacticalState, s: Soldier, examining: boolean): number {
  let level = effectiveExpLevel(s);
  level += Math.trunc(effectiveExplosive(s) / 40);
  level -= Math.trunc((100 - effectiveWisdom(s)) / 20);
  if (examining) level += t.pre.int(Math.trunc(level / 3) + 2);
  if (s.bleeding > BLEEDING_SHOCK_BLEEDING || s.shock > BLEEDING_SHOCK_SHOCK) level -= t.pre.int(3);
  return Math.max(level, 1);
}
