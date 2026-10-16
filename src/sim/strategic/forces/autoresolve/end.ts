// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc RetreatButtonCallback, MercCellMouseClickCallback, IsBattleOver,
// @src AttemptPlayerCapture, AcceptSurrenderCallback, RejectSurrenderCallback. See docs/19 §2.11–§2.13.

import { u8, u16 } from '../../../../core/int.ts';
import type { RandomStream } from '../../../tactical/combat/context.ts';
import { OKLIFE } from '../../../tactical/soldier.ts';
import { EncounterCode } from '../constants.ts';
import {
  type ArCell,
  type AutoresolveEnv,
  type AutoresolveState,
  BattleStatus,
  CellFlag,
  emitEvent,
  hasFlag,
  hasRobotController,
  robotCell,
} from './state.ts';

const RETREAT_TIMER_BASE_MS = 1000;
const RETREAT_TIMER_SPAN = 2000;
const RETREAT_TIMER_FACTOR = 2;
const RETREAT_ALL_TIMER_MULTIPLIER = 2;
const RETREAT_ONE_TIMER_MULTIPLIER = 5;
const NEVER = 0xffff;
const CAPTURE_START_DAY = 4;
const MIN_CAPTURED_MERCS = 2;
const MAX_CAPTURED_MERCS = 3;
const CAPTURE_ODDS = 2;
const CAPTURE_LIFE_PERCENT = 60;
const SURRENDER_OFFER_PERCENT = 2;
const CAPTURE_PERCENT = 25;

const retreatingOrRetreated = (c: ArCell): boolean => hasFlag(c, CellFlag.RETREATING | CellFlag.RETREATED);

function startRetreat(pre: RandomStream, ar: AutoresolveState, c: ArCell, multiplier: number): void {
  c.flags |= CellFlag.RETREATING;
  c.nextAttack = u16((RETREAT_TIMER_BASE_MS + c.nextAttack * multiplier + pre.int(RETREAT_TIMER_SPAN - c.attack)) * RETREAT_TIMER_FACTOR);
  ar.playerAttack = u16(ar.playerAttack - c.attack);
  c.attack = 0;
}

function groundRobot(robot: ArCell): void {
  robot.flags &= ~CellFlag.RETREATING;
  robot.nextAttack = NEVER;
}

export function retreatAll(pre: RandomStream, ar: AutoresolveState): void {
  for (const c of ar.mercs) if (!retreatingOrRetreated(c)) startRetreat(pre, ar, c, RETREAT_ALL_TIMER_MULTIPLIER);
  const robot = robotCell(ar);
  if (!robot) return;
  if (!hasRobotController(ar)) {
    groundRobot(robot);
    return;
  }
  const controller = ar.mercs[ar.robotController];
  if (controller) robot.nextAttack = controller.nextAttack;
}

export function retreatOne(pre: RandomStream, ar: AutoresolveState, index: number): boolean {
  const c = ar.mercs[index];
  if (!c || ar.pendingSurrender || retreatingOrRetreated(c) || index === ar.robot) return false;
  startRetreat(pre, ar, c, RETREAT_ONE_TIMER_MULTIPLIER);
  const robot = robotCell(ar);
  if (!robot) return true;
  if (!hasRobotController(ar)) groundRobot(robot);
  else if (ar.robotController === index) {
    robot.flags |= CellFlag.RETREATING;
    robot.nextAttack = c.nextAttack;
    ar.playerAttack = u16(ar.playerAttack - robot.attack);
    robot.attack = 0;
  }
  return true;
}

export function canOrderRetreat(ar: AutoresolveState, merc: number | null): boolean {
  if (ar.status !== BattleStatus.IN_PROGRESS || ar.pendingSurrender) return false;
  if (merc === null) return ar.mercs.length > 0;
  const c = ar.mercs[merc];
  return c !== undefined && merc !== ar.robot && !retreatingOrRetreated(c);
}

export function orderRetreat(ar: AutoresolveState, merc: number | null): boolean {
  if (!canOrderRetreat(ar, merc)) return false;
  ar.orders.push({ merc });
  return true;
}

export function applyRetreatOrders(env: AutoresolveEnv, ar: AutoresolveState): void {
  for (const order of ar.orders.splice(0)) {
    if (order.merc === null) retreatAll(env.rng.pre, ar);
    else retreatOne(env.rng.pre, ar, order.merc);
  }
}

function finish(ar: AutoresolveState, status: number): true {
  ar.status = status;
  emitEvent(ar, { type: 'arBattleOver', battleMs: ar.elapsedMs, status });
  return true;
}

function robotLeftAlone(ar: AutoresolveState, involved: number): boolean {
  const robot = robotCell(ar);
  if (!robot || hasRobotController(ar)) return false;
  ar.playerAttack = u16(ar.playerAttack - robot.attack);
  robot.attack = 0;
  if (involved !== 1 || ar.aliveCivs !== 0) return false;
  robot.soldier.life = 0;
  ar.aliveMercs = u8(ar.aliveMercs - 1);
  return true;
}

export function isBattleOver(env: AutoresolveEnv, ar: AutoresolveState): boolean {
  if (ar.status !== BattleStatus.IN_PROGRESS) return true;
  let involved = 0;
  let retreated = 0;
  let onlyEPCs = true;
  for (const c of ar.mercs) {
    if (hasFlag(c, CellFlag.RETREATED)) retreated++;
    else if (c.soldier.life !== 0 && !hasFlag(c, CellFlag.EPC)) {
      onlyEPCs = false;
      involved++;
    }
  }
  if (robotLeftAlone(ar, involved)) {
    involved = 0;
    onlyEPCs = true;
  }
  if (ar.aliveCivs === 0 && involved === 0 && retreated > 0) {
    finish(ar, BattleStatus.RETREAT);
    env.hooks.battleRetreat?.(ar);
    return true;
  }
  if (ar.aliveCivs === 0 && involved === 0) {
    if (onlyEPCs) {
      for (const c of ar.mercs) if (hasFlag(c, CellFlag.EPC) && c.soldier.life !== 0) c.soldier.life = 0;
      ar.aliveMercs = 0;
    }
    return finish(ar, BattleStatus.DEFEAT);
  }
  if (ar.aliveEnemies === 0) return finish(ar, BattleStatus.VICTORY);
  return false;
}

function captureConditions(env: AutoresolveEnv, ar: AutoresolveState): boolean {
  if (env.world.day < CAPTURE_START_DAY && !ar.allowCapture) return false;
  if (ar.playerRejectedSurrender || env.world.playerCapturedForRescue || ar.captureNotPermittedDueToEPCs) return false;
  if (ar.aliveCivs > 0 || ar.aliveMercs < MIN_CAPTURED_MERCS || ar.aliveMercs > MAX_CAPTURED_MERCS) return false;
  if (ar.aliveEnemies < ar.aliveMercs * CAPTURE_ODDS) return false;
  const conscious = ar.enemies.filter((c) => c.soldier.life >= OKLIFE).length;
  return conscious >= ar.aliveMercs * CAPTURE_ODDS;
}

function mercsCapturable(ar: AutoresolveState): { readonly capturable: boolean; readonly conscious: boolean } {
  let conscious = false;
  for (const c of ar.mercs) {
    if (hasFlag(c, CellFlag.ROBOT)) return { capturable: false, conscious };
    if (c.soldier.life * 100 > c.soldier.lifeMax * CAPTURE_LIFE_PERCENT) return { capturable: false, conscious };
    if (c.soldier.life >= OKLIFE) conscious = true;
  }
  return { capturable: true, conscious };
}

function capture(env: AutoresolveEnv, ar: AutoresolveState, status: number): void {
  env.hooks.beginCaptureSequence?.();
  finish(ar, status);
}

export function attemptPlayerCapture(env: AutoresolveEnv, ar: AutoresolveState): boolean {
  if (!captureConditions(env, ar)) return false;
  const mercs = mercsCapturable(ar);
  if (!mercs.capturable) return false;
  if (mercs.conscious) {
    if (env.rng.pre.int(100) < SURRENDER_OFFER_PERCENT) ar.pendingSurrender = true;
  } else if (env.rng.pre.int(100) < CAPTURE_PERCENT) capture(env, ar, BattleStatus.CAPTURED);
  return true;
}

export function answerSurrender(env: AutoresolveEnv, ar: AutoresolveState, accept: boolean): void {
  if (!ar.pendingSurrender) return;
  ar.pendingSurrender = false;
  if (accept) capture(env, ar, BattleStatus.SURRENDERED);
  else ar.playerRejectedSurrender = true;
}

export function isCreatureAttack(ar: AutoresolveState): boolean {
  return ar.encounter === EncounterCode.CREATURE_ATTACK;
}
