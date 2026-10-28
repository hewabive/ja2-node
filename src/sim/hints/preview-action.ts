// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc DrawUIMovementPath (MOVEUI_TARGET_INTTILES for doors, ITEMS, MERCSFORAID; the
// @src AP sums), UIHandleTOnTerrain (talk range, line of sight, AP_TALK), IsValidJumpLocation, ValidQuickExchangePosition,
// @src the look cursor (GetAPsToLook when the direction differs); Points.cc GetAPsToGiveItem, GetAPsToJumpOver,
// @src GetAPsToBeginFirstAid; UI_Cursors.cc (the item cursors this port does not support yet).

import { NPC_TALK_RADIUS } from '../../content/narrative/npc-constants.ts';
import { isVisibleTile } from '../../content/world/grid.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { giveApRefusal, giverRefusal } from '../campaign/give-flow.ts';
import { preservingFields, withTemporaryFields } from '../knowledge/guard.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { isRobotSoldier } from '../narrative/talkable.ts';
import { AnimHeight } from '../tactical/animation.ts';
import { findAdjacentGridEx } from '../tactical/combat/melee-reach.ts';
import { closingDoorMenu, doorApCost, doorMenu } from '../tactical/doors/door-actions.ts';
import { findAdjacentGridExAdvanced } from '../tactical/doors/door-approach.ts';
import { findDoorInfo, PerceivedLock } from '../tactical/doors/door-table.ts';
import type { DoorMenuOption } from '../tactical/doors/events.ts';
import { apsToBeginFirstAid, firstAidMedicRefusal, firstAidNeedRefusal } from '../tactical/first-aid.ts';
import { apsToGiveItem } from '../tactical/give.ts';
import { adjustGridNoForItemPlacement, pickupCandidates } from '../tactical/item-actions.ts';
import { apsToJumpOver, jumpOverAt } from '../tactical/jump-over.ts';
import { directionToward } from '../tactical/movement.ts';
import { movementModeState } from '../tactical/movement-mode.ts';
import { talkLineOfSight, talkRange, talkWalkUp } from '../tactical/narrative/talk-reach.ts';
import type { Footstep } from '../tactical/plot-path.ts';
import { AP, apsToChangeStance, apsToLook, enoughPoints } from '../tactical/points.ts';
import { seenExchangeChecks, validQuickExchangePosition } from '../tactical/quick-exchange.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import { type TacticalState, whoIsThere } from '../tactical/state.ts';
import { type ActingSoldier, actingSoldier } from './soldier-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';
import { interfaceLevelOf, plotWalk } from './walk-plot.ts';

export const SUPPORTED_ACTIONS = ['door', 'pickUp', 'talk', 'give', 'jump', 'swap', 'look', 'aid'] as const;
export const UNSUPPORTED_ACTIONS = ['steal', 'cutFence', 'repair', 'refuel', 'jar', 'can', 'bomb', 'enterVehicle'] as const;

export type ActionKind = (typeof SUPPORTED_ACTIONS)[number];

export interface PreviewAction {
  readonly kind: ActionKind;
  readonly ok: boolean;
  readonly refusal?: string;
  readonly apCost: number;
  readonly affordable: boolean;
  readonly actionGridNo: number;
  readonly steps: readonly Footstep[];
  readonly direction?: number;
  readonly open?: boolean;
  readonly menu?: readonly DoorMenuOption[];
  readonly inRange?: boolean;
  readonly lineOfSight?: boolean;
}

export interface PreviewActionRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly gridNo?: unknown;
  readonly level?: unknown;
  readonly kind?: unknown;
  readonly target?: unknown;
  readonly mode?: unknown;
  readonly zLevel?: unknown;
}

interface ActionContext {
  readonly world: KnowledgeWorld;
  readonly t: TacticalState;
  readonly s: Soldier;
  readonly g: number;
  readonly level: number;
  readonly mode: number;
  readonly target: Soldier | null;
}

type ActionPart = Omit<PreviewAction, 'kind' | 'affordable'> & { readonly affordable?: boolean };

const NO_STEPS: readonly Footstep[] = [];
const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_ACTIONS);
const UNSUPPORTED: ReadonlySet<string> = new Set(UNSUPPORTED_ACTIONS);

function refused(c: ActionContext, refusal: string, actionGridNo = c.g): ActionPart {
  return { ok: false, refusal, apCost: 0, actionGridNo, steps: NO_STEPS };
}

function walkTo(c: ActionContext, to: number) {
  return to === c.s.gridNo ? { cost: 0, steps: NO_STEPS } : plotWalk(c.t, c.s, to, c.mode, c.level);
}

type Arrival = Pick<Soldier, 'desiredDirection' | 'doorHandleCode'>;

function menuOnArrival(c: ActionContext, base: number, arrival: Arrival, open: boolean, locked: boolean): DoorMenuOption[] | null {
  if (!open && !locked) return null;
  return withTemporaryFields(c.s, arrival, () => (open ? closingDoorMenu(c.t, c.s) : doorMenu(c.t, c.s, base)));
}

function doorAction(c: ActionContext): ActionPart {
  const { t, s } = c;
  const found = t.world.structures.find(c.g, StructureFlags.ANYDOOR);
  const door = found ? (t.world.structures.findBase(found) ?? found) : null;
  if (!door) return refused(c, 'noDoor');
  const base = door.gridNo;
  const { approach, handleCode } = preservingFields(s, ['doorHandleCode'], () => {
    const nearest = findAdjacentGridExAdvanced(t, s, door, base);
    return { approach: nearest, handleCode: s.doorHandleCode };
  });
  const handleCost = doorApCost(handleCode);
  const actionGridNo = approach?.gridNo ?? base;
  const walk = walkTo(c, actionGridNo);
  const open = has(door.flags, StructureFlags.OPEN);
  const locked = !open && findDoorInfo(t, base)?.perceivedLocked === PerceivedLock.LOCKED;
  const menu = approach ? menuOnArrival(c, base, { desiredDirection: approach.direction, doorHandleCode: handleCode }, open, locked) : null;
  return {
    ok: approach !== null,
    ...(approach ? {} : { refusal: 'noPath' }),
    apCost: handleCost + walk.cost + apsToChangeStance(t.content, s, AnimHeight.STAND),
    actionGridNo,
    steps: walk.steps,
    open,
    ...(menu ? { menu } : {}),
  };
}

function pickUpAction(c: ActionContext, zLevel: number): ActionPart {
  const { t, s } = c;
  if (pickupCandidates(t, s, c.g, zLevel).length === 0) return refused(c, 'nothingThere');
  const actionGridNo = adjustGridNoForItemPlacement(t, s, c.g);
  if (actionGridNo === s.gridNo) return { ok: true, apCost: AP.PICKUP_ITEM, actionGridNo, steps: NO_STEPS };
  const walk = walkTo(c, actionGridNo);
  const reachable = walk.cost !== 0;
  return {
    ok: reachable,
    ...(reachable ? {} : { refusal: 'noPath' }),
    apCost: walk.cost + (reachable ? AP.PICKUP_ITEM : 0),
    actionGridNo,
    steps: walk.steps,
  };
}

function talkAction(c: ActionContext): ActionPart {
  const { t, s, target } = c;
  if (!target) return refused(c, 'noSuchTarget');
  if (isRobotSoldier(s)) return refused(c, 'talkerIsRobot');
  const own = target.team === Team.OUR;
  if (!own && !c.world.tactical?.soldierView(target.id)?.talkable) return refused(c, 'notTalkable');
  const lineOfSight = target === s || talkLineOfSight(t, s, target);
  if (!lineOfSight) return { ...refused(c, 'noLineOfSight', s.gridNo), lineOfSight };
  const epc = c.world.tactical?.soldierView(target.id)?.kind === 'epc';
  if (own && !epc) return { ok: true, apCost: 0, actionGridNo: s.gridNo, steps: NO_STEPS, inRange: true, lineOfSight, affordable: true };
  const inRange = talkRange(s.gridNo, target.gridNo) <= NPC_TALK_RADIUS;
  if (inRange) return { ok: true, apCost: AP.TALK, actionGridNo: s.gridNo, steps: NO_STEPS, inRange, lineOfSight };
  const walkUp = talkWalkUp(t, s, target);
  if (!walkUp) return { ...refused(c, 'noPath', s.gridNo), inRange, lineOfSight };
  return { ok: true, apCost: AP.TALK, actionGridNo: walkUp.to, steps: walkTo(c, walkUp.to).steps, inRange, lineOfSight };
}

function giveAction(c: ActionContext): ActionPart {
  const { t, s, target } = c;
  if (!target || target === s) return refused(c, 'noSuchTarget');
  const isEpc = c.world.tactical?.soldierView(s.id)?.kind === 'epc';
  const giver = giverRefusal(t, s, isEpc);
  if (giver) return refused(c, giver, s.gridNo);
  const label = c.world.tactical?.soldierView(target.id)?.talkable;
  if (target.team !== Team.OUR && label !== 'npc' && label !== 'epc') return refused(c, 'notTalkable');
  if (isRobotSoldier(target)) return refused(c, 'robotReload');
  const adjacent = findAdjacentGridEx(t, s, target.gridNo, false)?.actionGridNo ?? null;
  const shown = apsToGiveItem(t, s, adjacent ?? target.gridNo);
  const ap = giveApRefusal(t, s, target, adjacent);
  const approach = findAdjacentGridEx(t, s, target.gridNo, true);
  const actionGridNo = approach?.actionGridNo ?? target.gridNo;
  const refusal = ap === 'noPath' || !approach ? 'noPath' : null;
  return {
    ok: refusal === null,
    ...(refusal ? { refusal } : {}),
    apCost: shown,
    actionGridNo,
    steps: walkTo(c, actionGridNo).steps,
    affordable: ap === null,
  };
}

function jumpAction(c: ActionContext): ActionPart {
  const jump = jumpOverAt(c.t, c.s, c.g, c.level);
  if (!jump) return refused(c, 'invalidJump');
  return { ok: true, apCost: apsToJumpOver(c.t, c.s), actionGridNo: c.g, steps: NO_STEPS, direction: jump.direction };
}

function swapAction(c: ActionContext): ActionPart {
  const { t, s, target } = c;
  if (!target || target === s) return refused(c, 'noSuchTarget');
  if (!validQuickExchangePosition(t, s, target)) return refused(c, 'invalidExchange');
  if (!seenExchangeChecks(t, s, target)) return refused(c, 'cannotExchange');
  return { ok: true, apCost: AP.EXCHANGE_PLACES, actionGridNo: target.gridNo, steps: NO_STEPS };
}

function lookAction(c: ActionContext): ActionPart {
  const direction = directionToward(c.s.gridNo, c.g);
  if (direction === c.s.direction) return { ...refused(c, 'alreadyFacing', c.s.gridNo), direction };
  return { ok: true, apCost: apsToLook(c.t.content, c.s), actionGridNo: c.s.gridNo, steps: NO_STEPS, direction };
}

function aidAction(c: ActionContext): ActionPart {
  const { t, s, target } = c;
  const refusal = firstAidMedicRefusal(t, s, target) ?? (target && target.team === Team.OUR ? firstAidNeedRefusal(target) : null);
  if (refusal || !target) return refused(c, refusal ?? 'noTarget');
  const approach = findAdjacentGridEx(t, s, target.gridNo, true);
  if (!approach) return refused(c, 'cannotGetThere');
  const walk = walkTo(c, approach.actionGridNo);
  const reachable = approach.actionGridNo === s.gridNo || walk.cost !== 0;
  return {
    ok: reachable,
    ...(reachable ? {} : { refusal: 'cannotGetThere' }),
    apCost: apsToBeginFirstAid(t, s) + walk.cost,
    actionGridNo: approach.actionGridNo,
    steps: walk.steps,
  };
}

function preview(c: ActionContext, kind: ActionKind, zLevel: number): ActionPart {
  switch (kind) {
    case 'door':
      return doorAction(c);
    case 'pickUp':
      return pickUpAction(c, zLevel);
    case 'talk':
      return talkAction(c);
    case 'give':
      return giveAction(c);
    case 'jump':
      return jumpAction(c);
    case 'swap':
      return swapAction(c);
    case 'look':
      return lookAction(c);
    case 'aid':
      return aidAction(c);
  }
}

function targetOf(world: KnowledgeWorld, t: TacticalState, req: PreviewActionRequest, g: number, level: number): Soldier | null {
  if (typeof req.target === 'number') return world.tactical?.soldier(req.target) ?? null;
  return whoIsThere(t, g, level);
}

function complete(acting: ActingSoldier, kind: ActionKind, part: ActionPart): PreviewAction {
  const { state: t, soldier: s } = acting;
  const affordable = part.affordable ?? enoughPoints(t.inCombat, s, part.apCost);
  const refusal = part.refusal ?? acting.blocked ?? undefined;
  return { kind, ...part, affordable, ok: part.ok && refusal === undefined, ...(refusal ? { refusal } : {}) };
}

export function previewAction(world: KnowledgeWorld, req: PreviewActionRequest): HintResult<PreviewAction> {
  const kind = req.kind;
  if (typeof kind === 'string' && UNSUPPORTED.has(kind)) return refuseHint('notSupported', `${kind} has no command yet`);
  if (typeof kind !== 'string' || !SUPPORTED.has(kind)) return refuseHint('badKind', `kind must be one of ${SUPPORTED_ACTIONS.join(', ')}`);
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return acting.refusal;
  const g = req.gridNo;
  if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return refuseHint('badGridNo', 'gridNo must be a visible tile');
  const { state: t, soldier: s } = acting;
  const level = interfaceLevelOf(s, req.level);
  const mode = movementModeState(t, s, req.mode);
  const zLevel = req.zLevel === 1 ? 1 : 0;
  return withTemporaryFields(s, { uiMovementMode: mode, reverse: false }, () => {
    const c: ActionContext = { world, t, s, g, level, mode, target: targetOf(world, t, req, g, level) };
    return hintData(complete(acting, kind as ActionKind, preview(c, kind as ActionKind, zLevel)));
  });
}
