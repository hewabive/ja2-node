// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (the wire cutters, jar and tin can branches); Soldier_Control.cc
// @src EVENT_SoldierBeginCutFence, EVENT_SoldierBeginTakeBlood, EVENT_SoldierBeginAttachCan; externalized/Soldier.cc
// @src handlePendingAction (MERC_CUTFFENCE, MERC_TAKEBLOOD, MERC_ATTACH_CAN); Structure_Wrap.cc
// @src FindCuttableWireFenceAtGridNo, CutWireFence, IsCuttableWireFenceAtGridNo, IsCorpseAtGridNo; Rotting_Corpses.cc
// @src GetBloodFromCorpse; Points.cc GetAPsToCutFence, GetAPsToUseJar; Soldier_Ani.cc codes 481 and 760.

import type { OpOutcome } from '../../content/anim/script.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { has, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { createItem, deleteObject, type ItemObject, swapObjects } from '../items/object.ts';
import { plotPathCost } from './ai/utils.ts';
import { anim } from './anim-states.ts';
import { AnimHeight, initNewSoldierAnim, setDesiredDirection, setSoldierDirection } from './animation.ts';
import { findAdjacentGridEx, findAdjacentGridExForDoor, type MeleeApproach } from './combat/melee-reach.ts';
import { ItemHandle } from './combat/types.ts';
import { modifyDoorStatusAsSeen } from './doors/door-status.ts';
import { swapStructureForPartnerAndRecord } from './doors.ts';
import { findObjWithin, InvSlot, NO_SLOT, NUM_INV_SLOTS } from './inventory.ts';
import { getNewSoldierPath } from './movement.ts';
import { AP, apsToChangeStance, enoughPoints } from './points.ts';
import { corpseAt, corpseInSlot, slotOfCorpse } from './rotting-corpses.ts';
import type { Soldier, TileTool } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { soldierEnterVehicle } from './vehicle-boarding.ts';

const CUT_FENCE_CODE = 481;
const TAKE_BLOOD_CODE = 760;
const FRESH_BLOOD_STATUS = 100;
const GROUND_LEVEL = 0;
const HUMAN_BLOOD = 'JAR_HUMAN_BLOOD';
const BLOOD_OF_CORPSE: Readonly<Record<string, string>> = {
  ADULTMONSTER_DEAD: 'JAR_CREATURE_BLOOD',
  INFANTMONSTER_DEAD: 'JAR_CREATURE_BLOOD',
  QUEEN_MONSTER_DEAD: 'JAR_QUEEN_CREATURE_BLOOD',
};

function itemIndex(t: Pick<TacticalState, 'content'>, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -2;
}

function findCuttableWireFence(t: TacticalState, g: number): StructureInstance | null {
  const fence = t.world.structures.find(g, StructureFlags.WIREFENCE);
  if (!fence || fence.wallOrientation === Orientation.NONE || has(fence.flags, StructureFlags.OPEN)) return null;
  return fence;
}

export function isCuttableWireFenceAtGridNo(t: TacticalState, g: number): boolean {
  return findCuttableWireFence(t, g) !== null;
}

export function fenceCuttableBy(t: TacticalState, s: Soldier, g: number): boolean {
  return s.level === GROUND_LEVEL && isCuttableWireFenceAtGridNo(t, g);
}

export function isCorpseAtGridNo(t: TacticalState, g: number): boolean {
  return t.world.structures.find(g, StructureFlags.CORPSE) !== null;
}

export function interactiveTileAt(t: TacticalState, g: number): number | null {
  const structure = t.world.structures.find(g, StructureFlags.OPENABLE);
  if (!structure) return null;
  return t.world.structures.findBase(structure)?.gridNo ?? g;
}

export function cutWireFence(t: TacticalState, g: number): boolean {
  const fence = findCuttableWireFence(t, g);
  if (!fence || !swapStructureForPartnerAndRecord(t, fence)) return false;
  recompileLocalMovementCosts(t.world.costs, t.world, g);
  return true;
}

export function apsToCutFence(t: TacticalState, s: Soldier): number {
  return apsToChangeStance(t.content, s, AnimHeight.CROUCH) + AP.USEWIRECUTTERS;
}

export function walkCostTo(t: TacticalState, s: Soldier, g: number): number {
  return s.gridNo === g ? 0 : plotPathCost(t, s, g, s.uiMovementMode);
}

export function apsToUseJar(t: TacticalState, s: Soldier, actionGridNo: number): number {
  const walk = walkCostTo(t, s, actionGridNo);
  return walk === 0 ? 0 : walk + AP.TAKE_BLOOD;
}

function faceToward(t: TacticalState, s: Soldier, direction: number): void {
  setDesiredDirection(t, s, direction);
  setSoldierDirection(t, s, direction);
}

export function soldierBeginCutFence(t: TacticalState, s: Soldier, g: number, direction: number): void {
  if (!isCuttableWireFenceAtGridNo(t, g)) return;
  s.reverse = false;
  faceToward(t, s, direction);
  s.targetGridNo = g;
  initNewSoldierAnim(t, s, anim(t.content, 'CUTTING_FENCE'), 0, false);
}

export function soldierBeginTakeBlood(t: TacticalState, s: Soldier, g: number, direction: number): void {
  const corpse = corpseAt(t, g);
  if (!corpse) {
    t.events.push({ type: 'nothingFound', soldier: s.id, gridNo: g });
    return;
  }
  s.pendingActionData4 = slotOfCorpse(t, corpse);
  faceToward(t, s, direction);
  initNewSoldierAnim(t, s, anim(t.content, 'TAKE_BLOOD_FROM_CORPSE'), 0, false);
}

export function soldierBeginAttachCan(t: TacticalState, s: Soldier, g: number, direction: number): void {
  const can = s.inv[InvSlot.HAND] as ItemObject;
  if (can.item !== itemIndex(t, 'STRING_TIED_TO_TIN_CAN')) return;
  const door = t.world.structures.find(g, StructureFlags.ANYDOOR);
  if (!door) return;
  const status = modifyDoorStatusAsSeen(t, g, has(door.flags, StructureFlags.OPEN));
  if (!status) return;
  status.hasTinCan = true;
  faceToward(t, s, direction);
  initNewSoldierAnim(t, s, anim(t.content, 'ATTACH_CAN_TO_STRING'), 0, false);
  deleteObject(can);
  t.events.push({ type: 'canAttached', soldier: s.id, gridNo: g });
}

const BEGIN_TILE_TOOL: Readonly<Record<TileTool, (t: TacticalState, s: Soldier, g: number, direction: number) => void>> = {
  cutFence: soldierBeginCutFence,
  takeBlood: soldierBeginTakeBlood,
  attachCan: soldierBeginAttachCan,
  enterVehicle: soldierEnterVehicle,
};

function walkUpThenUse(t: TacticalState, s: Soldier, approach: MeleeApproach, tool: TileTool, g: number): number {
  s.pendingTileTool = { tool, gridNo: g, direction: approach.direction };
  if (getNewSoldierPath(t, s, approach.actionGridNo, s.uiMovementMode, 0, true)) return ItemHandle.OK;
  s.pendingTileTool = null;
  return ItemHandle.CANNOT_GETTO_LOCATION;
}

export function handlePendingTileToolOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingTileTool;
  if (!pending) return false;
  s.pendingTileTool = null;
  BEGIN_TILE_TOOL[pending.tool](t, s, pending.gridNo, pending.direction);
  return true;
}

export function handleWireCutters(t: TacticalState, s: Soldier, g: number): number {
  const approach = findAdjacentGridEx(t, s, g, true);
  if (!approach) return ItemHandle.CANNOT_GETTO_LOCATION;
  if (!enoughPoints(t.inCombat, s, apsToCutFence(t, s) + walkCostTo(t, s, approach.actionGridNo))) return ItemHandle.NOAPS;
  if (s.gridNo !== approach.actionGridNo) return walkUpThenUse(t, s, approach, 'cutFence', approach.targetGridNo);
  soldierBeginCutFence(t, s, approach.targetGridNo, approach.direction);
  return ItemHandle.OK;
}

export function handleJar(t: TacticalState, s: Soldier, g: number): number {
  const approach = findAdjacentGridEx(t, s, g, true);
  if (!approach) return ItemHandle.CANNOT_GETTO_LOCATION;
  const cost = apsToUseJar(t, s, approach.actionGridNo) + walkCostTo(t, s, approach.actionGridNo);
  if (!enoughPoints(t.inCombat, s, cost)) return ItemHandle.NOAPS;
  if (s.gridNo !== approach.actionGridNo) return walkUpThenUse(t, s, approach, 'takeBlood', approach.targetGridNo);
  soldierBeginTakeBlood(t, s, approach.targetGridNo, approach.direction);
  return ItemHandle.OK;
}

export function handleTinCan(t: TacticalState, s: Soldier, g: number): number {
  const tile = interactiveTileAt(t, g);
  if (tile === null) return ItemHandle.CANNOT_GETTO_LOCATION;
  const approach = findAdjacentGridExForDoor(t, s, tile);
  if (!approach) return ItemHandle.CANNOT_GETTO_LOCATION;
  if (!enoughPoints(t.inCombat, s, AP.ATTACH_CAN + walkCostTo(t, s, approach.actionGridNo))) return ItemHandle.NOAPS;
  if (s.gridNo !== approach.actionGridNo) return walkUpThenUse(t, s, approach, 'attachCan', tile);
  soldierBeginTakeBlood(t, s, tile, approach.direction);
  return ItemHandle.OK;
}

function tileToolOf(t: Pick<TacticalState, 'content'>, item: number): 'wireCutters' | 'jar' | 'tinCan' | null {
  if (item === itemIndex(t, 'WIRECUTTERS')) return 'wireCutters';
  if (item === itemIndex(t, 'JAR')) return 'jar';
  if (item === itemIndex(t, 'STRING_TIED_TO_TIN_CAN')) return 'tinCan';
  return null;
}

export function handleTileTool(t: TacticalState, s: Soldier, g: number, handItemIndex: number): number | null {
  const tool = tileToolOf(t, handItemIndex);
  if (tool === 'wireCutters') return handleWireCutters(t, s, g);
  if (tool === 'jar') return handleJar(t, s, g);
  if (tool === 'tinCan') return handleTinCan(t, s, g);
  return null;
}

function bloodOfCorpse(t: TacticalState, type: number): string {
  return BLOOD_OF_CORPSE[t.content.corpses.table.types[type] ?? ''] ?? HUMAN_BLOOD;
}

function getBloodFromCorpse(t: TacticalState, s: Soldier): void {
  const type = corpseInSlot(t, s.pendingActionData4)?.type ?? 0;
  const name = bloodOfCorpse(t, type);
  const blood = createItem(t.content.items, itemIndex(t, name), FRESH_BLOOD_STATUS);
  const slot = findObjWithin(s.inv, itemIndex(t, 'JAR'), 0, NUM_INV_SLOTS - 1);
  if (slot === NO_SLOT) return;
  swapObjects(s.inv[slot] as ItemObject, blood);
  t.events.push({ type: 'jarFilled', soldier: s.id, item: name });
}

function cutFenceAtTarget(t: TacticalState, s: Soldier): void {
  if (cutWireFence(t, s.targetGridNo)) t.events.push({ type: 'fenceCut', soldier: s.id, gridNo: s.targetGridNo });
}

export function tileToolOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code === CUT_FENCE_CODE) cutFenceAtTarget(t, s);
  else if (code === TAKE_BLOOD_CODE) getBloodFromCorpse(t, s);
  else return null;
  return 'continue';
}
