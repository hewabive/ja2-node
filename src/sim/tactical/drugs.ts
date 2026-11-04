// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Drugs_And_Alcohol.cc the drug tables, giDrunkModifier, GetDrugType, ApplyDrugs,
// @src HandleEndTurnDrugAdjustments, GetDrugEffect, HandleAPEffectDueToDrugs, HandleBPEffectDueToDrugs, GetDrunkLevel,
// @src EffectStatForBeingDrunk, MercUnderTheInfluence; Drugs_And_Alcohol.h; SkillCheck.cc EffectiveLeadership,
// @src EffectiveExpLevel (the drink); Morale.cc RefreshSoldierMorale (DRUG_EFFECT_MORALE_MOD, ALCOHOL_EFFECT_MORALE_MOD);
// @src Strategic/Hourly_Update.cc UpdateRegenCounters

import { i8, i16, idiv, u8, u32 } from '../../core/int.ts';
import { type ItemObject, removeObjectAt } from '../items/object.ts';
import { useKitPoints } from '../strategic/economy/kits.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import type { CombatContext } from './combat/context.ts';
import { handleMoraleEvent, MoraleEvent, refreshSoldierMorale } from './combat/morale.ts';
import { AP_LIMITS } from './points.ts';
import { profileProgress } from './profiles.ts';
import { type DrugCourse, type DrugCourses, NO_PROFILE, noDrugCourse, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export type DrugKind = keyof DrugCourses;
export type DrugType = DrugKind | 'regeneration';

interface DrugRules {
  readonly travelRate: number;
  readonly wearOffRate: number;
  readonly effect: number;
  readonly sideEffect: number;
  readonly sideEffectRate: number;
  readonly moralePercent: number;
}

export const DRUG_RULES: Readonly<Record<DrugKind, DrugRules>> = {
  adrenaline: {
    travelRate: 4,
    wearOffRate: 2,
    effect: 15,
    sideEffect: 20,
    sideEffectRate: 2,
    moralePercent: 150,
  },
  alcohol: {
    travelRate: 2,
    wearOffRate: 2,
    effect: 8,
    sideEffect: 10,
    sideEffectRate: 1,
    moralePercent: 160,
  },
};

const COMPLEX_DRUGS: readonly DrugKind[] = ['adrenaline', 'alcohol'];

export const DrunkLevel = { SOBER: 0, FEELING_GOOD: 1, BORDERLINE: 2, DRUNK: 3, HUNGOVER: 4 } as const;
export type DrunkLevel = (typeof DrunkLevel)[keyof typeof DrunkLevel];

const DRUNK_STAT_PERCENT: Readonly<Record<DrunkLevel, number>> = {
  [DrunkLevel.SOBER]: 100,
  [DrunkLevel.FEELING_GOOD]: 75,
  [DrunkLevel.BORDERLINE]: 65,
  [DrunkLevel.DRUNK]: 50,
  [DrunkLevel.HUNGOVER]: 100,
};

const DRUNK_EXP_LEVEL_CHANGE: Readonly<Record<DrunkLevel, number>> = {
  [DrunkLevel.SOBER]: 0,
  [DrunkLevel.FEELING_GOOD]: 0,
  [DrunkLevel.BORDERLINE]: -1,
  [DrunkLevel.DRUNK]: -2,
  [DrunkLevel.HUNGOVER]: 0,
};

const DRUG_TYPES: ReadonlyMap<string, DrugType> = new Map([
  ['ADRENALINE_BOOSTER', 'adrenaline'],
  ['REGEN_BOOSTER', 'regeneration'],
  ['ALCOHOL', 'alcohol'],
  ['WINE', 'alcohol'],
  ['BEER', 'alcohol'],
]);

const DRINK_KIT_POINTS: ReadonlyMap<string, number> = new Map([
  ['ALCOHOL', 10],
  ['WINE', 20],
  ['BEER', 100],
]);

const DRUG_COUNTER_CAP = 127;
const MAX_LIFETIME_DRUG_USES = 255;
const REGEN_POINTS_PER_BOOSTER = 4;
const FULL_BOOSTER_STATUS = 100;
const BOOSTER_STATUS_PER_REGEN_POINT = idiv(FULL_BOOSTER_STATUS, REGEN_POINTS_PER_BOOSTER);
const FEELING_GOOD_LEADERSHIP_PERCENT = 120;
const FEELING_GOOD_MAX_DRINKS = 3;
const BORDERLINE_MAX_DRINKS = 4;
const HANGOVER_AP_REDUCE = 5;
const HANGOVER_BP_REDUCE = 200;
const BP_RATIO_RED_PTS_TO_NORMAL = 100;
const LIFE_GAIN_PER_REGEN_POINT = 10;

export function drugTypeOf(itemName: string): DrugType | null {
  return DRUG_TYPES.get(itemName) ?? null;
}

function larryTakesADrug(c: CombatContext, s: Soldier): void {
  if (s.profile === Npc.LARRY_NORMAL) {
    c.narrative?.swapLarrysProfiles(s);
    return;
  }
  if (s.profile !== Npc.LARRY_DRUNK) return;
  const drunk = profileProgress(c, Npc.LARRY_DRUNK);
  if (drunk) drunk.npcData = 0;
}

function countLifetimeDrugUse(c: CombatContext, s: Soldier): void {
  const p = s.profile === NO_PROFILE ? null : profileProgress(c, s.profile);
  if (p && p.numTimesDrugUseInLifetime !== MAX_LIFETIME_DRUG_USES) p.numTimesDrugUseInLifetime++;
}

function addBelowCap(counter: number, amount: number): number {
  return counter + amount < DRUG_COUNTER_CAP ? i8(counter + amount) : counter;
}

function takeComplexDrug(c: CombatContext, s: Soldier, o: ItemObject, kind: DrugKind, itemName: string): void {
  const course = s.drugs[kind];
  const rules = DRUG_RULES[kind];
  course.future = addBelowCap(course.future, rules.effect);
  course.rate = rules.travelRate;
  if (kind === 'adrenaline') countLifetimeDrugUse(c, s);
  course.sideEffect = addBelowCap(course.sideEffect, rules.sideEffect);
  course.sideEffectRate = 0;
  if (kind === 'alcohol') useKitPoints(o, DRINK_KIT_POINTS.get(itemName) ?? 0);
  else removeObjectAt(o, o.count - 1);
}

function regenPointsOfBooster(c: CombatContext, status: number): number {
  let points = i8(idiv(REGEN_POINTS_PER_BOOSTER * status, FULL_BOOSTER_STATUS));
  const fraction = status % BOOSTER_STATUS_PER_REGEN_POINT;
  if (fraction !== 0 && c.pre.int(BOOSTER_STATUS_PER_REGEN_POINT) < u32(fraction)) points++;
  return points;
}

function takeRegenBooster(c: CombatContext, s: Soldier, o: ItemObject): void {
  const last = o.count - 1;
  const status = o.status[last] ?? 0;
  removeObjectAt(o, last);
  const points = i8(regenPointsOfBooster(c, status) - s.regenBoostersUsedToday);
  if (points > 0) s.regenerationCounter = Math.min(s.regenerationCounter + points, REGEN_POINTS_PER_BOOSTER);
  s.regenBoostersUsedToday = i8(s.regenBoostersUsedToday + 1);
}

export function applyDrugs(c: CombatContext, s: Soldier, o: ItemObject): boolean {
  const itemName = c.content.items.byIndex.get(o.item)?.name ?? '';
  const type = drugTypeOf(itemName);
  if (type === null) return false;
  larryTakesADrug(c, s);
  if (type === 'regeneration') takeRegenBooster(c, s, o);
  else takeComplexDrug(c, s, o, type, itemName);
  return true;
}

export function adrenalineEffect(s: Soldier): number {
  return s.drugs.adrenaline.effect;
}

export function drunkLevel(s: Soldier): DrunkLevel {
  const alcohol = s.drugs.alcohol;
  if (alcohol.effect === 0) return alcohol.sideEffect === 0 ? DrunkLevel.SOBER : DrunkLevel.HUNGOVER;
  const drinks = i8(idiv(alcohol.effect, DRUG_RULES.alcohol.effect));
  if (drinks <= FEELING_GOOD_MAX_DRINKS) return DrunkLevel.FEELING_GOOD;
  return drinks <= BORDERLINE_MAX_DRINKS ? DrunkLevel.BORDERLINE : DrunkLevel.DRUNK;
}

export function effectStatForBeingDrunk(s: Soldier, stat: number): number {
  return idiv(stat * DRUNK_STAT_PERCENT[drunkLevel(s)], 100);
}

export function leadershipForBeingDrunk(s: Soldier, leadership: number): number {
  return drunkLevel(s) === DrunkLevel.FEELING_GOOD ? i8(idiv(leadership * FEELING_GOOD_LEADERSHIP_PERCENT, 100)) : leadership;
}

export function expLevelForBeingDrunk(s: Soldier, level: number): number {
  return level + DRUNK_EXP_LEVEL_CHANGE[drunkLevel(s)];
}

export function mercUnderTheInfluence(s: Soldier): boolean {
  const adrenaline = s.drugs.adrenaline;
  return adrenaline.effect !== 0 || adrenaline.sideEffect !== 0 || drunkLevel(s) !== DrunkLevel.SOBER;
}

function atLeastApMinimum(points: number): number {
  return Math.max(points, AP_LIMITS.MINIMUM);
}

export function apEffectDueToDrugs(s: Soldier, points: number): number {
  const adrenaline = s.drugs.adrenaline;
  let adjusted = points;
  if (adrenaline.effect) adjusted += adrenaline.effect;
  else if (adrenaline.sideEffect) adjusted = atLeastApMinimum(adjusted - adrenaline.sideEffect);
  if (drunkLevel(s) === DrunkLevel.HUNGOVER) adjusted = atLeastApMinimum(adjusted - HANGOVER_AP_REDUCE);
  return u8(i16(adjusted));
}

export function bpEffectDueToDrugs(s: Soldier, reduction: number): number {
  const adrenaline = s.drugs.adrenaline;
  let adjusted = reduction;
  if (adrenaline.effect) adjusted = i16(adjusted - adrenaline.effect * BP_RATIO_RED_PTS_TO_NORMAL);
  else if (adrenaline.sideEffect) adjusted = i16(adjusted + adrenaline.sideEffect * BP_RATIO_RED_PTS_TO_NORMAL);
  if (drunkLevel(s) === DrunkLevel.HUNGOVER) adjusted = i16(adjusted + HANGOVER_BP_REDUCE);
  return adjusted;
}

export function drugMoraleBonus(s: Soldier): number {
  let bonus = 0;
  for (const kind of COMPLEX_DRUGS) bonus += idiv(s.drugs[kind].effect * DRUG_RULES[kind].moralePercent, 100);
  return bonus;
}

function decaySideEffect(c: DrugCourse): void {
  if (c.sideEffectRate <= 0) return;
  c.sideEffect = i8(c.sideEffect - c.sideEffectRate);
  if (c.sideEffect <= 0) c.sideEffect = 0;
}

function crashEvent(kind: DrugKind): number {
  return kind === 'alcohol' ? MoraleEvent.ALCOHOL_CRASH : MoraleEvent.DRUGS_CRASH;
}

function crash(t: TacticalState, s: Soldier, kind: DrugKind): void {
  const c = s.drugs[kind];
  const rules = DRUG_RULES[kind];
  c.effect = 0;
  c.sideEffectRate = rules.sideEffectRate;
  c.rate = 0;
  const crashes = idiv(c.sideEffect, rules.sideEffect) + 1;
  for (let i = 0; i < crashes; i++) handleMoraleEvent(t, s, crashEvent(kind));
}

function wearOff(t: TacticalState, s: Soldier, kind: DrugKind): void {
  const c = s.drugs[kind];
  c.effect = i8(c.effect + c.rate);
  if (c.effect <= 0) crash(t, s, kind);
}

function takeEffect(t: TacticalState, s: Soldier, kind: DrugKind): void {
  const c = s.drugs[kind];
  c.future = i8(c.future - c.rate);
  c.effect = i8(c.effect + c.rate);
  refreshSoldierMorale(t, s);
  if (c.future > 0) return;
  c.future = 0;
  c.rate = i8(-DRUG_RULES[kind].wearOffRate);
}

function regenerate(s: Soldier): void {
  if (s.regenerationCounter <= 0) return;
  s.life = Math.min(s.life + LIFE_GAIN_PER_REGEN_POINT, s.lifeMax);
  if (s.life === s.lifeMax) s.bleeding = 0;
  else if (s.bleeding + s.life > s.lifeMax) s.bleeding = s.lifeMax - s.life;
  s.regenerationCounter--;
}

export function handleEndTurnDrugAdjustments(t: TacticalState, s: Soldier): void {
  for (const kind of COMPLEX_DRUGS) {
    decaySideEffect(s.drugs[kind]);
    if (s.drugs[kind].rate < 0) wearOff(t, s, kind);
    if (s.drugs[kind].rate > 0) takeEffect(t, s, kind);
  }
  regenerate(s);
}

export function updateRegenCounters(team: readonly Soldier[]): void {
  for (const s of team) if (s.regenBoostersUsedToday > 0) s.regenBoostersUsedToday--;
}

export type DrunkView = 'feelingGood' | 'borderline' | 'drunk' | 'hungover';
export type AdrenalineView = 'active' | 'crash';

export interface DrugView {
  readonly drunk?: DrunkView;
  readonly adrenaline?: AdrenalineView;
}

const DRUNK_VIEWS: Readonly<Record<DrunkLevel, DrunkView | null>> = {
  [DrunkLevel.SOBER]: null,
  [DrunkLevel.FEELING_GOOD]: 'feelingGood',
  [DrunkLevel.BORDERLINE]: 'borderline',
  [DrunkLevel.DRUNK]: 'drunk',
  [DrunkLevel.HUNGOVER]: 'hungover',
};

function adrenalineView(s: Soldier): AdrenalineView | null {
  const adrenaline = s.drugs.adrenaline;
  if (adrenaline.effect !== 0) return 'active';
  return adrenaline.sideEffect !== 0 ? 'crash' : null;
}

export function drugView(s: Soldier): DrugView {
  const drunk = DRUNK_VIEWS[drunkLevel(s)];
  const adrenaline = adrenalineView(s);
  return { ...(drunk ? { drunk } : {}), ...(adrenaline ? { adrenaline } : {}) };
}

const DRINKS_SHOWING: Readonly<Record<DrunkView, number>> = {
  feelingGood: 1,
  borderline: BORDERLINE_MAX_DRINKS,
  drunk: BORDERLINE_MAX_DRINKS + 1,
  hungover: 0,
};

const HANGOVER_LEFT_SHOWING = 1;

function alcoholShowing(drunk: DrunkView | undefined): DrugCourse {
  const course = noDrugCourse();
  if (!drunk) return course;
  course.effect = DRINKS_SHOWING[drunk] * DRUG_RULES.alcohol.effect;
  if (drunk === 'hungover') course.sideEffect = HANGOVER_LEFT_SHOWING;
  return course;
}

export function drugCoursesShowing(view: DrugView): DrugCourses {
  return { adrenaline: noDrugCourse(), alcohol: alcoholShowing(view.drunk) };
}
