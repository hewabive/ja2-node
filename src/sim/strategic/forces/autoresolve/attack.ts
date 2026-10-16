// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc ChooseTarget, FireAShot, AttackerHasKnife, TargetHasLoadedGun,
// @src CalcHitAccuracy, AttackTarget. See docs/19 §2.7–§2.8.

import { ItemClass, NOTHING, WEAPON_CLASSES } from '../../../../content/items/items.ts';
import { i8, idiv, u8, u16 } from '../../../../core/int.ts';
import { AUTORESOLVE_IMPACT, type CombatContext } from '../../../tactical/combat/context.ts';
import { StatCause, statChange } from '../../../tactical/combat/experience.ts';
import { bulletImpact } from '../../../tactical/combat/impact.ts';
import { hthImpact } from '../../../tactical/combat/melee.ts';
import { autoReload, findObjClass } from '../../../tactical/combat/reload.ts';
import { AimShot } from '../../../tactical/combat/types.ts';
import { InvSlot, NO_SLOT, NUM_INV_SLOTS } from '../../../tactical/inventory.ts';
import { type ProfileProgress, profileProgress, StatKind } from '../../../tactical/profiles.ts';
import { NO_PROFILE, OKLIFE, type Soldier } from '../../../tactical/soldier.ts';
import { removeFromTotals } from './landing.ts';
import {
  type ArCell,
  type ArSound,
  type AutoresolveEnv,
  type AutoresolveState,
  CellFlag,
  CellGroup,
  combatContext,
  emitEvent,
  hasFlag,
  isCreatureCell,
  isMercCell,
  isMilitiaCell,
  refOf,
  robotCell,
  updateRobotController,
} from './state.ts';

const ROLL_CAP = 950;
const ROLL_CAP_SPAN = 50;
const ROLL_RANGE = 1000;
const RETREAT_ATTACK_PERCENT = 70;
const KNIFE_VS_GUN_PERCENT = 60;
const FIST_VS_GUN_PERCENT = 40;
const BULLET_DELAY_MIN_MS = 50;
const BULLET_DELAY_SPAN_MS = 400;
const UNCONSCIOUS_MISS_ONE_IN = 5;
const HEAD_PERCENT = 15;
const LEGS_PERCENT = 30;
const ACCURACY_DIVISOR = 10;
const DODGE_AGILITY_CHANCES = 5;
const SHOT_MARKSMANSHIP_CHANCES = 3;
const HIT_MARKSMANSHIP_CHANCES = 6;
const WOUND_EXPERIENCE_PER_TEN_DAMAGE = 5;
const MELEE_KILL_POINTS = 2;
const NO_BULLET_SLOT = -1;
const LAST_BULLET_SLOT = 2;

export const SOUND_VARIANTS: Readonly<Record<ArSound, number>> = { miss: 8, impact: 3, swoosh: 6, claw: 100, smell: 2 };

export function cosmeticSound(env: AutoresolveEnv, ar: AutoresolveState, sound: ArSound): number {
  const variant = env.rng.fx.int(SOUND_VARIANTS[sound]);
  emitEvent(ar, { type: 'arSound', battleMs: ar.elapsedMs, sound, variant });
  return variant;
}

export function mercProfile(ctx: CombatContext, s: Soldier): ProfileProgress | null {
  return s.profile === NO_PROFILE ? null : profileProgress(ctx, s.profile);
}

export function countShotHit(ctx: CombatContext, attacker: ArCell): void {
  if (!isMercCell(attacker)) return;
  const p = mercProfile(ctx, attacker.soldier);
  if (p) p.shotsHit++;
  statChange(ctx, attacker.soldier, StatKind.MARKSMANSHIP, HIT_MARKSMANSHIP_CHANCES, StatCause.SUCCESS);
}

export function countWound(ctx: CombatContext, target: ArCell, damage: number): void {
  if (!isMercCell(target)) return;
  const p = mercProfile(ctx, target.soldier);
  if (p) p.timesWounded++;
  statChange(ctx, target.soldier, StatKind.EXPERIENCE, WOUND_EXPERIENCE_PER_TEN_DAMAGE * idiv(damage, 10), StatCause.SUCCESS);
}

export function dodgeAgility(ctx: CombatContext, target: ArCell): void {
  if (isMercCell(target) && target.soldier.life >= OKLIFE)
    statChange(ctx, target.soldier, StatKind.AGILITY, DODGE_AGILITY_CHANCES, StatCause.SUCCESS);
}

export function applyBleeding(s: Soldier, damage: number): void {
  if (s.lifeMax - s.bleeding - damage >= s.life) s.bleeding = i8(s.bleeding + damage);
  else s.bleeding = i8(s.lifeMax - s.life);
}

function chooseAmong(
  env: AutoresolveEnv,
  candidates: readonly ArCell[],
  pool: number,
  skipRetreated: boolean,
  setPool: (v: number) => void,
): ArCell {
  let remaining = pool;
  for (const c of candidates) {
    if (c.soldier.life === 0 || (skipRetreated && hasFlag(c, CellFlag.RETREATED))) continue;
    const r = env.rng.pre.int(remaining);
    remaining = u16(remaining - c.defence);
    setPool(remaining);
    if (r < c.defence) {
      setPool(pool);
      return c;
    }
  }
  throw new Error('autoresolve: no target although the defence sums say there is one');
}

export function chooseTarget(env: AutoresolveEnv, ar: AutoresolveState, attacker: ArCell): ArCell {
  if (hasFlag(attacker, CellGroup.ENEMY | CellGroup.CREATURE)) {
    return chooseAmong(env, [...ar.mercs, ...ar.militia], ar.playerDefence, true, (v) => {
      ar.playerDefence = v;
    });
  }
  return chooseAmong(env, ar.enemies, ar.enemyDefence, false, (v) => {
    ar.enemyDefence = v;
  });
}

function inventoryContext(ctx: CombatContext, s: Soldier) {
  return {
    items: ctx.content.items,
    inCombat: false,
    actionPoints: () => s.actionPoints,
    spendActionPoints: () => {},
    dropAtFeet: () => {},
  };
}

export function fireAShot(env: AutoresolveEnv, ar: AutoresolveState, attacker: ArCell): boolean {
  const ctx = combatContext(env, ar);
  if (hasFlag(attacker, CellGroup.MALE_CREATURE)) {
    attacker.weaponSlot = InvSlot.SECOND_HAND;
    return true;
  }
  const s = attacker.soldier;
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) {
    const o = s.inv[slot];
    if (!o || env.content.items.byIndex.get(o.item)?.itemClass !== ItemClass.GUN) continue;
    attacker.weaponSlot = slot;
    if (o.gunShotsLeft === 0) autoReload(inventoryContext(ctx, s), s);
    if (o.gunShotsLeft > 0) {
      if (isMercCell(attacker)) {
        const p = mercProfile(ctx, s);
        if (p) p.shotsFired++;
        statChange(ctx, s, StatKind.MARKSMANSHIP, SHOT_MARKSMANSHIP_CHANCES, StatCause.SUCCESS);
      }
      o.gunShotsLeft--;
      return true;
    }
  }
  attacker.weaponSlot = NO_SLOT;
  return false;
}

export function targetHasLoadedGun(env: AutoresolveEnv, s: Soldier): boolean {
  return s.inv.some((o) => env.content.items.byIndex.get(o.item)?.itemClass === ItemClass.GUN && o.gunShotsLeft > 0);
}

export function calcHitAccuracy(env: AutoresolveEnv, attack: number, defence: number, target: ArCell): number {
  const margin = attack - defence + env.rng.pre.int(Math.max(defence - target.defence, 0));
  return u8(idiv(Math.max(margin, 0), ACCURACY_DIVISOR));
}

function roll(env: AutoresolveEnv, rating: number): number {
  return u16(rating < ROLL_CAP ? rating + env.rng.pre.int(ROLL_RANGE - rating) : ROLL_CAP + env.rng.pre.int(ROLL_CAP_SPAN));
}

function reserveBulletSlot(env: AutoresolveEnv, attacker: ArCell, target: ArCell): number {
  const slot = target.nextHit.indexOf(0);
  if (slot === NO_BULLET_SLOT) return NO_BULLET_SLOT;
  target.nextHit[slot] = u16(BULLET_DELAY_MIN_MS + env.rng.pre.int(BULLET_DELAY_SPAN_MS));
  target.attackers[slot] = refOf(attacker);
  target.hitDamage[slot] = 0;
  return slot;
}

interface AttackForm {
  readonly melee: boolean;
  readonly knife: boolean;
  readonly claw: boolean;
}

function attackForm(env: AutoresolveEnv, ar: AutoresolveState, attacker: ArCell): AttackForm {
  if (hasFlag(attacker, CellGroup.FEMALE_CREATURE)) {
    attacker.weaponSlot = InvSlot.HAND;
    return { melee: true, knife: false, claw: true };
  }
  if (fireAShot(env, ar, attacker)) return { melee: false, knife: false, claw: false };
  attacker.weaponSlot = findObjClass(env.content.items, attacker.soldier, ItemClass.BLADE);
  return { melee: true, knife: attacker.weaponSlot !== NO_SLOT, claw: false };
}

function attackKind(attacker: ArCell, form: AttackForm) {
  if (form.claw) return 'claw' as const;
  if (form.knife) return 'knife' as const;
  if (form.melee) return 'punch' as const;
  return hasFlag(attacker, CellGroup.MALE_CREATURE) ? ('spit' as const) : ('shot' as const);
}

function meleeMissSound(env: AutoresolveEnv, ar: AutoresolveState, form: AttackForm): void {
  if (form.knife) return;
  if (form.claw) cosmeticSound(env, ar, 'claw');
  else cosmeticSound(env, ar, 'swoosh');
}

function hitLocation(env: AutoresolveEnv): number {
  const r = env.rng.pre.int(100);
  return r < HEAD_PERCENT ? AimShot.HEAD : r < LEGS_PERCENT ? AimShot.LEGS : AimShot.TORSO;
}

function shotHits(
  env: AutoresolveEnv,
  ar: AutoresolveState,
  attacker: ArCell,
  target: ArCell,
  attack: number,
  defence: number,
  slot: number,
): void {
  const ctx = combatContext(env, ar);
  const weapon = attacker.soldier.inv[attacker.weaponSlot]?.item ?? NOTHING;
  const impact = env.content.items.byIndex.get(weapon)?.weapon?.impact ?? 0;
  const location = hitLocation(env);
  const accuracy = calcHitAccuracy(env, attack, defence, target);
  const damage = bulletImpact(ctx, attacker.soldier, target.soldier, location, impact, accuracy, 0, AUTORESOLVE_IMPACT).damage;
  if (slot === NO_BULLET_SLOT) target.hitDamage[LAST_BULLET_SLOT] = u16((target.hitDamage[LAST_BULLET_SLOT] ?? 0) + damage);
  else target.hitDamage[slot] = u16(damage);
}

function meleeWeapon(env: AutoresolveEnv, attacker: ArCell): number {
  if (attacker.weaponSlot === NO_SLOT) return NOTHING;
  const item = attacker.soldier.inv[attacker.weaponSlot]?.item ?? NOTHING;
  return (env.content.items.byIndex.get(item)?.itemClass ?? ItemClass.NONE) & WEAPON_CLASSES ? item : NOTHING;
}

function creditMeleeKill(ar: AutoresolveState, ctx: CombatContext, attacker: ArCell): void {
  if (isMercCell(attacker)) {
    const p = mercProfile(ctx, attacker.soldier);
    if (p) p.kills++;
    ar.playerKills++;
  } else if (isMilitiaCell(attacker)) attacker.militiaKills += MELEE_KILL_POINTS;
}

function meleeHits(
  env: AutoresolveEnv,
  ar: AutoresolveState,
  attacker: ArCell,
  target: ArCell,
  attack: number,
  defence: number,
  form: AttackForm,
): void {
  const ctx = combatContext(env, ar);
  cosmeticSound(env, ar, 'impact');
  const t = target.soldier;
  if (t.life === 0) return;
  const accuracy = calcHitAccuracy(env, attack, defence, target);
  attacker.soldier.attackingWeapon = meleeWeapon(env, attacker);
  const damage = hthImpact(ctx, attacker.soldier, t, accuracy, form.knife || form.claw);
  const newLife = t.life - damage;
  countShotHit(ctx, attacker);
  countWound(ctx, target, damage);
  emitEvent(ar, { type: 'arHit', battleMs: ar.elapsedMs, target: refOf(target), damage, life: Math.max(newLife, 0) });
  if (!isCreatureCell(target) && newLife < OKLIFE && t.life >= OKLIFE) {
    target.flags &= ~CellFlag.RETREATING;
    emitEvent(ar, { type: 'arFell', battleMs: ar.elapsedMs, cell: refOf(target) });
  }
  if (newLife <= 0) {
    creditMeleeKill(ar, ctx, attacker);
    emitEvent(ar, { type: 'arDied', battleMs: ar.elapsedMs, cell: refOf(target), killer: refOf(attacker) });
  }
  t.life = i8(Math.max(newLife, 0));
  if (isMercCell(target) && robotCell(ar)) updateRobotController(env, ar);
  if (form.knife || form.claw) applyBleeding(t, damage);
  if (t.life === 0) removeFromTotals(ar, target);
}

export function attackTarget(env: AutoresolveEnv, ar: AutoresolveState, attacker: ArCell, target: ArCell): void {
  const ctx = combatContext(env, ar);
  let attack = roll(env, attacker.attack);
  if (hasFlag(target, CellFlag.RETREATING) && !hasFlag(attacker, CellGroup.FEMALE_CREATURE))
    attack = idiv(attack * RETREAT_ATTACK_PERCENT, 100);
  const defence = roll(env, target.defence);
  const form = attackForm(env, ar, attacker);
  if (form.melee && !form.claw && targetHasLoadedGun(env, target.soldier) && !isCreatureCell(attacker))
    attack = idiv(attack * (form.knife ? KNIFE_VS_GUN_PERCENT : FIST_VS_GUN_PERCENT), 100);
  emitEvent(ar, {
    type: 'arAttack',
    battleMs: ar.elapsedMs,
    attacker: refOf(attacker),
    target: refOf(target),
    kind: attackKind(attacker, form),
  });
  const slot = form.melee ? NO_BULLET_SLOT : reserveBulletSlot(env, attacker, target);
  if (attack < defence && (target.soldier.life >= OKLIFE || env.rng.pre.int(UNCONSCIOUS_MISS_ONE_IN) === 0)) {
    if (form.melee) {
      meleeMissSound(env, ar, form);
      emitEvent(ar, { type: 'arMiss', battleMs: ar.elapsedMs, target: refOf(target) });
      dodgeAgility(ctx, target);
    }
    return;
  }
  if (form.melee) meleeHits(env, ar, attacker, target, attack, defence, form);
  else shotHits(env, ar, attacker, target, attack, defence, slot);
}
