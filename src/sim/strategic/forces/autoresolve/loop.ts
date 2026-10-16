// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc ProcessBattleFrame (Finish semantics: fixed 1000 ms slices, deviation D1),
// @src AutoResolveScreenHandle (pending surrender). See docs/19 §2.6.

import { u16, u32 } from '../../../../core/int.ts';
import { OKLIFE } from '../../../tactical/soldier.ts';
import { attackTarget, chooseTarget, cosmeticSound } from './attack.ts';
import { answerSurrender, applyRetreatOrders, attemptPlayerCapture, isBattleOver, isCreatureAttack } from './end.ts';
import { targetHit } from './landing.ts';
import { resetNextAttackCounter } from './ratings.ts';
import {
  AR_SLICE_MS,
  type ArCell,
  type AutoresolveEnv,
  type AutoresolveState,
  BattleStatus,
  CellFlag,
  emitEvent,
  hasFlag,
  hasRobotController,
  isCreatureCell,
  refOf,
} from './state.ts';

const CREATURE_SKIP_PERCENT = 7;
const NEVER = 0xffff;

export type AutoresolveStop = 'over' | 'surrender' | 'budget';

export interface AutoresolveBudget {
  readonly maxSlices: number;
}

export const UNLIMITED: AutoresolveBudget = { maxSlices: Number.POSITIVE_INFINITY };

function pick(env: AutoresolveEnv, cells: readonly ArCell[]): ArCell {
  for (;;) {
    const c = cells[env.rng.pre.int(cells.length)] as ArCell;
    if (hasFlag(c, CellFlag.PROCESSED)) continue;
    c.flags |= CellFlag.PROCESSED;
    return c;
  }
}

function landBullets(env: AutoresolveEnv, ar: AutoresolveState, c: ArCell, slice: number): void {
  if (hasFlag(c, CellFlag.RETREATED)) return;
  for (let j = 0; j < c.nextHit.length; j++) {
    const pending = c.nextHit[j] ?? 0;
    if (pending === 0) continue;
    const left = pending - slice;
    if (left >= 0) c.nextHit[j] = u16(left);
    else {
      targetHit(env, ar, c, j);
      c.nextHit[j] = 0;
    }
  }
}

function completeRetreat(ar: AutoresolveState, c: ArCell): void {
  if (c.index === ar.robot && c.side === 'merc' && !hasRobotController(ar)) {
    c.flags &= ~CellFlag.RETREATING;
    c.nextAttack = NEVER;
    return;
  }
  ar.playerDefence = u16(ar.playerDefence - c.defence);
  c.defence = 0;
  c.flags |= CellFlag.RETREATED;
  emitEvent(ar, { type: 'arRetreated', battleMs: ar.elapsedMs, cell: refOf(c) });
}

export function processCell(env: AutoresolveEnv, ar: AutoresolveState, c: ArCell, slice: number): void {
  landBullets(env, ar, c, slice);
  if ((c.soldier.life < OKLIFE || hasFlag(c, CellFlag.RETREATED)) && (!isCreatureCell(c) || c.soldier.life === 0)) return;
  const left = c.nextAttack - slice;
  if (left > 0) {
    c.nextAttack = u16(left);
    return;
  }
  if (hasFlag(c, CellFlag.RETREATING)) {
    completeRetreat(ar, c);
    return;
  }
  if (c.attack === 0) return;
  const target = chooseTarget(env, ar, c);
  if (isCreatureCell(c) && env.rng.pre.int(100) < CREATURE_SKIP_PERCENT) cosmeticSound(env, ar, 'smell');
  else attackTarget(env, ar, c, target);
  resetNextAttackCounter(env.rng.pre, c);
  c.nextAttack = u16(c.nextAttack + u16(left));
}

function clearProcessed(ar: AutoresolveState): void {
  for (const c of [...ar.mercs, ...ar.militia, ...ar.enemies]) c.flags &= ~CellFlag.PROCESSED;
}

export function runSlice(env: AutoresolveEnv, ar: AutoresolveState): void {
  ar.elapsedMs = u32(ar.elapsedMs + AR_SLICE_MS);
  ar.slices++;
  const mercs = ar.mercs.length;
  const civs = ar.militia.length;
  const enemies = ar.enemies.length;
  let mercsLeft = mercs;
  let civsLeft = civs;
  let enemiesLeft = enemies;
  clearProcessed(ar);
  for (let k = mercs + civs + enemies; k >= 1; k--) {
    if (isBattleOver(env, ar)) return;
    if (!isCreatureAttack(ar) && attemptPlayerCapture(env, ar)) return;
    const r = env.rng.pre.int(k);
    let c: ArCell;
    if (mercs > 0 && r < mercsLeft) {
      mercsLeft--;
      c = pick(env, ar.mercs);
    } else if (civs > 0 && r < mercsLeft + civsLeft) {
      civsLeft--;
      c = pick(env, ar.militia);
    } else if (enemies > 0 && enemiesLeft > 0) {
      enemiesLeft--;
      c = pick(env, ar.enemies);
    } else throw new Error('autoresolve: no cell left to pick in this slice');
    processCell(env, ar, c, AR_SLICE_MS);
  }
}

function answerPendingSurrender(env: AutoresolveEnv, ar: AutoresolveState): boolean {
  const answer = env.hooks.surrender?.(ar) ?? null;
  if (answer === null) return false;
  answerSurrender(env, ar, answer === 'accept');
  return true;
}

export function runAutoresolve(env: AutoresolveEnv, ar: AutoresolveState, budget: AutoresolveBudget = UNLIMITED): AutoresolveStop {
  let slices = 0;
  for (;;) {
    if (ar.status !== BattleStatus.IN_PROGRESS) return 'over';
    if (ar.pendingSurrender) {
      if (!answerPendingSurrender(env, ar)) return 'surrender';
      continue;
    }
    if (slices >= budget.maxSlices) return 'budget';
    applyRetreatOrders(env, ar);
    runSlice(env, ar);
    slices++;
  }
}
