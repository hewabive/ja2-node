// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/SkillCheck.cc SkillCheck (with QUOTE_DEFINITE_CANT_DO and the buddies' comment on a success,
// @src 2026-10-30), CalcTrapDetectLevel; SkillCheck.h SkillChecks.

import { spacesAway } from '../../../content/world/grid.ts';
import { idiv } from '../../../core/int.ts';
import { findObj } from '../../strategic/economy/kits.ts';
import { buddyCommentOn, MercQuote, okControllableMerc } from '../narrative/merc-quotes.ts';
import {
  effectiveDexterity,
  effectiveExpLevel,
  effectiveExplosive,
  effectiveLeadership,
  effectiveMechanical,
  effectiveStrength,
  effectiveWisdom,
  moraleModifier,
  skillCheckFatiguePenalty,
} from '../skills.ts';
import { numSkillTraits, SKILL_TRAIT_BONUS, SkillTrait, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
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

export type SkillCheckContext = Pick<TacticalState, 'content' | 'profiles'> &
  Partial<Pick<TacticalState, 'soldiers' | 'narrative'>> & {
    readonly pre: RandomStream;
  };

const R = SkillCheckReason;
const NO_SLOT = -1;
const UNREASONABLE_CHANCE = 30;
const CROWBAR_STRENGTH_BONUS = 20;
const BLEEDING_SHOCK_BLEEDING = 20;
const BLEEDING_SHOCK_SHOCK = 1;
const LIE_TO_QUEEN_SKILL_FACTOR = 50;
const ATTEMPTS_BEFORE_GIVING_UP = 2;
const WISDOM_NEEDED_TO_GIVE_UP = 100;
const WISDOM_NEEDED_LESS_PER_ATTEMPT = 20;
const BUDDY_COMMENT_BASE_CHANCE = 15;
const BUDDY_COMMENT_DIVISOR = 20;
const BUDDY_COMMENT_SPACES = 15;

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
  skill = idiv(skill * (effectiveWisdom(s) + 100), 200);
  skill = idiv(skill * (effectiveDexterity(s) + 100), 200);
  skill += effectiveExpLevel(s) * 3;
  skill += (SKILL_TRAIT_BONUS[SkillTrait.LOCKPICKING] ?? 0) * numSkillTraits(s, SkillTrait.LOCKPICKING);
  if (electronic && !hasElectronics(s)) skill = idiv(skill, 2);
  const kit = findObj(s.inv, t.content.items.byName.get('LOCKSMITHKIT')?.index ?? -1);
  if (kit === NO_SLOT) return 0;
  return idiv(skill * (s.inv[kit]?.status[0] ?? 0), 100);
}

function plantingSkill(s: Soldier, remote: boolean): number {
  let skill = idiv(effectiveExplosive(s) * 7 + effectiveWisdom(s) * 2 + effectiveExpLevel(s) * 10, 10);
  if (remote && !hasElectronics(s)) skill = idiv(skill * 3, 4);
  const quarters = idiv(skill, 25);
  return idiv(skill + 100 * quarters, quarters + 1);
}

function disarmSkill(s: Soldier, electronic: boolean): number {
  const base = electronic ? Math.max(effectiveMechanical(s), effectiveExplosive(s)) : effectiveExplosive(s);
  let skill = base * 7;
  if (skill === 0) return 0;
  skill = idiv(skill + effectiveDexterity(s) * 2 + effectiveExpLevel(s) * 10, 10);
  skill -= idiv(100 - effectiveWisdom(s), 5);
  if (electronic && !hasElectronics(s)) skill = idiv(skill * 3, 4);
  return skill;
}

function attachingDetonatorSkill(s: Soldier, remote: boolean): number {
  const explosive = effectiveExplosive(s);
  if (explosive === 0) return 0;
  const skill = idiv(explosive * 3 + effectiveDexterity(s), 4);
  return remote && !hasElectronics(s) ? idiv(skill, 2) : skill;
}

function attachingSpecialItemSkill(s: Soldier, electronic: boolean): number {
  let skill = effectiveMechanical(s);
  if (skill === 0) return 0;
  skill = idiv(skill * (effectiveWisdom(s) + 100), 200);
  skill = idiv(skill * (effectiveDexterity(s) + 100), 200);
  skill += effectiveExpLevel(s) * 3;
  return electronic && !hasElectronics(s) ? idiv(skill, 2) : skill;
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
      return 30 + idiv(effectiveMechanical(s), 2);
    case R.NOTICE_DART:
      return idiv(effectiveWisdom(s), 10) + effectiveExpLevel(s);
    default:
      return 0;
  }
}

export interface QueenWits {
  readonly wisdom: number;
  readonly leadership: number;
}

function lieToQueenSkill(liar: Soldier, queen: QueenWits): number {
  return idiv(LIE_TO_QUEEN_SKILL_FACTOR * (effectiveWisdom(liar) + effectiveLeadership(liar)), queen.wisdom + queen.leadership);
}

export function skillCheck(t: SkillCheckContext, s: Soldier, reason: number, mod: number): number {
  return rollSkillCheck(t, s, reason, baseSkill(t, s, reason), mod);
}

export function lieToQueenCheck(t: SkillCheckContext, liar: Soldier, queen: QueenWits): number {
  return rollSkillCheck(t, liar, R.LIE_TO_QUEEN, lieToQueenSkill(liar, queen), 0);
}

function rollSkillCheck(t: SkillCheckContext, s: Soldier, reason: number, base: number, mod: number): number {
  const skill = base - skillCheckFatiguePenalty(s, base);
  let chance = skill + mod;
  if (ZEROED_BELOW_REASONABLE.has(reason) && chance < UNREASONABLE_CHANCE) chance = 0;
  else chance += moraleModifier(s);
  if (chance > 99) chance = 99;
  else if (chance < 0) chance = 0;
  const roll = t.pre.int(100);
  const madeItBy = chance - roll;
  if (madeItBy >= 0) {
    if (roll < buddyCommentChance(skill, mod)) buddiesCommentSuccess(t, s);
    return madeItBy;
  }
  if (s.lastSkillCheck === reason && s.gridNo === s.skillCheckGridNo) {
    s.skillCheckAttempts++;
    if (s.skillCheckAttempts > ATTEMPTS_BEFORE_GIVING_UP && chance === 0 && realizesItCannotBeDone(s))
      t.narrative?.sayQuote(s, MercQuote.DEFINITE_CANT_DO);
  } else {
    s.lastSkillCheck = reason;
    s.skillCheckAttempts = 1;
    s.skillCheckGridNo = s.gridNo;
  }
  return madeItBy;
}

function realizesItCannotBeDone(s: Soldier): boolean {
  return (
    WISDOM_NEEDED_TO_GIVE_UP - (s.skillCheckAttempts - ATTEMPTS_BEFORE_GIVING_UP) * WISDOM_NEEDED_LESS_PER_ATTEMPT < effectiveWisdom(s)
  );
}

function buddyCommentChance(skill: number, mod: number): number {
  return BUDDY_COMMENT_BASE_CHANCE + idiv(skill, BUDDY_COMMENT_DIVISOR) + idiv(-mod, BUDDY_COMMENT_DIVISOR);
}

function buddiesCommentSuccess(t: SkillCheckContext, s: Soldier): void {
  const { soldiers, narrative } = t;
  if (!soldiers || !narrative) return;
  for (const buddy of teamMembers({ soldiers }, Team.OUR)) {
    if (!okControllableMerc({ narrative }, buddy) || spacesAway(s.gridNo, buddy.gridNo) >= BUDDY_COMMENT_SPACES) continue;
    const comment = buddyCommentOn(t, buddy, s);
    if (comment) narrative.sayQuote(buddy, comment.quote);
  }
}

export function calcTrapDetectLevel(t: TacticalState, s: Soldier, examining: boolean): number {
  let level = effectiveExpLevel(s);
  level += idiv(effectiveExplosive(s), 40);
  level -= idiv(100 - effectiveWisdom(s), 20);
  if (examining) level += t.pre.int(idiv(level, 3) + 2);
  if (s.bleeding > BLEEDING_SHOCK_BLEEDING || s.shock > BLEEDING_SHOCK_SHOCK) level -= t.pre.int(3);
  return Math.max(level, 1);
}
