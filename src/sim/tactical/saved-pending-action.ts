// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (the end of a walk runs the pending action, :817; a door or container
// @src on the structure at sPendingActionData2, :821);
// @src src/externalized/Soldier.cc Soldier::handlePendingAction (each action on uiPendingActionData1, sPendingActionData2,
// @src bPendingActionData3 and uiPendingActionData4); Tactical/Soldier_Control.h (the MERC_* codes); LoadSaveSoldierType.cc
// @src (pTempObject comes back NULL, so a saved give hands nothing over and a saved robot reload has no ammo);
// @src TileEngine/Interactive_Tiles.cc StartInteractiveObject, SoldierHandleInteractiveObject (the structure ID in
// @src uiPendingActionData1, which TileEngine/Structure.cc AddStructureToWorld numbers per process); Tactical/Handle_Items.cc
// @src HandleSoldierPickupItem (the item index read for another team only).

import { i16, u16 } from '../../core/int.ts';
import { MeleeKind } from './combat/melee.ts';
import { OPEN_STRUCT_ACTION } from './doors/door-command.ts';
import { MERC_GIVE_ITEM, NOWHERE, type SavedPendingAction, type Soldier, type TileTool } from './soldier.ts';
import type { TacticalState } from './state.ts';

const SavedAction = {
  OPEN_DOOR: 0,
  OPEN_STRUCT: 1,
  PICKUP_ITEM: 2,
  PUNCH: 3,
  KNIFE_ATTACK: 4,
  GIVE_AID: 5,
  CUT_FENCE: 8,
  DROP_BOMB: 9,
  STEAL: 10,
  TALK: 11,
  ENTER_VEHICLE: 12,
  REPAIR: 13,
  RELOAD_ROBOT: 14,
  TAKE_BLOOD: 15,
  ATTACH_CAN: 16,
  FUEL_VEHICLE: 17,
} as const;

const OPENABLE_ACTIONS: ReadonlySet<number> = new Set([SavedAction.OPEN_DOOR, SavedAction.OPEN_STRUCT]);

const MELEE_KINDS: ReadonlyMap<number, number> = new Map([
  [SavedAction.PUNCH, MeleeKind.PUNCH],
  [SavedAction.KNIFE_ATTACK, MeleeKind.BLADE],
  [SavedAction.STEAL, MeleeKind.STEAL],
]);

const TILE_TOOLS: ReadonlyMap<number, TileTool> = new Map([
  [SavedAction.CUT_FENCE, 'cutFence'],
  [SavedAction.ENTER_VEHICLE, 'enterVehicle'],
  [SavedAction.REPAIR, 'repair'],
  [SavedAction.TAKE_BLOOD, 'takeBlood'],
  [SavedAction.ATTACH_CAN, 'attachCan'],
  [SavedAction.FUEL_VEHICLE, 'refuel'],
]);

function adoptedAsMelee(s: Soldier, saved: SavedPendingAction): boolean {
  const kind = MELEE_KINDS.get(saved.action);
  if (kind === undefined) return false;
  s.pendingMelee = { kind, targetGridNo: s.pendingActionData2, direction: saved.data3, animCount: saved.animCount };
  return true;
}

function adoptedAsTileTool(s: Soldier, saved: SavedPendingAction): boolean {
  const tool = TILE_TOOLS.get(saved.action);
  if (tool === undefined) return false;
  s.pendingTileTool = { tool, gridNo: s.pendingActionData2, direction: saved.data3 };
  return true;
}

function savedStructureNamed(t: TacticalState, s: Soldier, gridNo: number): boolean {
  return t.world.structures.findById(gridNo, u16(s.pendingActionData1)) !== null;
}

function adoptedAsOpenable(t: TacticalState, s: Soldier, saved: SavedPendingAction): boolean {
  if (!OPENABLE_ACTIONS.has(saved.action)) return false;
  const gridNo = s.pendingActionData2;
  s.pendingDoorGridNo = savedStructureNamed(t, s, gridNo) ? gridNo : NOWHERE;
  s.pendingDoorAction = { gridNo, actionGridNo: s.gridNo, direction: saved.data3, action: OPEN_STRUCT_ACTION };
  return true;
}

function adoptedAsPickup(s: Soldier, saved: SavedPendingAction): boolean {
  if (saved.action !== SavedAction.PICKUP_ITEM) return false;
  s.pendingPickup = { gridNo: i16(s.pendingActionData4), actionGridNo: s.pendingActionData2, zLevel: saved.data3, selection: null };
  return true;
}

function adoptedAsOther(s: Soldier, saved: SavedPendingAction): boolean {
  const targetGridNo = s.pendingActionData2;
  switch (saved.action) {
    case SavedAction.GIVE_AID:
      s.pendingAid = { targetGridNo, direction: saved.data3 };
      return true;
    case SavedAction.RELOAD_ROBOT:
      s.pendingRobotReload = { targetGridNo, direction: saved.data3 };
      return true;
    case MERC_GIVE_ITEM:
      s.heldGiveAction = { target: saved.giveTarget, targetGridNo, direction: saved.data3, animCount: saved.animCount };
      return true;
    case SavedAction.DROP_BOMB:
      s.pendingDropBomb = true;
      return true;
    case SavedAction.TALK:
      s.pendingTalk = s.pendingActionData1;
      return true;
    default:
      return false;
  }
}

function adopted(t: TacticalState, s: Soldier, saved: SavedPendingAction): boolean {
  return (
    adoptedAsMelee(s, saved) ||
    adoptedAsTileTool(s, saved) ||
    adoptedAsOpenable(t, s, saved) ||
    adoptedAsPickup(s, saved) ||
    adoptedAsOther(s, saved)
  );
}

export function adoptSavedPendingAction(t: TacticalState, s: Soldier): void {
  const saved = s.savedPendingAction;
  if (saved && adopted(t, s, saved)) s.savedPendingAction = null;
}
