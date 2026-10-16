// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc TargetHitCallback and the team-total bookkeeping of AttackTarget.
// See docs/19 §2.9–§2.10.

import { i8, idiv, u8, u16 } from '../../../../core/int.ts';
import { StatCause, statChange } from '../../../tactical/combat/experience.ts';
import { StatKind } from '../../../tactical/profiles.ts';
import { Body, OKLIFE } from '../../../tactical/soldier.ts';
import { applyBleeding, cosmeticSound, countShotHit, countWound, dodgeAgility, mercProfile } from './attack.ts';
import {
  type ArCell,
  type AutoresolveEnv,
  type AutoresolveState,
  CellFlag,
  CellGroup,
  type CellRef,
  cellAt,
  combatContext,
  emitEvent,
  hasFlag,
  isMercCell,
  isMilitiaCell,
  refOf,
  robotCell,
  sameCell,
  updateRobotController,
} from './state.ts';

const KILL_EXPERIENCE_PER_LEVEL = 10;
const ASSIST_EXPERIENCE_PER_LEVEL = 5;
const KILL_POINTS = 2;
const ASSIST_POINTS = 1;

const CREATURE_REDUCTION: Readonly<Record<number, { readonly add: number; readonly divisor: number }>> = {
  [Body.YAF_MONSTER]: { add: 2, divisor: 4 },
  [Body.YAM_MONSTER]: { add: 2, divisor: 4 },
  [Body.ADULTFEMALEMONSTER]: { add: 3, divisor: 6 },
  [Body.AM_MONSTER]: { add: 3, divisor: 6 },
  [Body.QUEENMONSTER]: { add: 4, divisor: 8 },
};

export function removeFromTotals(ar: AutoresolveState, c: ArCell): void {
  if (hasFlag(c, CellGroup.PLAYER)) {
    ar.playerAttack = u16(ar.playerAttack - c.attack);
    ar.playerDefence = u16(ar.playerDefence - c.defence);
    if (isMercCell(c)) ar.aliveMercs = u8(ar.aliveMercs - 1);
    else ar.aliveCivs = u8(ar.aliveCivs - 1);
  } else {
    ar.enemyAttack = u16(ar.enemyAttack - c.attack);
    ar.enemyDefence = u16(ar.enemyDefence - c.defence);
    ar.aliveEnemies = u8(ar.aliveEnemies - 1);
  }
  c.attack = 0;
  c.defence = 0;
}

export function reduceCreatureDamage(body: number, damage: number): number {
  const r = CREATURE_REDUCTION[body];
  return r ? u16(idiv(damage + r.add, r.divisor)) : damage;
}

function assister(target: ArCell, slot: number, killer: CellRef | null): CellRef | null {
  let first = target.attackers[(slot + 1) % 3] ?? null;
  let second = target.attackers[(slot + 2) % 3] ?? null;
  if (sameCell(killer, first)) first = null;
  if (sameCell(killer, second)) second = null;
  if (sameCell(first, second)) second = null;
  return first ?? second;
}

function creditKill(env: AutoresolveEnv, ar: AutoresolveState, target: ArCell, slot: number): void {
  const killerRef = target.attackers[slot] ?? null;
  if (!killerRef) return;
  const killer = cellAt(ar, killerRef);
  if (!hasFlag(killer, CellGroup.PLAYER)) return;
  const ctx = combatContext(env, ar);
  if (isMercCell(killer)) {
    const p = mercProfile(ctx, killer.soldier);
    if (p) p.kills++;
    ar.playerKills++;
    statChange(ctx, killer.soldier, StatKind.EXPERIENCE, KILL_EXPERIENCE_PER_LEVEL * target.soldier.level, StatCause.SUCCESS);
    env.hooks.killedEnemy?.(killer.soldier);
  } else if (isMilitiaCell(killer)) killer.militiaKills += KILL_POINTS;
  const assistRef = assister(target, slot, killerRef);
  if (!assistRef) return;
  const assist = cellAt(ar, assistRef);
  if (isMercCell(assist)) {
    const p = mercProfile(ctx, assist.soldier);
    if (p) p.assists++;
    statChange(ctx, assist.soldier, StatKind.EXPERIENCE, ASSIST_EXPERIENCE_PER_LEVEL * target.soldier.level, StatCause.SUCCESS);
  } else if (isMilitiaCell(assist)) assist.militiaKills += ASSIST_POINTS;
}

export function targetHit(env: AutoresolveEnv, ar: AutoresolveState, target: ArCell, slot: number): void {
  const t = target.soldier;
  if (t.life === 0) return;
  const ctx = combatContext(env, ar);
  const attackerRef = target.attackers[slot] ?? null;
  const damage = reduceCreatureDamage(t.bodyType, target.hitDamage[slot] ?? 0);
  target.hitDamage[slot] = damage;
  const newLife = t.life - damage;
  if (damage === 0) {
    dodgeAgility(ctx, target);
    cosmeticSound(env, ar, 'miss');
    emitEvent(ar, { type: 'arMiss', battleMs: ar.elapsedMs, target: refOf(target) });
    return;
  }
  if (attackerRef) countShotHit(ctx, cellAt(ar, attackerRef));
  countWound(ctx, target, damage);
  cosmeticSound(env, ar, 'impact');
  emitEvent(ar, { type: 'arHit', battleMs: ar.elapsedMs, target: refOf(target), damage, life: Math.max(newLife, 0) });
  if (newLife < OKLIFE && t.life >= OKLIFE) {
    target.flags &= ~CellFlag.RETREATING;
    emitEvent(ar, { type: 'arFell', battleMs: ar.elapsedMs, cell: refOf(target) });
  }
  if (newLife <= 0) {
    creditKill(env, ar, target, slot);
    emitEvent(ar, { type: 'arDied', battleMs: ar.elapsedMs, cell: refOf(target), killer: attackerRef });
  }
  t.life = i8(Math.max(newLife, 0));
  if (isMercCell(target) && robotCell(ar)) updateRobotController(env, ar);
  applyBleeding(t, damage);
  if (t.life === 0) removeFromTotals(ar, target);
}
