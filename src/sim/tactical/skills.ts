// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/SkillCheck.cc Effective*; Soldier_Control.h effectiveLife

import { idiv } from '../../core/int.ts';
import type { Soldier } from './soldier.ts';

export interface LifeState {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
}

export function effectiveLife(s: LifeState): number {
  return s.life + idiv(s.lifeMax - s.life - s.bleeding, 2);
}

export function effectiveStrength(s: Soldier): number {
  const half = idiv(s.stats.strength, 2);
  return Math.max(half + idiv(half * effectiveLife(s), s.lifeMax), 2);
}

export function effectiveAgility(s: Soldier): number {
  const agility = s.stats.agility;
  return s.weightCarriedAtTurnStart > 100 ? idiv(agility * 100, s.weightCarriedAtTurnStart) : agility;
}

export function effectiveDexterity(s: Soldier): number {
  return s.stats.dexterity;
}

export function effectiveWisdom(s: Soldier): number {
  return s.stats.wisdom;
}

export function effectiveMarksmanship(s: Soldier): number {
  return s.stats.marksmanship;
}

export function effectiveMechanical(s: Soldier): number {
  return s.stats.mechanical;
}

export function effectiveExplosive(s: Soldier): number {
  return s.stats.explosives;
}

export function effectiveMedical(s: Soldier): number {
  return s.stats.medical;
}

export function effectiveLeadership(s: Soldier): number {
  return s.stats.leadership;
}

export function effectiveExpLevel(s: Soldier): number {
  return Math.max(s.stats.experience, 1);
}

const MORALE_PC_TEAM = 0;

export function moraleModifier(s: Soldier): number {
  if (s.team === MORALE_PC_TEAM) {
    if (s.morale > 50) return idiv(s.morale - 45, 10);
    return idiv((s.morale - 50) * 2, 5);
  }
  switch (s.ai.morale) {
    case 0:
      return -15;
    case 1:
      return -7;
    case 3:
      return 2;
    case 4:
      return 5;
    default:
      return 0;
  }
}

export function fatiguePenaltyPercent(s: Soldier): number {
  if (s.breathMax >= 85) return 0;
  if (s.breathMax >= 70) return 10;
  if (s.breathMax >= 50) return 25;
  if (s.breathMax >= 30) return 50;
  if (s.breathMax >= 15) return 75;
  if (s.breathMax > 0) return 90;
  return 100;
}

export function skillCheckFatiguePenalty(s: Soldier, skill: number): number {
  return idiv(idiv(skill * fatiguePenaltyPercent(s), 100), 2);
}
