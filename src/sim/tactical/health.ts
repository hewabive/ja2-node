// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc bHealthStrRanges; Strategic/Auto_Resolve.cc RenderSoldierCellHealth;
// @src Strategic/PreBattle_Interface.cc GetSoldierConditionInfo.
// @src See docs/19 §5.3.

export const HEALTH_CATEGORIES = ['dying', 'critical', 'wounded', 'poor', 'fair', 'good', 'excellent'] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];
export const LIFELESS_HEALTH_INDEX = -1;

const HEALTH_RANGES = [15, 30, 45, 60, 75, 90, 101] as const;
const FULL_LIFE_FIRST_CATEGORY = 4;
const LAST_SEARCHED_CATEGORY = 6;

export function healthCategory(life: number, lifeMax: number): HealthCategory {
  let k = life === lifeMax ? FULL_LIFE_FIRST_CATEGORY : 0;
  for (; k < LAST_SEARCHED_CATEGORY; k++) if (life < (HEALTH_RANGES[k] ?? 0)) break;
  return HEALTH_CATEGORIES[k] ?? 'excellent';
}

export type SoldierCondition = 'dead' | 'dying' | 'unconscious' | 'bleeding' | 'wounded' | 'fatigued' | 'fair' | 'good' | 'excellent';

const OKLIFE = 15;
const OKBREATH = 10;
const MIN_BLEEDING_THRESHOLD = 12;
const WOUNDED_PERCENT = 50;
const FATIGUED_BREATH = 50;
const FAIR_PERCENT = 67;
const GOOD_PERCENT = 86;

export interface ConditionInputs {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  readonly breath: number;
  readonly collapsed: boolean;
}

export function soldierCondition(s: ConditionInputs): SoldierCondition {
  if (s.life === 0) return 'dead';
  if (s.life < OKLIFE && s.bleeding !== 0) return 'dying';
  if (s.breath < OKBREATH && s.collapsed) return 'unconscious';
  if (s.bleeding > MIN_BLEEDING_THRESHOLD) return 'bleeding';
  if (s.life * 100 < s.lifeMax * WOUNDED_PERCENT) return 'wounded';
  if (s.breath < FATIGUED_BREATH) return 'fatigued';
  if (s.life * 100 < s.lifeMax * FAIR_PERCENT) return 'fair';
  if (s.life * 100 < s.lifeMax * GOOD_PERCENT) return 'good';
  return 'excellent';
}
