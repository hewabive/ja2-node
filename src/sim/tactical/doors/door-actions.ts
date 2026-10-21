// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Doors.cc GetAnimStateForInteraction, InteractWithClosedDoor, InteractWithOpenableStruct,
// @src HandleOpenableStruct; Interface.cc PopupDoorOpenMenu, MakeButtonDoor, BtnDoorMenuCallback, DoorAction;
// @src Interactive_Tiles.cc StartInteractiveObject, SoldierHandleInteractiveObject; Soldier_Ani.cc code 495. See docs/25 §8.2–§8.3.

import { ANYKEY } from '../../../content/formats/locks.ts';
import { has, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { AiAction } from '../ai/actions.ts';
import { AnimHeight, endHeight, initNewSoldierAnim, setDesiredDirection, soldierGotoStationaryStance } from '../animation.ts';
import { toggleDoorAt } from '../doors.ts';
import { processImplicationsOfPCMessingWithDoor } from '../narrative/civ-hostility.ts';
import { checkPowPathsInAlmaPrison } from '../narrative/pow-rules.ts';
import { AP, BP, DOOR_APS, deductPoints, enoughPoints } from '../points.ts';
import { Body, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { DOOR_TRAP_NAMES, DoorTrap, findDoorInfo, HandleDoor, PerceivedTrap } from './door-table.ts';
import {
  attemptToUntrapDoor,
  doTrapCheckOnStartingMenu,
  examineDoorForTraps,
  hasDoorTrapGoneOff,
  springDoorTrap,
  updateDoorPerceivedValue,
} from './door-traps.ts';
import type { DoorMenuAction, DoorMenuOption } from './events.ts';
import { soldierHasKey } from './keys.ts';
import {
  attemptToBlowUpLock,
  attemptToCrowbarLock,
  attemptToLockDoor,
  attemptToPickLock,
  attemptToSmashDoor,
  attemptToUnlockDoor,
  findCrowbar,
  findLocksmithKit,
  findShapedCharge,
  NO_SLOT,
} from './lock-attempts.ts';

export const DOOR_ACTIONS = [
  'open',
  'close',
  'openManually',
  'unlock',
  'lock',
  'pickLock',
  'force',
  'crowbar',
  'explode',
  'untrap',
  'examine',
] as const;
export type DoorActionName = (typeof DOOR_ACTIONS)[number];

export const ACTION_HANDLE_CODE: Readonly<Record<DoorActionName, number>> = {
  open: HandleDoor.OPEN,
  close: HandleDoor.OPEN,
  openManually: HandleDoor.OPEN,
  unlock: HandleDoor.UNLOCK,
  lock: HandleDoor.LOCK,
  pickLock: HandleDoor.LOCKPICK,
  force: HandleDoor.FORCE,
  crowbar: HandleDoor.CROWBAR,
  explode: HandleDoor.EXPLODE,
  untrap: HandleDoor.UNTRAP,
  examine: HandleDoor.EXAMINE,
};

const HANDLE_CODE_ACTION: Readonly<Record<number, DoorActionName>> = {
  [HandleDoor.OPEN]: 'open',
  [HandleDoor.OPEN_DIAG_SHORT]: 'open',
  [HandleDoor.OPEN_DIAG_LONG]: 'open',
  [HandleDoor.UNLOCK]: 'unlock',
  [HandleDoor.LOCK]: 'lock',
  [HandleDoor.LOCKPICK]: 'pickLock',
  [HandleDoor.FORCE]: 'force',
  [HandleDoor.CROWBAR]: 'crowbar',
  [HandleDoor.EXPLODE]: 'explode',
  [HandleDoor.UNTRAP]: 'untrap',
  [HandleDoor.EXAMINE]: 'examine',
};

type MenuCostAction = Exclude<DoorActionName, 'open' | 'close' | 'openManually'>;

const menuCosts = (): Readonly<Record<MenuCostAction, { readonly ap: number; readonly bp: number }>> => ({
  unlock: { ap: AP.UNLOCK_DOOR, bp: BP.UNLOCK_DOOR },
  lock: { ap: AP.LOCK_DOOR, bp: BP.LOCK_DOOR },
  pickLock: { ap: AP.PICKLOCK, bp: BP.PICKLOCK },
  force: { ap: AP.BOOT_DOOR, bp: BP.BOOT_DOOR },
  crowbar: { ap: AP.USE_CROWBAR, bp: BP.USE_CROWBAR },
  explode: { ap: AP.EXPLODE_DOOR, bp: BP.EXPLODE_DOOR },
  untrap: { ap: AP.UNTRAP_DOOR, bp: BP.UNTRAP_DOOR },
  examine: { ap: AP.EXAMINE_DOOR, bp: BP.EXAMINE_DOOR },
});

const BLOW_UP_RESULT = { damaged: 'lockDamaged', exploded: 'chargeExploded', noCharge: 'failed' } as const;

export function doorApCost(code: number): number {
  return DOOR_APS[code as 0 | 1 | 2 | 3] ?? DOOR_APS[HandleDoor.OPEN];
}

export function actionCost(s: Soldier, action: DoorActionName): { readonly ap: number; readonly bp: number } {
  if (action === 'open' || action === 'close' || action === 'openManually') return { ap: doorApCost(s.doorHandleCode), bp: BP.OPEN_DOOR };
  return menuCosts()[action];
}

type Interaction = 'OPEN_DOOR' | 'CLOSE_DOOR' | 'END_OPEN_DOOR' | 'END_OPEN_LOCKED_DOOR' | 'PICK_LOCK';

const CRIPPLE_STATE: Readonly<Record<Exclude<Interaction, 'PICK_LOCK'>, string>> = {
  OPEN_DOOR: 'CRIPPLE_OPEN_DOOR',
  CLOSE_DOOR: 'CRIPPLE_CLOSE_DOOR',
  END_OPEN_DOOR: 'CRIPPLE_END_OPEN_DOOR',
  END_OPEN_LOCKED_DOOR: 'CRIPPLE_END_OPEN_LOCKED_DOOR',
};
const DOOR_STATE: Readonly<Record<Interaction, readonly [string, string]>> = {
  OPEN_DOOR: ['OPEN_DOOR', 'OPEN_DOOR_CROUCHED'],
  CLOSE_DOOR: ['CLOSE_DOOR', 'CLOSE_DOOR_CROUCHED'],
  END_OPEN_DOOR: ['END_OPEN_DOOR', 'END_OPEN_DOOR_CROUCHED'],
  END_OPEN_LOCKED_DOOR: ['END_OPEN_LOCKED_DOOR', 'END_OPEN_LOCKED_DOOR_CROUCHED'],
  PICK_LOCK: ['PICK_LOCK', 'LOCKPICK_CROUCHED'],
};
const STRUCT_STATE: Readonly<Record<Exclude<Interaction, 'PICK_LOCK'>, readonly [string, string]>> = {
  OPEN_DOOR: ['BEGIN_OPENSTRUCT', 'BEGIN_OPENSTRUCT_CROUCHED'],
  CLOSE_DOOR: ['OPEN_STRUCT', 'OPEN_STRUCT_CROUCHED'],
  END_OPEN_DOOR: ['END_OPENSTRUCT', 'END_OPENSTRUCT_CROUCHED'],
  END_OPEN_LOCKED_DOOR: ['END_OPENSTRUCT_LOCKED', 'END_OPENSTRUCT_LOCKED_CROUCHED'],
};

function interactionState(t: TacticalState, s: Soldier, isDoor: boolean, interaction: Interaction): string {
  const standing = endHeight(t.content, s.state) === AnimHeight.STAND ? 0 : 1;
  if (interaction === 'PICK_LOCK') return DOOR_STATE.PICK_LOCK[standing] as string;
  if (s.bodyType === Body.CRIPPLECIV) return CRIPPLE_STATE[interaction];
  return (isDoor ? DOOR_STATE : STRUCT_STATE)[interaction][standing] as string;
}

function changeState(t: TacticalState, s: Soldier, name: string): void {
  const state = t.content.animations.stateIndex.get(name);
  if (state !== undefined) initNewSoldierAnim(t, s, state, 0, false);
}

function playInteraction(t: TacticalState, s: Soldier, isDoor: boolean, interaction: Interaction): void {
  changeState(t, s, interactionState(t, s, isDoor, interaction));
}

export function interactWithClosedDoor(t: TacticalState, s: Soldier, code: number): void {
  s.doorHandleCode = code;
  if (code === HandleDoor.FORCE) changeState(t, s, 'KICK_DOOR');
  else if (code === HandleDoor.LOCKPICK) playInteraction(t, s, true, 'PICK_LOCK');
  else if (code !== HandleDoor.DENIED) playInteraction(t, s, true, 'OPEN_DOOR');
}

function menuOption(t: TacticalState, s: Soldier, action: DoorMenuAction, ap: number, refusal: string | null): DoorMenuOption {
  let reason = refusal;
  if (!reason && s.desiredDirection & 1) reason = 'diagonal';
  if (!reason && ap !== 0 && !enoughPoints(t.inCombat, s, ap)) reason = 'notEnoughAp';
  return reason ? { action, ap: t.inCombat ? ap : 0, enabled: false, reason } : { action, ap: t.inCombat ? ap : 0, enabled: true };
}

export function doorMenu(t: TacticalState, s: Soldier, gridNo: number): DoorMenuOption[] {
  const door = findDoorInfo(t, gridNo);
  const epc = t.narrative.isEpc(s);
  const escort = epc ? 'escortCannot' : null;
  const perceived = door?.perceivedTrapped ?? PerceivedTrap.UNKNOWN;
  const examined = perceived === PerceivedTrap.PROVED_TRAPPED || perceived === PerceivedTrap.PROVED_UNTRAPPED;
  const costs = menuCosts();
  const cost = (a: MenuCostAction) => costs[a];
  return [
    menuOption(t, s, 'openManually', doorApCost(s.doorHandleCode), null),
    menuOption(t, s, 'unlock', cost('unlock').ap, escort ?? (soldierHasKey(t, s, ANYKEY) ? null : 'noKey')),
    menuOption(t, s, 'crowbar', cost('crowbar').ap, findCrowbar(t, s) === NO_SLOT ? 'noCrowbar' : null),
    menuOption(t, s, 'pickLock', cost('pickLock').ap, escort ?? (findLocksmithKit(t, s) === NO_SLOT ? 'noLockpickKit' : null)),
    menuOption(t, s, 'explode', cost('explode').ap, escort ?? (findShapedCharge(t, s) === NO_SLOT ? 'noShapedCharge' : null)),
    menuOption(t, s, 'examine', cost('examine').ap, examined ? 'alreadyKnown' : escort),
    menuOption(t, s, 'force', cost('force').ap, escort),
    menuOption(t, s, 'untrap', cost('untrap').ap, perceived === PerceivedTrap.PROVED_UNTRAPPED ? 'alreadyKnown' : null),
  ];
}

export type InteractionOutcome = 'busy' | 'closing' | 'opening' | 'menu' | 'trapNoticed';

export function interactWithOpenableStruct(
  t: TacticalState,
  s: Soldier,
  structure: StructureInstance,
  direction: number,
): InteractionOutcome {
  const base = t.world.structures.findBase(structure) ?? structure;
  const isDoor = has(structure.flags, StructureFlags.ANYDOOR);
  const isSwitch = has(structure.flags, StructureFlags.SWITCH);
  if (!s.collapsed) setDesiredDirection(t, s, direction);
  if (has(structure.flags, StructureFlags.OPEN)) {
    if (s.team === Team.OUR && !isSwitch && !s.collapsed) soldierGotoStationaryStance(t, s);
    playInteraction(t, s, isDoor, 'CLOSE_DOOR');
    return 'closing';
  }
  if (s.team === Team.OUR) {
    const door = findDoorInfo(t, base.gridNo);
    if (door?.locked) {
      if (!s.collapsed) soldierGotoStationaryStance(t, s);
      if (doTrapCheckOnStartingMenu(t, s, base.gridNo)) return 'trapNoticed';
      t.events.push({ type: 'doorMenu', soldier: s.id, gridNo: base.gridNo, options: doorMenu(t, s, base.gridNo) });
      return 'menu';
    }
    if (!isDoor && !isSwitch) s.doorHandleCode = HandleDoor.OPEN;
  } else s.doorHandleCode = HandleDoor.OPEN;
  playInteraction(t, s, isDoor, 'OPEN_DOOR');
  return 'opening';
}

interface Resolution {
  handle: boolean;
  ap: number;
  bp: number;
  result: string | null;
  trap?: string;
}

function doorResult(t: TacticalState, s: Soldier, gridNo: number, code: number, r: Resolution): void {
  if (!r.result) return;
  const action = r.result === 'closed' ? 'close' : (HANDLE_CODE_ACTION[code] ?? 'open');
  t.events.push({ type: 'doorResult', soldier: s.id, gridNo, action, result: r.result, ...(r.trap ? { trap: r.trap } : {}) });
}

function checkLockedTrap(t: TacticalState, s: Soldier, gridNo: number, isDoor: boolean, r: Resolution): boolean {
  const code = s.doorHandleCode;
  if (code === HandleDoor.EXAMINE || code === HandleDoor.UNTRAP || code === HandleDoor.UNLOCK) return true;
  const door = findDoorInfo(t, gridNo);
  if (!door?.locked || door.trapId === DoorTrap.NONE) return true;
  r.ap = doorApCost(code);
  r.bp = BP.OPEN_DOOR;
  playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
  let proceed = true;
  if (hasDoorTrapGoneOff(t, s, door)) {
    if (springDoorTrap(t, s, gridNo)) proceed = false;
  } else if (door.perceivedTrapped === PerceivedTrap.UNKNOWN) {
    r.result = 'trapNoticed';
    r.trap = DOOR_TRAP_NAMES[door.trapId] ?? 'unknown';
    proceed = false;
  } else if (springDoorTrap(t, s, gridNo)) proceed = false;
  updateDoorPerceivedValue(t, gridNo, code);
  if (!proceed) r.result ??= 'trapStopped';
  return proceed;
}

function resolveOurClosedDoor(t: TacticalState, s: Soldier, gridNo: number, isDoor: boolean, r: Resolution): void {
  if (!checkLockedTrap(t, s, gridNo, isDoor, r)) return;
  const door = findDoorInfo(t, gridNo);
  switch (s.doorHandleCode) {
    case HandleDoor.OPEN:
    case HandleDoor.OPEN_DIAG_SHORT:
    case HandleDoor.OPEN_DIAG_LONG:
      if (!door) {
        r.ap = doorApCost(s.doorHandleCode);
        r.bp = BP.OPEN_DOOR;
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.handle = true;
        r.result = 'opened';
        return;
      }
      if (door.locked) {
        playInteraction(t, s, isDoor, 'END_OPEN_LOCKED_DOOR');
        r.result = 'locked';
      } else {
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.handle = true;
        r.result = 'opened';
      }
      updateDoorPerceivedValue(t, gridNo, HandleDoor.OPEN);
      return;
    case HandleDoor.FORCE:
    case HandleDoor.CROWBAR: {
      const crowbar = s.doorHandleCode === HandleDoor.CROWBAR;
      r.ap = crowbar ? AP.USE_CROWBAR : AP.BOOT_DOOR;
      r.bp = crowbar ? BP.USE_CROWBAR : BP.BOOT_DOOR;
      if (!door) {
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.handle = true;
        r.result = 'noLock';
        return;
      }
      if (crowbar ? attemptToCrowbarLock(t, s, gridNo) : attemptToSmashDoor(t, s, gridNo)) {
        r.handle = true;
        r.result = 'opened';
      } else {
        updateDoorPerceivedValue(t, gridNo, crowbar ? Number(door.trapId !== DoorTrap.SILENT_ALARM) : HandleDoor.FORCE);
        r.result = 'failed';
      }
      processImplicationsOfPCMessingWithDoor(t, s);
      return;
    }
    case HandleDoor.EXPLODE:
      r.ap = AP.EXPLODE_DOOR;
      r.bp = BP.EXPLODE_DOOR;
      if (!door) {
        r.result = 'noLock';
        return;
      }
      {
        const outcome = attemptToBlowUpLock(t, s, gridNo);
        if (outcome === 'destroyed') {
          r.handle = true;
          r.result = 'opened';
        } else {
          updateDoorPerceivedValue(t, gridNo, HandleDoor.EXPLODE);
          r.result = BLOW_UP_RESULT[outcome];
        }
      }
      processImplicationsOfPCMessingWithDoor(t, s);
      return;
    case HandleDoor.LOCKPICK:
      r.ap = AP.PICKLOCK;
      r.bp = BP.PICKLOCK;
      if (!door) {
        r.result = 'noLock';
        return;
      }
      if (attemptToPickLock(t, s, gridNo)) {
        r.handle = true;
        r.result = 'opened';
      } else r.result = 'failed';
      processImplicationsOfPCMessingWithDoor(t, s);
      return;
    case HandleDoor.EXAMINE:
      r.ap = AP.EXAMINE_DOOR;
      r.bp = BP.EXAMINE_DOOR;
      playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
      if (!door) {
        r.result = 'noLock';
        return;
      }
      if (examineDoorForTraps(t, s, gridNo)) {
        updateDoorPerceivedValue(t, gridNo, HandleDoor.EXAMINE);
        r.result = 'trapFound';
      } else r.result = 'noTrapFound';
      return;
    case HandleDoor.UNLOCK:
      r.ap = AP.UNLOCK_DOOR;
      r.bp = BP.UNLOCK_DOOR;
      if (!door) {
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.result = 'noLock';
        return;
      }
      if (attemptToUnlockDoor(t, s, gridNo)) {
        updateDoorPerceivedValue(t, gridNo, HandleDoor.UNLOCK);
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.handle = true;
        r.result = 'opened';
      } else {
        playInteraction(t, s, isDoor, 'END_OPEN_LOCKED_DOOR');
        r.result = 'wrongKey';
      }
      return;
    case HandleDoor.UNTRAP:
      r.ap = AP.UNTRAP_DOOR;
      r.bp = BP.UNTRAP_DOOR;
      if (!door) {
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.result = 'noLock';
        return;
      }
      if (door.trapId === DoorTrap.NONE) {
        r.result = 'notTrapped';
        return;
      }
      if (attemptToUntrapDoor(t, s, gridNo)) {
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        updateDoorPerceivedValue(t, gridNo, HandleDoor.UNTRAP);
        r.result = 'untrapped';
      } else {
        playInteraction(t, s, isDoor, 'END_OPEN_LOCKED_DOOR');
        springDoorTrap(t, s, gridNo);
        updateDoorPerceivedValue(t, gridNo, HandleDoor.UNTRAP);
        r.result = 'trapSprung';
      }
      return;
    case HandleDoor.LOCK:
      r.ap = AP.LOCK_DOOR;
      r.bp = BP.LOCK_DOOR;
      if (!door) {
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.result = 'noLock';
        return;
      }
      if (attemptToLockDoor(t, s, gridNo)) {
        playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
        r.result = 'locked';
      } else {
        playInteraction(t, s, isDoor, 'END_OPEN_LOCKED_DOOR');
        r.result = 'wrongKey';
      }
      updateDoorPerceivedValue(t, gridNo, HandleDoor.LOCK);
      return;
  }
}

export function handleOpenableStruct(t: TacticalState, s: Soldier, gridNo: number, structure: StructureInstance, noisy = false): boolean {
  const isDoor = has(structure.flags, StructureFlags.ANYDOOR);
  const code = s.doorHandleCode;
  const r: Resolution = { handle: false, ap: 0, bp: 0, result: null };
  if (has(structure.flags, StructureFlags.OPEN)) {
    r.ap = s.team === Team.OUR ? doorApCost(code) : doorApCost(HandleDoor.OPEN);
    r.bp = BP.OPEN_DOOR;
    r.handle = true;
    r.result = 'closed';
  } else if (s.team === Team.OUR) resolveOurClosedDoor(t, s, gridNo, isDoor, r);
  else {
    r.ap = doorApCost(HandleDoor.OPEN);
    r.bp = BP.OPEN_DOOR;
    playInteraction(t, s, isDoor, 'END_OPEN_DOOR');
    r.handle = true;
  }
  if (r.handle && isDoor) {
    toggleDoorAt(t, gridNo, noisy);
    if (!has(structure.flags, StructureFlags.OPEN)) checkPowPathsInAlmaPrison(t);
  }
  deductPoints(t.inCombat, s, r.ap, r.bp);
  if (s.team === Team.OUR) doorResult(t, s, gridNo, code, r);
  return r.handle;
}

const OPEN_STRUCT_STATES: ReadonlySet<string> = new Set([
  'OPEN_STRUCT',
  'OPEN_STRUCT_CROUCHED',
  'BEGIN_OPENSTRUCT',
  'BEGIN_OPENSTRUCT_CROUCHED',
]);

export function startInteractiveObject(t: TacticalState, s: Soldier, gridNo: number): void {
  if (OPEN_STRUCT_STATES.has(t.content.animations.controls[s.state]?.id ?? '')) return;
  s.pendingDoorGridNo = gridNo;
}

export function interactWithDoorAt(t: TacticalState, s: Soldier, gridNo: number, direction: number): InteractionOutcome | null {
  const structure = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  if (!structure) return null;
  startInteractiveObject(t, s, gridNo);
  s.reverse = false;
  return interactWithOpenableStruct(t, s, structure, direction);
}

export function soldierHandleInteractiveObject(t: TacticalState, s: Soldier, noisy = false): boolean {
  const gridNo = s.pendingDoorGridNo;
  s.pendingDoorGridNo = -1;
  if (gridNo < 0) return false;
  const structure = t.world.structures.find(gridNo, StructureFlags.OPENABLE);
  if (!structure) return false;
  return handleOpenableStruct(t, s, gridNo, structure, noisy);
}

export function aiDoorActionWithoutInteraction(s: Soldier): boolean {
  if (s.ai.action === AiAction.UNLOCK_DOOR || (s.ai.action === AiAction.LOCK_DOOR && !s.ai.lockDoorIncludesClose)) return true;
  s.ai.lockDoorIncludesClose = false;
  return false;
}
