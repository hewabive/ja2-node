// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Turn_Based_Input.cc ToggleStealthMode, HandleStealthChangeFromUIKeys, the 'z' key with ALT (the
// @src squad), the 'x' key (exchange places with AP), HandleMoveModeInteractiveClick (the free exchange),
// @src HandleTBClimbWindow; Interface_Panels.cc BtnStealthModeCallback, BtnMuteCallback, BtnBurstModeCallback,
// @src BtnClimbCallback (the fence jump); Weapons.cc ChangeWeaponMode; Handle_UI.cc UIHandleJumpOver, UIHandleCMoveMerc
// @src (the all-move), HandleMultiSelectionMove; Soldier_Control.cc GetMoveStateBasedOnStance, BeginSoldierClimbWindow;
// @src Soldier_Tile.cc SwapMercPositions, CanExchangePlaces; Soldier_Add.cc CanSoldierReachGridNoInGivenTileLimit;
// @src Isometric_Utils.cc IsFacingClimableWindow; Structure_Wrap.cc IsJumpableWindowPresentAtGridNo;
// @src Points.cc GetAPsToJumpFence; Turn_Based_Input.cc SwitchHeadGear (CTRL+N: the squad's living non-vehicles in
// @src squad order, refused with the interface locked as the key is).

import { AnimFlags } from '../../content/anim/tables.ts';
import { Direction, isVisibleTile, newGridNo } from '../../content/world/grid.ts';
import { has, ORIENT_LEFT, ORIENT_RIGHT, StructureFlags } from '../../content/world/structures.ts';
import type { CommandResult } from '../command.ts';
import { anim } from './anim-states.ts';
import {
  AnimHeight,
  beginSoldierClimbFence,
  endHeight,
  findFenceJumpDirection,
  hasAnimFlag,
  setDesiredDirection,
  states,
  TurningFromProne,
} from './animation.ts';
import { findAdjacentGridEx } from './combat/melee-reach.ts';
import { WeaponMode } from './combat/types.ts';
import { DIRECTION_INCREMENT } from './directions.ts';
import { ensureConsistentWeaponMode, hasLauncher, isGunBurstCapable, nextWeaponMode } from './hand-item.ts';
import { type HeadGear, switchHeadGear } from './head-gear.ts';
import { playerInterfaceLocked } from './interface-lock.ts';
import { InvSlot } from './inventory.ts';
import { apsToJumpOver, jumpOverAt } from './jump-over.ts';
import { directionToward, getNewSoldierPath, setSoldierPosition } from './movement.ts';
import { teleportSoldier } from './narrative/quest-items.ts';
import { uncontrolledRobot } from './narrative/robot.ts';
import { findBestPath, newOKDestination, PathCopy, PathFlags } from './pathfinding.ts';
import { removePendingAction } from './pending-action.ts';
import { removeMercStructure } from './person-structure.ts';
import { AP, apsToChangeStance, BP, deductPoints, enoughPoints } from './points.ts';
import { canExchangePlaces, validQuickExchangePosition } from './quick-exchange.ts';
import { type Refusal, refuse, refused } from './refusal.ts';
import { Body, OKLIFE, Side, type Soldier, Team } from './soldier.ts';
import { removeOccupant, type TacticalState } from './state.ts';
import { selectSoldier } from './turns/turns.ts';

export interface OrderCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface OrderContext {
  readonly t: TacticalState;
  soldier(id: unknown): Soldier | null;
  actRefusal(s: Soldier): Refusal | null;
}

export const PLAYER_ORDERS: ReadonlySet<string> = new Set([
  'stealth',
  'mute',
  'weaponMode',
  'swapPlaces',
  'jump',
  'climbWindow',
  'moveGroup',
  'switchHeadGear',
]);

const NO_SUCH_SOLDIER: Refusal = { token: 'noSuchSoldier', reason: 'no such soldier of yours' };
const WEAPON_MODE_NAMES: Readonly<Record<string, number>> = {
  single: WeaponMode.NORMAL,
  burst: WeaponMode.BURST,
  launcher: WeaponMode.ATTACHED,
};
const WEAPON_MODE_VIEW: Readonly<Record<number, string>> = {
  [WeaponMode.NORMAL]: 'single',
  [WeaponMode.BURST]: 'burst',
  [WeaponMode.ATTACHED]: 'launcher',
};
const HEAD_GEARS: ReadonlySet<string> = new Set<HeadGear>(['day', 'night']);
const EXCHANGE_TILE_LIMIT = 1;
const JUMP_OVER_STATE = 'JUMP_OVER_BLOCKING_PERSON';

const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;
const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

function ownSoldier(ctx: OrderContext, id: unknown): Soldier | null {
  const s = ctx.soldier(id);
  return s?.placed && s.team === Team.OUR ? s : null;
}

function actingSoldier(ctx: OrderContext, id: unknown): Soldier | Refusal {
  const s = ownSoldier(ctx, id);
  if (!s) return NO_SUCH_SOLDIER;
  return ctx.actRefusal(s) ?? s;
}

const isRefusal = <T extends object>(v: T | Refusal): v is Refusal => 'token' in v && 'reason' in v;

function soldierList(ctx: OrderContext, ids: unknown): Soldier[] | Refusal {
  if (!Array.isArray(ids) || ids.length === 0) return { token: 'badSoldiers', reason: 'soldiers must be a non-empty list of ids' };
  const list: Soldier[] = [];
  for (const id of ids) {
    const s = actingSoldier(ctx, id);
    if (isRefusal(s)) return s;
    if (!list.includes(s)) list.push(s);
  }
  return list;
}

function stealth(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  const list = soldierList(ctx, cmd.soldiers);
  if (isRefusal(list)) return refused(list);
  if (cmd.on !== undefined && typeof cmd.on !== 'boolean') return refuse('badValue', 'on must be true or false');
  const changed: number[] = [];
  for (const s of list) {
    if (isRobot(s)) continue;
    s.stealthMode = typeof cmd.on === 'boolean' ? cmd.on : !s.stealthMode;
    changed.push(s.id);
    if (cmd.squad !== true) ctx.t.events.push({ type: 'stealthChanged', soldier: s.id, on: s.stealthMode });
  }
  if (cmd.squad === true) ctx.t.events.push({ type: 'squadStealthChanged', soldiers: changed, on: cmd.on !== false });
  return { ok: true, data: { soldiers: changed } };
}

function squadForHeadGear(ctx: OrderContext, ids: unknown): Soldier[] | Refusal {
  if (!Array.isArray(ids) || ids.length === 0) return { token: 'badSoldiers', reason: 'soldiers must be a non-empty list of ids' };
  const list: Soldier[] = [];
  for (const id of ids) {
    const s = ownSoldier(ctx, id);
    if (!s) return NO_SUCH_SOLDIER;
    if (!list.includes(s) && s.life > 0 && !isVehicle(s)) list.push(s);
  }
  return list;
}

function headGear(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  if (typeof cmd.gear !== 'string' || !HEAD_GEARS.has(cmd.gear)) return refuse('badGear', 'gear must be day or night');
  if (playerInterfaceLocked(ctx.t)) return refuse('uiLocked', 'the interface is locked');
  const list = squadForHeadGear(ctx, cmd.soldiers);
  if (isRefusal(list)) return refused(list);
  for (const s of list) switchHeadGear(ctx.t, s, cmd.gear as HeadGear);
  return { ok: true, data: { soldiers: list.map((s) => s.id) } };
}

function mute(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  const s = ownSoldier(ctx, cmd.soldier);
  if (!s) return refused(NO_SUCH_SOLDIER);
  if (cmd.on !== undefined && typeof cmd.on !== 'boolean') return refuse('badValue', 'on must be true or false');
  s.muted = typeof cmd.on === 'boolean' ? cmd.on : !s.muted;
  ctx.t.events.push({ type: 'muteChanged', soldier: s.id, on: s.muted });
  return { ok: true, data: { muted: s.muted } };
}

function requestedWeaponMode(ctx: OrderContext, s: Soldier, mode: unknown): number | Refusal {
  const items = ctx.t.content.items;
  if (mode === undefined)
    return nextWeaponMode(items, s) ?? { token: 'noBurst', reason: 'the weapon in hand has no burst and no launcher' };
  const wanted = typeof mode === 'string' ? WEAPON_MODE_NAMES[mode] : undefined;
  if (wanted === undefined) return { token: 'badMode', reason: 'mode must be single, burst or launcher' };
  if (wanted === WeaponMode.BURST && !isGunBurstCapable(items, s, InvSlot.HAND))
    return { token: 'noBurst', reason: 'the weapon in hand cannot fire bursts' };
  if (wanted === WeaponMode.ATTACHED && !hasLauncher(items, s))
    return { token: 'noLauncher', reason: 'the weapon in hand has no loaded under-barrel launcher' };
  return wanted;
}

function weaponMode(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  const s = actingSoldier(ctx, cmd.soldier);
  if (isRefusal(s)) return refused(s);
  if (hasAnimFlag(ctx.t.content, s.state, AnimFlags.FIRE)) return refuse('firing', 'the soldier is firing');
  const mode = requestedWeaponMode(ctx, s, cmd.mode);
  if (typeof mode !== 'number') return refused(mode);
  s.weaponMode = mode;
  ensureConsistentWeaponMode(ctx.t.content.items, s);
  return { ok: true, data: { weaponMode: WEAPON_MODE_VIEW[s.weaponMode] } };
}

function canReachInOneTile(t: TacticalState, s: Soldier, g: number, level: number): boolean {
  if (s.level !== level) return false;
  const adjacent = findAdjacentGridEx(t, s, g, false)?.actionGridNo ?? g;
  if (adjacent === s.gridNo) return true;
  const route = findBestPath(t.pathEnv, s, adjacent, s.level, { copy: PathCopy.NONE, flags: PathFlags.IGNORE_PERSON_AT_DEST });
  return route.length !== 0 && route.length <= EXCHANGE_TILE_LIMIT;
}

function hostileToOurTeam(s: Soldier): boolean {
  return !s.neutral && s.side !== Side.FRIENDLY;
}

function liftOffGrid(t: TacticalState, s: Soldier): void {
  removeOccupant(t, s);
  removeMercStructure(t, s);
  s.placed = false;
}

export function swapMercPositions(t: TacticalState, a: Soldier, b: Soldier): void {
  let ga = a.gridNo;
  let gb = b.gridNo;
  liftOffGrid(t, a);
  liftOffGrid(t, b);
  const canSwap = newOKDestination(t.pathEnv, a, gb, true, 0) && newOKDestination(t.pathEnv, b, ga, true, 0);
  if (canSwap) [ga, gb] = [gb, ga];
  setSoldierPosition(t, b, gb);
  teleportSoldier(t, a, ga, !canSwap);
  teleportSoldier(t, b, gb, !canSwap);
}

function swapPlaces(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  const t = ctx.t;
  const s = actingSoldier(ctx, cmd.soldier);
  if (isRefusal(s)) return refused(s);
  const other = ctx.soldier(cmd.with);
  if (!other?.placed || other === s) return refuse('noSuchTarget', 'with must be another soldier in the sector');
  const level = cmd.level === 1 ? 1 : cmd.level === 0 ? 0 : s.level;
  if (cmd.cursor === true) {
    if (!validQuickExchangePosition(t, s, other)) return refuse('invalidExchange', 'not an adjacent neutral or friendly soldier in sight');
    if (!canExchangePlaces(t, s, other)) return refuse('cannotExchange', 'the soldiers cannot exchange places');
    selectSoldier(t, s);
    swapMercPositions(t, s, other);
    t.events.push({ type: 'placesSwapped', soldier: s.id, with: other.id, gridNo: s.gridNo });
    return { ok: true };
  }
  if (s.life < OKLIFE || other.life < OKLIFE) return refuse('cannotExchange', 'both soldiers must be conscious');
  if (!canReachInOneTile(t, s, other.gridNo, level)) return refuse('notAdjacent', 'the soldier must stand next to the other');
  if (hostileToOurTeam(other)) return refuse('hostileTarget', 'cannot exchange places with an enemy');
  if (!canExchangePlaces(t, s, other)) return refuse('cannotExchange', 'the soldiers cannot exchange places');
  selectSoldier(t, s);
  swapMercPositions(t, s, other);
  deductPoints(t.inCombat, s, AP.EXCHANGE_PLACES, 0);
  deductPoints(t.inCombat, other, AP.EXCHANGE_PLACES, 0);
  t.events.push({ type: 'placesSwapped', soldier: s.id, with: other.id, gridNo: s.gridNo });
  return { ok: true };
}

function mustBeStationary(t: TacticalState, s: Soldier): CommandResult | null {
  return hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY) ? null : refuse('mustStopFirst', 'stop the soldier first');
}

function jumpOverPerson(ctx: OrderContext, s: Soldier, to: unknown, level: number): CommandResult {
  const t = ctx.t;
  if (typeof to !== 'number' || !Number.isInteger(to) || !isVisibleTile(to)) return refuse('badDestination', 'to must be a visible gridNo');
  if (!jumpOverAt(t, s, to, level)) return refuse('invalidJump', 'no prone soldier to jump over between the soldier and that tile');
  if (!enoughPoints(t.inCombat, s, apsToJumpOver(t, s))) return refuse('notEnoughAP', `not enough APs: ${apsToJumpOver(t, s)} needed`);
  selectSoldier(t, s);
  removePendingAction(t, s);
  s.dontChargeTurningAPs = true;
  setDesiredDirection(t, s, directionToward(s.gridNo, to));
  s.turningUntilDone = true;
  s.pendingAnimation = anim(t.content, JUMP_OVER_STATE);
  return { ok: true, data: { to } };
}

export function apsToJumpFence(t: TacticalState, s: Soldier): number {
  return apsToChangeStance(t.content, s, AnimHeight.STAND) + AP.JUMPFENCE;
}

function jumpFence(ctx: OrderContext, s: Soldier): CommandResult {
  const t = ctx.t;
  const direction = findFenceJumpDirection(t, s);
  if (direction < 0) return refuse('noFence', 'no fence to jump next to the soldier');
  if (!enoughPoints(t.inCombat, s, apsToJumpFence(t, s))) return refuse('notEnoughAP', `not enough APs: ${apsToJumpFence(t, s)} needed`);
  selectSoldier(t, s);
  s.dontChargeTurningAPs = true;
  s.turningFromPronePosition = TurningFromProne.OFF;
  beginSoldierClimbFence(t, s);
  return { ok: true, data: { direction } };
}

function jump(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  const s = actingSoldier(ctx, cmd.soldier);
  if (isRefusal(s)) return refused(s);
  const stopped = mustBeStationary(ctx.t, s);
  if (stopped) return stopped;
  if (isRobot(s)) return refuse('cannotAct', 'the robot cannot jump');
  const level = cmd.level === 1 ? 1 : cmd.level === 0 ? 0 : s.level;
  return cmd.to === undefined ? jumpFence(ctx, s) : jumpOverPerson(ctx, s, cmd.to, level);
}

function jumpableWindowAt(t: TacticalState, g: number, direction: number): boolean {
  const window = t.world.structures.find(g, StructureFlags.WALLNWINDOW);
  if (!window) return false;
  if (!has(window.flags, StructureFlags.WALLNWINDOW) || has(window.flags, StructureFlags.SPECIAL)) return false;
  if ((direction === Direction.NORTH || direction === Direction.SOUTH) && !(window.wallOrientation & ORIENT_LEFT)) return false;
  if ((direction === Direction.EAST || direction === Direction.WEST) && !(window.wallOrientation & ORIENT_RIGHT)) return false;
  return has(window.flags, StructureFlags.OPEN);
}

export function facingClimbableWindow(t: TacticalState, s: Soldier): boolean {
  const direction = s.direction;
  const step = DIRECTION_INCREMENT[direction] ?? 0;
  let windowTile = s.gridNo;
  let otherSide = newGridNo(s.gridNo, step);
  if (direction === Direction.NORTH || direction === Direction.WEST) {
    if (jumpableWindowAt(t, s.gridNo, direction)) return false;
    windowTile = newGridNo(s.gridNo, step);
    otherSide = windowTile;
  }
  if (!newOKDestination(t.pathEnv, s, otherSide, true, 0)) return false;
  return jumpableWindowAt(t, windowTile, direction);
}

function climbWindow(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  const t = ctx.t;
  const s = actingSoldier(ctx, cmd.soldier);
  if (isRefusal(s)) return refused(s);
  if (isRobot(s)) return refuse('cannotAct', 'the robot cannot climb');
  if (!facingClimbableWindow(t, s)) return refuse('noWindow', 'the soldier does not face an open window');
  if (!enoughPoints(t.inCombat, s, apsToJumpFence(t, s))) return refuse('notEnoughAP', `not enough APs: ${apsToJumpFence(t, s)} needed`);
  selectSoldier(t, s);
  const to = newGridNo(s.gridNo, DIRECTION_INCREMENT[s.direction] ?? 0);
  s.tempNewGridNo = to;
  s.dontChargeTurningAPs = true;
  s.turningUntilDone = true;
  s.turningFromPronePosition = TurningFromProne.OFF;
  deductPoints(t.inCombat, s, AP.JUMPFENCE, BP.JUMPFENCE);
  teleportSoldier(t, s, to, true);
  return { ok: true, data: { to } };
}

function moveStateBasedOnStance(t: TacticalState, s: Soldier, fast: boolean): number {
  const st = states(t.content.animations);
  const stance = endHeight(t.content, s.state);
  if (stance === AnimHeight.PRONE) return st.CRAWLING;
  if (stance === AnimHeight.CROUCH) return st.SWATTING;
  return fast && !isVehicle(s) ? st.RUNNING : st.WALKING;
}

function groupMovementMode(t: TacticalState, s: Soldier, mode: unknown): number {
  if (mode === 'run') return states(t.content.animations).RUNNING;
  return moveStateBasedOnStance(t, s, mode === 'fast');
}

function moveGroup(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  const t = ctx.t;
  if (t.inCombat) return refuse('realTimeOnly', 'group moves are given in real time only');
  const to = cmd.to;
  if (typeof to !== 'number' || !Number.isInteger(to) || !isVisibleTile(to))
    return refuse('badDestination', 'destination must be a visible gridNo');
  if (cmd.mode !== undefined && cmd.mode !== 'run' && cmd.mode !== 'fast' && cmd.mode !== 'stance')
    return refuse('badMode', 'mode must be run, fast or stance');
  const list = soldierList(ctx, cmd.soldiers);
  if (isRefusal(list)) return refused(list);
  const moved: number[] = [];
  const noPath: number[] = [];
  for (const s of list) {
    if (isRobot(s) && uncontrolledRobot(t, s)) continue;
    s.uiMovementMode = groupMovementMode(t, s, cmd.mode);
    s.uiMovementFast = false;
    s.reverse = cmd.mode !== 'run' && cmd.reverse === true;
    s.pathStored = false;
    removePendingAction(t, s);
    if (getNewSoldierPath(t, s, to, s.uiMovementMode, 1, s.noAPToFinishMove, true)) moved.push(s.id);
    else {
      noPath.push(s.id);
      t.events.push({ type: 'noPathForMerc', soldier: s.id, to });
    }
  }
  return { ok: true, data: { moved, noPath } };
}

export function dispatchPlayerOrder(ctx: OrderContext, cmd: OrderCommand): CommandResult {
  switch (cmd.type) {
    case 'stealth':
      return stealth(ctx, cmd);
    case 'mute':
      return mute(ctx, cmd);
    case 'weaponMode':
      return weaponMode(ctx, cmd);
    case 'swapPlaces':
      return swapPlaces(ctx, cmd);
    case 'jump':
      return jump(ctx, cmd);
    case 'climbWindow':
      return climbWindow(ctx, cmd);
    case 'moveGroup':
      return moveGroup(ctx, cmd);
    case 'switchHeadGear':
      return headGear(ctx, cmd);
    default:
      return refuse('unknownCommand', `unknown command ${cmd.type}`);
  }
}
