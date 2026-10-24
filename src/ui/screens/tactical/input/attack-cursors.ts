// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/UI_Cursors.cc GetProperItemCursor, HandleActivatedTargetCursor (the aim rings by bShownAimTime,
// @src the yellow full ring, the white rings when the next aim level is not affordable, the red cursor at the AP limit, the
// @src black crosshair below OK_CHANCE_TO_GET_THROUGH, the flash and sound out of range, the throwing knife's throw
// @src cursors), HandleNonActivatedTargetCursor (the reload cursors, the burst cursors), HandleKnifeCursor,
// @src HandlePunchCursor (REFINE_*_1/2), HandleAidCursor, HandleNonActivatedTossCursor, HandleBombCursor,
// @src HandleRemoteCursor, HandleRightClickAdjustCursor, HandleWheelAdjustCursor; Overhead_Types.h REFINE_AIM_*,
// @src REFINE_PUNCH_*, REFINE_KNIFE_*. See docs/28 §6.1, §6.4.

import type { EstimateAttack } from '../../../../protocol/hints.ts';

export const REFINE_AIM_1 = 0;
export const REFINE_AIM_5 = 8;
export const REFINE_PUNCH_1 = 0;
export const REFINE_PUNCH_2 = 6;
export const REFINE_KNIFE_1 = 0;
export const REFINE_KNIFE_2 = 6;
const AIM_STEP = 2;
const AIM_LEVELS = 5;
export const OK_CHANCE_TO_GET_THROUGH = 10;

export interface AimState {
  shownAimTime: number;
  fullCountRing: boolean;
}

export type FreeCursorMark = 'untouched' | 'clear' | 'cannotGetThrough' | 'outOfRange';

export interface AttackCursor {
  readonly cursor: string;
  readonly apCost: number | null;
  readonly apInvalid: boolean;
  readonly freeCursor: FreeCursorMark;
}

export interface AttackContext {
  readonly activated: boolean;
  readonly inCombat: boolean;
  readonly burst: boolean;
  readonly throwingKnife: boolean;
}

const RING_CURSOR = ['1', '3', '5', '7', '9'] as const;

function costAt(e: EstimateAttack, shownAim: number): number {
  return e.apCostByAim[Math.trunc(shownAim / AIM_STEP)] ?? e.apCost;
}

function affordable(e: EstimateAttack, cost: number): boolean {
  return e.actionPoints >= cost;
}

function plain(cursor: string): AttackCursor {
  return { cursor, apCost: null, apInvalid: false, freeCursor: 'untouched' };
}

function withAp(cursor: string, e: EstimateAttack, inCombat: boolean): AttackCursor {
  if (!inCombat) return plain(cursor);
  return { ...plain(cursor), apCost: e.apCost, apInvalid: !affordable(e, e.apCost) };
}

export function attackCursor(e: EstimateAttack, aim: AimState, c: AttackContext): AttackCursor {
  switch (e.cursor) {
    case 'target':
      return c.activated ? activatedTarget(e, aim, c) : nonActivatedTarget(e, aim, c);
    case 'punch':
      return melee(e, aim, c, true);
    case 'knife':
      return melee(e, aim, c, false);
    case 'toss':
    case 'trajectory':
      return toss(e, c.inCombat);
    case 'aid':
      return plain(c.activated ? 'ACTION_FIRSTAID_RED' : 'ACTION_FIRSTAID_GRAY');
    case 'bomb':
      return withAp(c.activated ? 'PLACE_BOMB_RED_UICURSOR' : 'PLACE_BOMB_GREY_UICURSOR', e, c.inCombat);
    case 'remote':
      return withAp(c.activated ? 'PLACE_REMOTE_RED_UICURSOR' : 'PLACE_REMOTE_GREY_UICURSOR', e, c.inCombat);
    default:
      return plain('INVALID_ACTION_UICURSOR');
  }
}

function reloadCursor(e: EstimateAttack): AttackCursor | null {
  if (!e.ammo.empty) return null;
  if (!e.ammo.canReload) return plain('BAD_RELOAD_UICURSOR');
  return { ...plain('GOOD_RELOAD_UICURSOR'), apCost: e.ammo.reloadAp };
}

function nonActivatedTarget(e: EstimateAttack, aim: AimState, c: AttackContext): AttackCursor {
  const reload = c.throwingKnife ? null : reloadCursor(e);
  if (reload) return reload;
  const cost = costAt(e, aim.shownAimTime);
  const ap = c.inCombat ? { apCost: cost, apInvalid: !affordable(e, cost) } : { apCost: null, apInvalid: false };
  const cannotGetThrough = e.chanceToGetThrough < OK_CHANCE_TO_GET_THROUGH;
  const pick = (burst: string, knife: string, single: string) => (c.burst ? burst : c.throwingKnife ? knife : single);
  if (cannotGetThrough)
    return {
      cursor: pick('ACTION_NOCHANCE_BURST_UICURSOR', 'BAD_THROW_UICURSOR', 'ACTION_NOCHANCE_SHOOT_UICURSOR'),
      ...ap,
      freeCursor: 'untouched',
    };
  if (!e.inRange)
    return {
      cursor: pick('ACTION_FLASH_BURST_UICURSOR', 'FLASH_THROW_UICURSOR', 'ACTION_FLASH_SHOOT_UICURSOR'),
      ...ap,
      freeCursor: 'untouched',
    };
  return {
    cursor: pick('ACTION_TARGETBURST_UICURSOR', 'GOOD_THROW_UICURSOR', 'ACTION_SHOOT_UICURSOR'),
    ...ap,
    freeCursor: 'untouched',
  };
}

function ringCursor(aim: AimState, enough: boolean, knife: boolean): string {
  const level = Math.min(AIM_LEVELS, Math.trunc(aim.shownAimTime / AIM_STEP) + 1);
  const kind = knife ? 'THROW' : 'TARGET';
  if (aim.fullCountRing) return level === AIM_LEVELS ? `ACTION_${kind}AIMFULL_UICURSOR` : `ACTION_${kind}AIMYELLOW${level}_UICURSOR`;
  return enough ? `ACTION_${kind}AIM${RING_CURSOR[level - 1] ?? '1'}_UICURSOR` : `ACTION_${kind}AIMCANT${level}_UICURSOR`;
}

function activatedTarget(e: EstimateAttack, aim: AimState, c: AttackContext): AttackCursor {
  const cost = costAt(e, aim.shownAimTime);
  let maxLimitHit = false;
  let enough = true;
  if (c.inCombat) {
    if (!affordable(e, cost)) maxLimitHit = true;
    else {
      const future = aim.shownAimTime + AIM_STEP;
      if (future <= REFINE_AIM_5 && !affordable(e, costAt(e, future))) enough = false;
    }
  }
  const ap = c.inCombat ? { apCost: cost, apInvalid: maxLimitHit } : { apCost: null, apInvalid: false };
  if (maxLimitHit) {
    const cursor = c.burst ? 'ACTION_TARGETREDBURST_UICURSOR' : c.throwingKnife ? 'RED_THROW_UICURSOR' : 'ACTION_TARGETRED_UICURSOR';
    return { cursor, ...ap, freeCursor: 'untouched' };
  }
  const freeCursor: FreeCursorMark =
    e.chanceToGetThrough < OK_CHANCE_TO_GET_THROUGH ? 'cannotGetThrough' : e.inRange ? 'clear' : 'outOfRange';
  if (c.burst) return { cursor: 'ACTION_TARGETCONFIRMBURST_UICURSOR', ...ap, freeCursor };
  return { cursor: ringCursor(aim, enough, c.throwingKnife), ...ap, freeCursor };
}

function melee(e: EstimateAttack, aim: AimState, c: AttackContext, punch: boolean): AttackCursor {
  const body = punch ? 'ACTION_PUNCH' : 'KNIFE';
  if (!c.activated) {
    const onTarget = e.inReach === true;
    return plain(punch ? (onTarget ? 'ACTION_PUNCH_RED' : 'ACTION_PUNCH_GRAY') : onTarget ? 'KNIFE_HIT_UICURSOR' : 'KNIFE_REG_UICURSOR');
  }
  const first = punch ? REFINE_PUNCH_1 : REFINE_KNIFE_1;
  const second = punch ? REFINE_PUNCH_2 : REFINE_KNIFE_2;
  const counted = c.inCombat || punch;
  const cost = costAt(e, aim.shownAimTime);
  const ap = counted ? { apCost: cost, apInvalid: !affordable(e, cost) } : { apCost: null, apInvalid: false };
  if (counted && !affordable(e, cost) && aim.shownAimTime === first)
    return { cursor: punch ? 'ACTION_PUNCH_RED' : 'KNIFE_HIT_UICURSOR', ...ap, freeCursor: 'untouched' };
  const enough = !counted || affordable(e, costAt(e, second));
  const step = aim.shownAimTime === first ? 1 : 2;
  const hit = punch ? 'RED' : 'HIT';
  const cursor = aim.fullCountRing
    ? `${body}_YELLOW_AIM${step}_UICURSOR`
    : enough
      ? `${body}_${hit}_AIM${step}_UICURSOR`
      : `${body}_NOGO_AIM${step}_UICURSOR`;
  return { cursor, ...ap, freeCursor: 'untouched' };
}

function toss(e: EstimateAttack, inCombat: boolean): AttackCursor {
  if (e.cursor === 'trajectory') {
    const reload = reloadCursor(e);
    if (reload) return reload;
  }
  const ap = inCombat ? { apCost: e.apCost, apInvalid: !affordable(e, e.apCost) } : { apCost: null, apInvalid: false };
  return { cursor: e.pathClear === false ? 'BAD_THROW_UICURSOR' : 'GOOD_THROW_UICURSOR', ...ap, freeCursor: 'untouched' };
}

export function aimLimits(e: EstimateAttack): { readonly step: number; readonly min: number; readonly max: number } | null {
  if (e.cursor === 'target') return { step: AIM_STEP, min: REFINE_AIM_1, max: REFINE_AIM_5 };
  if (e.cursor === 'punch') return { step: REFINE_PUNCH_2, min: REFINE_PUNCH_1, max: REFINE_PUNCH_2 };
  if (e.cursor === 'knife') return { step: REFINE_KNIFE_2, min: REFINE_KNIFE_1, max: REFINE_KNIFE_2 };
  return null;
}

export function rightClickAdjust(e: EstimateAttack, aim: AimState, burst: boolean): void {
  const limits = aimLimits(e);
  if (!limits || (e.cursor === 'target' && burst)) return;
  const future = aim.shownAimTime + limits.step;
  if (future <= limits.max && affordable(e, costAt(e, future))) {
    aim.shownAimTime = Math.min(limits.max, future);
    return;
  }
  if (!aim.fullCountRing) aim.fullCountRing = true;
  else {
    aim.shownAimTime = limits.min;
    aim.fullCountRing = false;
  }
}

export function wheelAdjust(e: EstimateAttack, aim: AimState, direction: 1 | -1, burst: boolean): void {
  const limits = aimLimits(e);
  if (!limits || (e.cursor === 'target' && burst)) return;
  if (direction < 0) {
    if (aim.shownAimTime <= limits.min) return;
    aim.shownAimTime = Math.max(limits.min, aim.shownAimTime - limits.step);
    aim.fullCountRing = false;
    return;
  }
  if (aim.shownAimTime >= limits.max) {
    aim.fullCountRing = true;
    return;
  }
  const future = Math.min(limits.max, aim.shownAimTime + limits.step);
  if (!affordable(e, costAt(e, future))) {
    aim.fullCountRing = true;
    return;
  }
  aim.shownAimTime = future;
  aim.fullCountRing = false;
}

export function confirmsBeforeAttack(e: EstimateAttack): boolean {
  return e.cursor === 'target' || e.cursor === 'punch' || e.cursor === 'knife';
}

export function aimTimeOf(aim: AimState): number {
  return Math.trunc(aim.shownAimTime / AIM_STEP);
}
