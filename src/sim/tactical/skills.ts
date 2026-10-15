// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/SkillCheck.cc Effective*; Soldier_Control.h effectiveLife

import type { Soldier } from './soldier.ts';

export interface LifeState {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
}

export function effectiveLife(s: LifeState): number {
  return s.life + Math.trunc((s.lifeMax - s.life - s.bleeding) / 2);
}

export function effectiveStrength(s: Soldier): number {
  const half = Math.trunc(s.stats.strength / 2);
  return Math.max(half + Math.trunc((half * effectiveLife(s)) / s.lifeMax), 2);
}

export function effectiveAgility(s: Soldier): number {
  const agility = s.stats.agility;
  return s.weightCarriedAtTurnStart > 100 ? Math.trunc((agility * 100) / s.weightCarriedAtTurnStart) : agility;
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
