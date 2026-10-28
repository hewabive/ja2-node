// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc VirtualSoldierDressWound, FindMedicalKit, AutoBandageMercs, IsAnybodyWounded,
// @src CanAnybodyBandage, DetermineBandageButtonState, SetupDoneInterface; Tactical/Items.cc TotalPoints, UseKitPoints.

import { ItemClass } from '../../../../content/items/items.ts';
import { i8, idiv, u8, u16, u32 } from '../../../../core/int.ts';
import { deleteObject, type ItemObject } from '../../../items/object.ts';
import type { CombatContext } from '../../../tactical/combat/context.ts';
import { StatCause, statChange } from '../../../tactical/combat/experience.ts';
import { findObjClass } from '../../../tactical/combat/reload.ts';
import { InvSlot, NO_SLOT } from '../../../tactical/inventory.ts';
import { StatKind } from '../../../tactical/profiles.ts';
import { effectiveDexterity, effectiveExpLevel, effectiveMedical } from '../../../tactical/skills.ts';
import { OKLIFE, type Soldier } from '../../../tactical/soldier.ts';
import { type AutoresolveEnv, type AutoresolveState, BattleStatus, combatContext } from './state.ts';

const RT_FIRST_AID_GAIN_MODIFIER = 12;
const DRESS_SKILL_DIVISOR = 7;
const POSSIBLE_DIVISOR = 50;
const SELF_BANDAGE_PASS_LIMIT = 50;
const MS_PER_KIT_POINT = 200;

export function totalPoints(o: ItemObject): number {
  let points = 0;
  for (let k = 0; k < o.count; k++) points = u16(points + (o.status[k] ?? 0));
  return points;
}

export function useKitPoints(o: ItemObject, original: number): number {
  let points = original;
  for (let k = o.count - 1; k >= 0; k--) {
    const status = o.status[k] ?? 0;
    if (points < status) {
      o.status[k] = i8(status - points);
      return original;
    }
    points -= status;
    o.status[k] = 0;
    o.count--;
  }
  deleteObject(o);
  return original - points;
}

const isMedicKit = (env: AutoresolveEnv, item: number) => env.content.items.byName.get('MEDICKIT')?.index === item;

export function dressWound(
  env: AutoresolveEnv,
  ctx: CombatContext,
  medic: Soldier,
  victim: Soldier,
  kit: ItemObject,
  kitPoints: number,
  kitStatus: number,
): number {
  if (victim.bleeding < 1 || victim.life === 0) return 0;
  const skill = idiv(
    3 * effectiveMedical(medic) + 2 * kitStatus + 10 * effectiveExpLevel(medic) + effectiveDexterity(medic),
    DRESS_SKILL_DIVISOR,
  );
  let possible = u32(idiv(RT_FIRST_AID_GAIN_MODIFIER * skill, POSSIBLE_DIVISOR));
  if (possible === 0) return 0;
  if (isMedicKit(env, medic.inv[InvSlot.HELMET]?.item ?? -1)) possible = u32(possible + idiv(possible, 2));
  let actual = possible;
  const below = victim.life >= OKLIFE ? 0 : OKLIFE - victim.life;
  let deficiency = 2 * below;
  if (victim.bleeding - below > 0) deficiency += victim.bleeding - below;
  actual = Math.min(actual, deficiency);
  let cost: number;
  if (isMedicKit(env, kit.item)) {
    cost = idiv(actual, 2);
    if (cost === 0 && actual > 0) cost = 1;
    if (cost > kitPoints) {
      cost = kitPoints;
      actual = cost * 2;
    }
  } else {
    cost = actual;
    if (cost > kitPoints) cost = actual = kitPoints;
  }
  let left = u8(actual);
  if (left && victim.life < OKLIFE) {
    if (left >= 2 * below) {
      victim.life = OKLIFE;
      victim.bleeding = i8(victim.bleeding - below);
      left = u8(left - 2 * below);
    } else {
      victim.life = i8(victim.life + idiv(left, 2));
      victim.bleeding = i8(victim.bleeding - idiv(left, 2));
      left %= 2;
    }
    if (victim.bleeding < 0) victim.bleeding = 0;
  }
  if (left && victim.bleeding) {
    if (left >= victim.bleeding) {
      left = u8(left - victim.bleeding);
      victim.bleeding = 0;
    } else {
      victim.bleeding = i8(victim.bleeding - left);
      left = 0;
    }
  }
  actual = u32(actual - left);
  if (idiv(actual, 2)) statChange(ctx, medic, StatKind.MEDICAL, idiv(actual, 2), StatCause.SUCCESS);
  if (idiv(actual, 4)) statChange(ctx, medic, StatKind.DEXTERITY, idiv(actual, 4), StatCause.SUCCESS);
  return cost;
}

const isWounded = (s: Soldier) => s.bleeding !== 0 && s.life !== 0;
const canBandageOthers = (s: Soldier) => s.life >= OKLIFE && !s.collapsed && s.stats.medical > 0;

function findMedicalKit(env: AutoresolveEnv, ar: AutoresolveState): ItemObject | null {
  for (const c of ar.mercs) {
    const slot = findObjClass(env.content.items, c.soldier, ItemClass.MEDKIT);
    if (slot !== NO_SLOT) return c.soldier.inv[slot] as ItemObject;
  }
  return null;
}

export const BandageRefusal = { NOBODY_WOUNDED: 'nobodyWounded', NO_DOCTOR: 'noDoctor', NO_KIT: 'noKit' } as const;
export type BandageRefusal = (typeof BandageRefusal)[keyof typeof BandageRefusal];

export function bandageRefusal(env: AutoresolveEnv, ar: AutoresolveState): BandageRefusal | null {
  const soldiers = ar.mercs.map((c) => c.soldier);
  if (!soldiers.some(isWounded)) return BandageRefusal.NOBODY_WOUNDED;
  if (!soldiers.some(canBandageOthers)) return BandageRefusal.NO_DOCTOR;
  return findMedicalKit(env, ar) === null ? BandageRefusal.NO_KIT : null;
}

export function canBandage(env: AutoresolveEnv, ar: AutoresolveState): boolean {
  if (ar.status !== BattleStatus.VICTORY || ar.aliveMercs === 0) return false;
  const soldiers = ar.mercs.map((c) => c.soldier);
  return soldiers.some(isWounded) && soldiers.some(canBandageOthers) && findMedicalKit(env, ar) !== null;
}

function bandageSelf(env: AutoresolveEnv, ctx: CombatContext, s: Soldier, firstSlot: number): ItemObject | null {
  let slot = firstSlot;
  let kit: ItemObject | null = null;
  let passes = 0;
  while (s.bleeding) {
    kit = s.inv[slot] as ItemObject;
    const points = totalPoints(kit);
    if (points === 0) {
      const next = findObjClass(env.content.items, s, ItemClass.MEDKIT);
      if (next === NO_SLOT || next === slot) break;
      slot = next;
      continue;
    }
    useKitPoints(kit, dressWound(env, ctx, s, s, kit, points, points));
    if (++passes > SELF_BANDAGE_PASS_LIMIT) break;
  }
  return kit;
}

export interface BandageResult {
  readonly complete: boolean;
  readonly pointsUsed: number;
}

function bandageTeam(
  env: AutoresolveEnv,
  ar: AutoresolveState,
  ctx: CombatContext,
  medic: Soldier,
  firstKit: ItemObject | null,
): BandageResult {
  let kit = firstKit;
  let used = 0;
  for (const c of ar.mercs) {
    const s = c.soldier;
    while (s.bleeding !== 0 && s.life !== 0) {
      kit ??= findMedicalKit(env, ar);
      if (!kit) return { complete: false, pointsUsed: used };
      const points = totalPoints(kit);
      if (points === 0) {
        kit = null;
        continue;
      }
      const before = { life: s.life, bleeding: s.bleeding };
      const cost = dressWound(env, ctx, medic, s, kit, points, points);
      useKitPoints(kit, cost);
      used += cost;
      if (cost === 0 && s.life === before.life && s.bleeding === before.bleeding) return { complete: false, pointsUsed: used };
    }
  }
  return { complete: true, pointsUsed: used };
}

export function autoBandageMercs(env: AutoresolveEnv, ar: AutoresolveState): BandageResult {
  const ctx = combatContext(env, ar);
  let kit: ItemObject | null = null;
  let best = ar.mercs[0]?.soldier;
  if (!best) return { complete: true, pointsUsed: 0 };
  for (const c of ar.mercs) {
    const s = c.soldier;
    if (!canBandageOthers(s)) continue;
    if (best.stats.medical < s.stats.medical) best = s;
    const slot = findObjClass(env.content.items, s, ItemClass.MEDKIT);
    if (slot === NO_SLOT) continue;
    kit = bandageSelf(env, ctx, s, slot) ?? kit;
    if (!kit) break;
  }
  const result = bandageTeam(env, ar, ctx, best, kit);
  ar.elapsedMs = u32(ar.elapsedMs + result.pointsUsed * MS_PER_KIT_POINT);
  return result;
}
