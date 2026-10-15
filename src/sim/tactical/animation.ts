// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc EVENT_InitNewSoldierAnim, SetSoldierAniSpeed, CalculateSoldierAniSpeed,
// @src SoldierGotoStationaryStance, ChangeSoldierStance, EVENT_SetSoldierDirection, EVENT_InternalSetSoldierDesiredDirection,
// @src TurnSoldier, AdjustForFastTurnAnimation, BeginSoldierClimbFence; Soldier_Ani.cc AdjustToNextAnimationFrame.
// See docs/03, docs/06 §5, docs/07 §4.

import { type OpOutcome, stepToNextFrame } from '../../content/anim/script.ts';
import { type AnimationTables, AnimFlags, stateId } from '../../content/anim/tables.ts';
import { newGridNo } from '../../content/world/grid.ts';
import { TERRAIN_SPEED_DELAY } from './constants.ts';
import type { TacticalContent } from './content.ts';
import { DIRECTION_COUNT, DIRECTION_INCREMENT, quickestTurnIncrement } from './directions.ts';
import { handlePendingDoor } from './doors.ts';
import { getNewSoldierPath, handleGotoNewGridNo, isJumpableFenceAt, moveMercFacingDirection, setSoldierPosition } from './movement.ts';
import { newOKDestination } from './pathfinding.ts';
import { deductBreath } from './points.ts';
import { NO_PENDING_ANIMATION, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

export const AnimHeight = { STAND: 6, CROUCH: 3, PRONE: 1 } as const;
export const NO_DESIRED_HEIGHT = 255;
export const LOCKED_NO_NEWGRIDNO = 2;

const Flag = {
  IGNORE_AUTOSTANCE: 0x00000001,
  OK_CHARGE_AP_FOR_TURN: 0x00000002,
  FIREREADY: 0x00000040,
  NONINTERRUPT: 0x00000080,
  RT_NONINTERRUPT: 0x04000000,
} as const;

const STATIONARY_COMPUTED_DELAY = 40;
const MIN_BREATH_DELAY = 40;
const FAST_TURN_DELAY = 30;
const MAX_BREATH_DEFICIT = 30;
const INJURED_CHANGE_THRESHOLD = 30;
const PAUSE_ALL_UPDATES_DELAY = 10000;
const REGFEMALE = 3;

const OP_PAUSE_ONE_FRAME = 402;
const OP_NONINT_DONE = 442;
const OP_HOP_FENCE_STEP = 443;
const OP_END_HOP_FENCE = 444;
const OP_HOP_FENCE_FULL_STEP = 445;
const OP_PAUSE_ANIMOVE_ON = 446;
const OP_BEGIN_HOP_FENCE = 450;
const OP_PAUSE_ANIMOVE_OFF = 471;
const OP_OPEN_STRUCT = 494;
const OP_OPEN_DOOR = 495;
const OP_END_OF_ANIMATION = 499;
const HOP_FENCE_FORWARD_SE: readonly number[] = [2.2, 0.7, 3.2, 0.7];
const HOP_FENCE_FORWARD_NW: readonly number[] = [2.7, 1.0, 2.7, 1.0];
const HOP_FENCE_FORWARD_FULL_SE: readonly number[] = [1.1, 1.0, 2.1, 1.1];
const HOP_FENCE_FORWARD_FULL_NW: readonly number[] = [0.8, 0.2, 2.7, 0.8];
const OP_RT_NONINT_DONE = 772;

export interface NamedStates {
  readonly WALKING: number;
  readonly STANDING: number;
  readonly KNEEL_DOWN: number;
  readonly KNEEL_UP: number;
  readonly CROUCHING: number;
  readonly PRONE_DOWN: number;
  readonly PRONE_UP: number;
  readonly PRONE: number;
  readonly RUNNING: number;
  readonly SWATTING: number;
  readonly START_SWAT: number;
  readonly END_SWAT: number;
  readonly CRAWLING: number;
  readonly HOPFENCE: number;
  readonly END_HURT_WALKING: number;
  readonly START_COWER: number;
  readonly COWERING: number;
}

const namedCache = new WeakMap<AnimationTables, NamedStates>();

export function states(tables: AnimationTables): NamedStates {
  const cached = namedCache.get(tables);
  if (cached) return cached;
  const names: (keyof NamedStates)[] = [
    'WALKING',
    'STANDING',
    'KNEEL_DOWN',
    'KNEEL_UP',
    'CROUCHING',
    'PRONE_DOWN',
    'PRONE_UP',
    'PRONE',
    'RUNNING',
    'SWATTING',
    'START_SWAT',
    'END_SWAT',
    'CRAWLING',
    'HOPFENCE',
    'END_HURT_WALKING',
    'START_COWER',
    'COWERING',
  ];
  const named = Object.fromEntries(names.map((n) => [n, stateId(tables, n)])) as unknown as NamedStates;
  namedCache.set(tables, named);
  return named;
}

function flags(content: TacticalContent, state: number): number {
  return content.animations.controls[state]?.flags ?? 0;
}

export function hasAnimFlag(content: TacticalContent, state: number, flag: number): boolean {
  return (flags(content, state) & flag) >>> 0 !== 0;
}

export function endHeight(content: TacticalContent, state: number): number {
  return content.animations.controls[state]?.endHeight ?? AnimHeight.STAND;
}

export function height(content: TacticalContent, state: number): number {
  return content.animations.controls[state]?.height ?? AnimHeight.STAND;
}

export function isMoving(content: TacticalContent, state: number): boolean {
  return hasAnimFlag(content, state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE);
}

function speedTableFor(tables: AnimationTables, id: string): readonly { speed: number }[] | null {
  if (id === 'WALKING') return tables.bodySpeeds.walk;
  if (id === 'RUNNING') return tables.bodySpeeds.run;
  if (id === 'SWATTING') return tables.bodySpeeds.swat;
  if (id === 'CRAWLING') return tables.bodySpeeds.crawl;
  return null;
}

export function computedAnimationDelay(t: TacticalState, s: Soldier): number {
  const content = t.content;
  const control = content.animations.controls[s.state];
  if (!control) return 0;
  const id = control.id;
  if (id === 'STANDING' || id === 'PRONE' || id === 'CROUCHING') return Math.max(s.breath * 2 + (100 - s.life), MIN_BREATH_DELAY);
  const bodyLimited = id === 'SWATTING' || id === 'CRAWLING';
  const table = speedTableFor(content.animations, id);
  const additional = table && (!bodyLimited || s.bodyType <= REGFEMALE) ? Math.max(0, table[s.bodyType]?.speed ?? 0) : 0;
  const terrain = control.flags & AnimFlags.MOVING ? (TERRAIN_SPEED_DELAY[s.overTerrain] ?? 5) : STATIONARY_COMPUTED_DELAY;
  const breathDeficit = Math.min(50 - Math.trunc(s.breath / 2), MAX_BREATH_DEFICIT);
  const agilityDeficit = 50 - Math.trunc(s.stats.agility / 4);
  const lifeDeficit = 50 - Math.trunc(s.life / 2);
  let delay = terrain + lifeDeficit + breathDeficit + agilityDeficit + additional;
  if (t.inCombat) delay = Math.trunc(delay / 2);
  else if (s.stealthMode) delay *= 2;
  return delay;
}

export function resetFrameTimer(t: TacticalState, s: Soldier): void {
  s.nextFrameAt = t.clockMs + s.aniDelay;
}

export function setSoldierAniSpeed(t: TacticalState, s: Soldier): void {
  if (t.inCombat && s.visible === -1) {
    s.aniDelay = 0;
    resetFrameTimer(t, s);
    return;
  }
  s.aniDelay = t.content.animations.controls[s.state]?.speed ?? 0;
  if (s.aniDelay === 0) s.aniDelay = computedAnimationDelay(t, s);
  resetFrameTimer(t, s);
}

export function frameTimerDone(t: TacticalState, s: Soldier): boolean {
  if (s.aniDelay === PAUSE_ALL_UPDATES_DELAY) return false;
  if (t.clockMs < s.nextFrameAt) return false;
  if (s.aniDelay !== 0) s.nextFrameAt = t.clockMs + s.aniDelay;
  return true;
}

export function adjustNoAPToFinishMove(s: Soldier, set: boolean): void {
  s.noAPToFinishMove = set;
}

export function setSoldierDirection(t: TacticalState, s: Soldier, direction: number): void {
  s.direction = direction;
  if (hasAnimFlag(t.content, s.state, AnimFlags.FASTTURN) && s.team === Team.OUR) {
    if (s.direction !== s.desiredDirection) s.aniDelay = FAST_TURN_DELAY;
    else setSoldierAniSpeed(t, s);
  }
}

export function setDesiredDirection(t: TacticalState, s: Soldier, direction: number, animState = s.state): void {
  s.desiredDirection = s.reverse ? (direction + 4) % DIRECTION_COUNT : direction;
  if (s.noAPToFinishMove && hasAnimFlag(t.content, animState, AnimFlags.MOVING)) adjustNoAPToFinishMove(s, false);
  s.turnIncrement = quickestTurnIncrement(s.direction, s.desiredDirection);
}

export function changeSoldierState(t: TacticalState, s: Soldier, state: number, startCode = 0, force = false): void {
  initNewSoldierAnim(t, s, state, startCode, force);
}

export function soldierGotoStationaryStance(t: TacticalState, s: Soldier): void {
  const st = states(t.content.animations);
  switch (endHeight(t.content, s.state)) {
    case AnimHeight.STAND:
      initNewSoldierAnim(t, s, st.STANDING, 0, false);
      return;
    case AnimHeight.CROUCH:
      initNewSoldierAnim(t, s, st.CROUCHING, 0, false);
      return;
    case AnimHeight.PRONE:
      initNewSoldierAnim(t, s, st.PRONE, 0, false);
  }
}

function stanceChangeState(t: TacticalState, s: Soldier, desired: number): number {
  const st = states(t.content.animations);
  const delta = desired - endHeight(t.content, s.state);
  switch (delta) {
    case AnimHeight.STAND - AnimHeight.CROUCH:
      return st.KNEEL_UP;
    case AnimHeight.CROUCH - AnimHeight.STAND:
      return st.KNEEL_DOWN;
    case AnimHeight.STAND - AnimHeight.PRONE:
    case AnimHeight.CROUCH - AnimHeight.PRONE:
      return st.PRONE_UP;
    case AnimHeight.PRONE - AnimHeight.STAND:
      return st.KNEEL_DOWN;
    case AnimHeight.PRONE - AnimHeight.CROUCH:
      return st.PRONE_DOWN;
    default:
      return s.state;
  }
}

export function changeSoldierStance(t: TacticalState, s: Soldier, desired: number): void {
  if (desired === endHeight(t.content, s.state)) return;
  s.desiredHeight = desired;
  initNewSoldierAnim(t, s, stanceChangeState(t, s, desired), 0, false);
}

export function initNewSoldierAnim(t: TacticalState, s: Soldier, requested: number, startCode: number, force: boolean): void {
  const content = t.content;
  const st = states(content.animations);
  let next = requested;
  if (s.inNonInterruptibleAnimation) return;
  if (s.rtNonInterruptible) {
    if (!t.inCombat) return;
    s.rtNonInterruptible = false;
  }
  const tryingToRestart = next === s.state && hasAnimFlag(content, s.state, AnimFlags.NORESTART) && !force;

  if (
    startCode === 0 &&
    height(content, next) !== endHeight(content, s.state) &&
    !hasAnimFlag(content, next, AnimFlags.STANCECHANGEANIM | Flag.IGNORE_AUTOSTANCE)
  ) {
    const fromEnd = endHeight(content, s.state);
    const toEnd = endHeight(content, next);
    const movingNow = hasAnimFlag(content, s.state, AnimFlags.MOVING);
    if (toEnd === AnimHeight.PRONE && fromEnd === AnimHeight.CROUCH && !t.inCombat) {
      s.turningUntilDone = true;
      s.pendingStanceChange = toEnd;
      s.pendingAnimation = next;
      return;
    }
    if (
      !((toEnd === AnimHeight.CROUCH && fromEnd === AnimHeight.STAND) || (toEnd === AnimHeight.STAND && fromEnd === AnimHeight.CROUCH)) ||
      !movingNow ||
      t.inCombat
    ) {
      s.pendingAnimation = next;
      changeSoldierStance(t, s, height(content, next));
      return;
    }
    s.desiredHeight = toEnd;
  }

  if (s.state !== st.START_SWAT && next === st.SWATTING) next = st.START_SWAT;
  if (s.state === st.SWATTING && next === st.CROUCHING) next = st.END_SWAT;
  if (s.state === st.WALKING && next === st.STANDING && s.life < INJURED_CHANGE_THRESHOLD && s.bodyType <= REGFEMALE)
    next = st.END_HURT_WALKING;
  if (next === st.RUNNING && (s.overTerrain === 8 || s.overTerrain === 9)) next = st.WALKING;

  s.pauseAnimMove = false;
  adjustNoAPToFinishMove(s, false);

  const nextMoving = hasAnimFlag(content, next, AnimFlags.MOVING);
  if ((nextMoving && !hasAnimFlag(content, s.state, AnimFlags.MOVING)) || (nextMoving && force)) {
    if (!s.dontUpdateNewGridNoOnMoveAnimChange && next !== st.SWATTING) {
      if (!hasAnimFlag(content, next, AnimFlags.SPECIALMOVE)) {
        const result = handleGotoNewGridNo(t, s, true, next);
        if (!result.ok || !result.keepMoving) return;
      }
    }
  }
  if (nextMoving && s.dontUpdateNewGridNoOnMoveAnimChange !== LOCKED_NO_NEWGRIDNO) s.dontUpdateNewGridNoOnMoveAnimChange = 0;
  if (tryingToRestart) return;

  if (hasAnimFlag(content, next, Flag.NONINTERRUPT)) s.inNonInterruptibleAnimation = true;
  if (hasAnimFlag(content, next, Flag.RT_NONINTERRUPT)) s.rtNonInterruptible = true;
  if (hasAnimFlag(content, next, AnimFlags.SPECIALMOVE)) adjustNoAPToFinishMove(s, false);
  if (!nextMoving) s.reverse = false;

  if (next === st.STANDING) s.desiredHeight = AnimHeight.STAND;
  else if (next === st.CROUCHING) s.desiredHeight = AnimHeight.CROUCH;
  else if (next === st.PRONE) s.desiredHeight = AnimHeight.PRONE;
  else if (next === st.WALKING || next === st.SWATTING || next === st.RUNNING || next === st.CRAWLING)
    s.pendingAnimation = NO_PENDING_ANIMATION;
  else if (next === st.HOPFENCE) deductBreath(s, 200);

  s.state = next;
  s.pc = startCode;
  s.frame = 0;
  setSoldierAniSpeed(t, s);
  resetFrameTimer(t, s);
  adjustToNextAnimationFrame(t, s);
}

function handleEndOfAnimation(t: TacticalState, s: Soldier): void {
  const content = t.content;
  const st = states(content.animations);
  const currentEnd = endHeight(content, s.state);
  if (s.desiredHeight === currentEnd || s.desiredHeight === NO_DESIRED_HEIGHT) {
    s.desiredHeight = NO_DESIRED_HEIGHT;
    if (hasAnimFlag(content, s.state, AnimFlags.STANCECHANGEANIM)) {
      t.hooks.newAiSituation(t, s);
      t.hooks.stanceChanged(t, s);
    }
    if (continueAfterDoor(t, s)) return;
    if (s.pendingAnimation !== NO_PENDING_ANIMATION) {
      const pending = s.pendingAnimation;
      s.pendingAnimation = NO_PENDING_ANIMATION;
      changeSoldierState(t, s, pending);
      return;
    }
    if (s.continueMoveAfterStanceChange) {
      if (s.continueMoveAfterStanceChange === 2) {
        s.pathIndex = Math.min(s.pathIndex + 1, s.pathSize);
        if (s.pathIndex !== s.pathSize) initNewSoldierAnim(t, s, s.uiMovementMode, 0, false);
      } else {
        initNewSoldierAnim(t, s, s.uiMovementMode, 0, false);
      }
      s.continueMoveAfterStanceChange = 0;
      return;
    }
    soldierGotoStationaryStance(t, s);
    return;
  }
  let next: number | null = null;
  if (s.desiredHeight === AnimHeight.STAND && currentEnd === AnimHeight.CROUCH) next = st.KNEEL_UP;
  else if (s.desiredHeight === AnimHeight.CROUCH && currentEnd === AnimHeight.STAND) next = st.KNEEL_DOWN;
  else if (s.desiredHeight === AnimHeight.PRONE && currentEnd === AnimHeight.CROUCH) next = st.PRONE_DOWN;
  else if (s.desiredHeight === AnimHeight.CROUCH && currentEnd === AnimHeight.PRONE) next = st.PRONE_UP;
  if (next === null) soldierGotoStationaryStance(t, s);
  else changeSoldierState(t, s, next);
}

function hopFenceStep(t: TacticalState, s: Soldier, southEast: readonly number[], northWest: readonly number[]): void {
  if (s.direction === 4 || s.direction === 2) moveMercFacingDirection(t, s, southEast[s.bodyType] ?? 0);
  else if (s.direction === 0 || s.direction === 6) moveMercFacingDirection(t, s, northWest[s.bodyType] ?? 0);
}

const END_OPEN_DOOR_STATES = ['END_OPEN_DOOR', 'END_OPEN_DOOR_CROUCHED'];

function continueAfterDoor(t: TacticalState, s: Soldier): boolean {
  const name = t.content.animations.controls[s.state]?.id ?? '';
  if (!END_OPEN_DOOR_STATES.includes(name) || s.endDoorOpenCode !== 1) return false;
  s.endDoorOpenCode = 2;
  getNewSoldierPath(t, s, s.finalDestination, s.uiMovementMode);
  if (!hasAnimFlag(t.content, s.state, AnimFlags.MOVING) && s.absoluteFinalDestination !== -1) t.hooks.newAiSituation(t, s);
  return true;
}

function endHopFence(t: TacticalState, s: Soldier): OpOutcome {
  setSoldierPosition(t, s, s.forecastGridNo, { keepDestination: true, keepFinalDestination: true });
  setSoldierDirection(t, s, (s.direction + 2) % DIRECTION_COUNT);
  setDesiredDirection(t, s, s.direction);
  if (s.gridNo !== s.finalDestination) return 'continue';
  const movementEnd = endHeight(t.content, s.uiMovementMode);
  if (endHeight(t.content, s.state) !== movementEnd) changeSoldierStance(t, s, movementEnd);
  else soldierGotoStationaryStance(t, s);
  return 'stop';
}

export function adjustToNextAnimationFrame(t: TacticalState, s: Soldier): void {
  let endOfAnimation = false;
  const startState = s.state;
  const onOp = (code: number): OpOutcome => {
    switch (code) {
      case OP_PAUSE_ONE_FRAME:
        s.pausedMove = true;
        return 'continue';
      case OP_NONINT_DONE:
        s.inNonInterruptibleAnimation = false;
        return 'continue';
      case OP_HOP_FENCE_STEP:
        hopFenceStep(t, s, HOP_FENCE_FORWARD_SE, HOP_FENCE_FORWARD_NW);
        return 'continue';
      case OP_HOP_FENCE_FULL_STEP:
        hopFenceStep(t, s, HOP_FENCE_FORWARD_FULL_SE, HOP_FENCE_FORWARD_FULL_NW);
        return 'continue';
      case OP_OPEN_STRUCT:
      case OP_OPEN_DOOR:
        if (handlePendingDoor(t, s)) t.hooks.newAiSituation(t, s);
        return 'continue';
      case OP_END_HOP_FENCE:
        return endHopFence(t, s);
      case OP_PAUSE_ANIMOVE_ON:
        s.pauseAnimMove = true;
        return 'continue';
      case OP_BEGIN_HOP_FENCE:
        s.forecastGridNo = newGridNo(newGridNo(s.gridNo, DIRECTION_INCREMENT[s.direction] ?? 0), DIRECTION_INCREMENT[s.direction] ?? 0);
        return 'continue';
      case OP_PAUSE_ANIMOVE_OFF:
        s.pauseAnimMove = false;
        return 'continue';
      case OP_RT_NONINT_DONE:
        s.rtNonInterruptible = false;
        return 'continue';
      case OP_END_OF_ANIMATION:
        endOfAnimation = true;
        return 'stop';
      default:
        return 'continue';
    }
  };
  const step = stepToNextFrame(t.content.scripts, s.state, s.pc, (code, pc) => {
    s.pc = pc;
    return onOp(code);
  });
  if (step.kind === 'frame') {
    if (s.state === startState) {
      s.frame = step.frame;
      s.pc = step.nextPc;
    }
    return;
  }
  if (step.kind === 'state') {
    changeSoldierState(t, s, step.state);
    return;
  }
  if (endOfAnimation && s.state === startState) handleEndOfAnimation(t, s);
}

export function beginSoldierClimbFence(t: TacticalState, s: Soldier): void {
  if (isJumpableFenceAt(t, s.gridNo)) return;
  let best = -1;
  let bestTurns = 100;
  for (let d = 0; d < DIRECTION_COUNT; d += 2) {
    const fence = newGridNo(s.gridNo, DIRECTION_INCREMENT[d] ?? 0);
    const beyond = newGridNo(fence, DIRECTION_INCREMENT[d] ?? 0);
    if (!newOKDestination(t.pathEnv, s, beyond, true, 0)) continue;
    if (!isJumpableFenceAt(t, fence)) continue;
    const steps = Math.abs(d - s.direction);
    const turns = steps <= 4 ? steps : 8 - steps;
    if (turns < bestTurns) {
      bestTurns = turns;
      best = d;
    }
  }
  if (best < 0) return;
  s.reverse = false;
  setDesiredDirection(t, s, best);
  s.turningUntilDone = true;
  s.pendingAnimation = states(t.content.animations).HOPFENCE;
}

export function turnSoldier(t: TacticalState, s: Soldier): void {
  const content = t.content;
  if (s.lookOnNextTurn) {
    if (hasAnimFlag(content, s.state, AnimFlags.STATIONARY)) t.hooks.look(t, s);
    s.lookOnNextTurn = false;
    t.hooks.newAiSituation(t, s);
  }
  if (s.turningUntilDone && s.pendingStanceChange !== NO_DESIRED_HEIGHT && s.direction === s.desiredDirection) {
    changeSoldierStance(t, s, s.pendingStanceChange);
    s.pendingStanceChange = NO_DESIRED_HEIGHT;
    s.turningUntilDone = false;
  }
  if (s.turningUntilDone && s.pendingAnimation !== NO_PENDING_ANIMATION && s.direction === s.desiredDirection) {
    const pending = s.pendingAnimation;
    s.pendingAnimation = NO_PENDING_ANIMATION;
    initNewSoldierAnim(t, s, pending, 0, false);
    s.turningUntilDone = false;
  }
  if (s.direction === s.desiredDirection) {
    s.lookOnNextTurn = false;
    t.hooks.turnFinished(t, s);
    return;
  }
  if (s.noAPToFinishMove) adjustNoAPToFinishMove(s, false);
  let direction = s.direction + s.turnIncrement;
  if (direction > 7) direction = 0;
  else if (direction < 0) direction = 7;
  if (hasAnimFlag(content, s.state, AnimFlags.STATIONARY)) s.lookOnNextTurn = true;
  setSoldierDirection(t, s, direction);
}
