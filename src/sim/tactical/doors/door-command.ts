// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc UIHandleMOVE (interactive tiles); Overhead.cc pending MERC_OPENDOOR/MERC_OPENSTRUCT on arrival;
// @src Interface.cc PopupDoorOpenMenu, DoorAction, BtnDoorMenuCallback. See docs/25 §8.2, §13.1.

import { ANYKEY } from '../../../content/formats/locks.ts';
import { has, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { setDesiredDirection, soldierGotoStationaryStance } from '../animation.ts';
import { getNewSoldierPath } from '../movement.ts';
import { enoughPoints } from '../points.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import {
  ACTION_HANDLE_CODE,
  actionCost,
  type DoorActionName,
  doorMenu,
  interactWithClosedDoor,
  interactWithDoorAt,
  interactWithOpenableStruct,
  startInteractiveObject,
} from './door-actions.ts';
import { findAdjacentGridExAdvanced } from './door-approach.ts';
import { findDoorInfo, PerceivedTrap } from './door-table.ts';
import { doTrapCheckOnStartingMenu } from './door-traps.ts';
import { soldierHasKey } from './keys.ts';
import { findCrowbar, findLocksmithKit, findShapedCharge, NO_SLOT } from './lock-attempts.ts';

export type DoorCommandOutcome =
  | { readonly ok: false; readonly refusal: string }
  | { readonly ok: true; readonly data: Readonly<Record<string, unknown>> };

const ESCORT_FORBIDDEN: ReadonlySet<DoorActionName> = new Set(['unlock', 'lock', 'pickLock', 'explode', 'examine', 'force']);

function refuse(refusal: string): DoorCommandOutcome {
  return { ok: false, refusal };
}

function doorStateRefusal(t: TacticalState, gridNo: number, open: boolean, action: DoorActionName): string | null {
  if (action === 'open') return open ? 'alreadyOpen' : null;
  if (action === 'close') return open ? null : 'alreadyClosed';
  if (open) return 'doorOpen';
  const door = findDoorInfo(t, gridNo);
  if (action === 'lock') return !door ? 'noLock' : door.locked ? 'alreadyLocked' : null;
  return door?.locked ? null : 'notLocked';
}

function itemRefusal(t: TacticalState, s: Soldier, action: DoorActionName): string | null {
  switch (action) {
    case 'unlock':
    case 'lock':
      return soldierHasKey(t, s, ANYKEY) ? null : 'noKey';
    case 'crowbar':
      return findCrowbar(t, s) === NO_SLOT ? 'noCrowbar' : null;
    case 'pickLock':
      return findLocksmithKit(t, s) === NO_SLOT ? 'noLockpickKit' : null;
    case 'explode':
      return findShapedCharge(t, s) === NO_SLOT ? 'noShapedCharge' : null;
    default:
      return null;
  }
}

function knowledgeRefusal(t: TacticalState, gridNo: number, action: DoorActionName): string | null {
  const perceived = findDoorInfo(t, gridNo)?.perceivedTrapped ?? PerceivedTrap.UNKNOWN;
  if (action === 'examine' && (perceived === PerceivedTrap.PROVED_TRAPPED || perceived === PerceivedTrap.PROVED_UNTRAPPED))
    return 'alreadyKnown';
  if (action === 'untrap' && perceived === PerceivedTrap.PROVED_UNTRAPPED) return 'alreadyKnown';
  return null;
}

export function doorActionRefusal(t: TacticalState, s: Soldier, gridNo: number, open: boolean, action: DoorActionName): string | null {
  return (
    doorStateRefusal(t, gridNo, open, action) ??
    (ESCORT_FORBIDDEN.has(action) && t.narrative.isEpc(s) ? 'escortCannot' : null) ??
    itemRefusal(t, s, action) ??
    knowledgeRefusal(t, gridNo, action)
  );
}

function doorAt(t: TacticalState, gridNo: number): StructureInstance | null {
  const door = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  return door ? (t.world.structures.findBase(door) ?? door) : null;
}

function openOrClose(t: TacticalState, s: Soldier, gridNo: number, direction: number): Record<string, unknown> {
  const outcome = interactWithDoorAt(t, s, gridNo, direction);
  if (outcome === 'menu') return { opened: false, locked: true, options: doorMenu(t, s, gridNo) };
  if (outcome === 'trapNoticed') return { opened: false, locked: true, trapNoticed: true };
  return { started: outcome };
}

function menuAction(t: TacticalState, s: Soldier, gridNo: number, direction: number, action: DoorActionName): Record<string, unknown> {
  startInteractiveObject(t, s, gridNo);
  s.reverse = false;
  if (!s.collapsed) setDesiredDirection(t, s, direction);
  if (!s.collapsed) soldierGotoStationaryStance(t, s);
  if (action !== 'lock' && doTrapCheckOnStartingMenu(t, s, gridNo)) {
    s.pendingDoorGridNo = -1;
    return { started: false, trapNoticed: true };
  }
  const refusal = doorActionRefusal(t, s, gridNo, false, action) ?? (s.desiredDirection & 1 ? 'diagonal' : null);
  if (refusal) {
    s.pendingDoorGridNo = -1;
    t.events.push({ type: 'doorResult', soldier: s.id, gridNo, action, result: refusal });
    return { started: false, refusal };
  }
  interactWithClosedDoor(t, s, ACTION_HANDLE_CODE[action]);
  return { started: action };
}

export function performDoorAction(
  t: TacticalState,
  s: Soldier,
  gridNo: number,
  direction: number,
  action: DoorActionName,
): Record<string, unknown> {
  if (!enoughPoints(t.inCombat, s, actionCost(s, action).ap)) {
    t.events.push({ type: 'doorResult', soldier: s.id, gridNo, action, result: 'notEnoughAp' });
    return { started: false, refusal: 'notEnoughAp' };
  }
  return action === 'open' || action === 'close' ? openOrClose(t, s, gridNo, direction) : menuAction(t, s, gridNo, direction, action);
}

export function doorCommand(t: TacticalState, s: Soldier, gridNo: number, action: DoorActionName): DoorCommandOutcome {
  const door = doorAt(t, gridNo);
  if (!door) return refuse('noDoor');
  const base = door.gridNo;
  const open = has(door.flags, StructureFlags.OPEN);
  const refusal = doorActionRefusal(t, s, base, open, action);
  if (refusal) return refuse(refusal);
  const approach = findAdjacentGridExAdvanced(t, s, door, base);
  if (!approach) return refuse('noPath');
  if (!enoughPoints(t.inCombat, s, actionCost(s, action).ap)) return refuse('notEnoughAp');
  s.pendingDoorAction = null;
  if (approach.gridNo === s.gridNo) return { ok: true, data: performDoorAction(t, s, base, approach.direction, action) };
  s.pendingDoorAction = { gridNo: base, actionGridNo: approach.gridNo, direction: approach.direction, action };
  if (!getNewSoldierPath(t, s, approach.gridNo, s.uiMovementMode, 1, s.noAPToFinishMove)) {
    s.pendingDoorAction = null;
    return refuse('noPath');
  }
  return { ok: true, data: { walking: true, to: approach.gridNo } };
}

export const OPEN_STRUCT_ACTION = 'openStruct';

function interactWithPendingStruct(t: TacticalState, s: Soldier, gridNo: number, direction: number): void {
  const structure = t.world.structures.find(gridNo, StructureFlags.OPENABLE);
  if (structure) interactWithOpenableStruct(t, s, structure, direction);
  else soldierGotoStationaryStance(t, s);
}

export function handlePendingDoorOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingDoorAction;
  if (!pending) return false;
  s.pendingDoorAction = null;
  if (pending.actionGridNo !== s.gridNo) return false;
  if (pending.action === OPEN_STRUCT_ACTION) {
    interactWithPendingStruct(t, s, pending.gridNo, pending.direction);
    return true;
  }
  const result = performDoorAction(t, s, pending.gridNo, pending.direction, pending.action as DoorActionName);
  if (result.started === false) soldierGotoStationaryStance(t, s);
  return true;
}
