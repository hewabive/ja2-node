// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc NPCOpenThing, HandleNPCDoAction (NPC_ACTION_OPEN_CLOSEST_DOOR,
// @src NPC_ACTION_OPEN_CLOSEST_CABINET, NPC_ACTION_GET_ITEMS_FROM_CLOSEST_CABINET);
// @src TacticalAI/FindLocations.cc FindClosestDoor, FindNearestOpenableNonDoor.

import { Approach } from '../../../../content/narrative/npc-constants.ts';
import { cardinalSpacesAway, pythSpacesAway, WORLD_COLS, WORLD_ROWS } from '../../../../content/world/grid.ts';
import { has, StructureFlags } from '../../../../content/world/structures.ts';
import { idiv } from '../../../../core/int.ts';
import { triggerNpcWithGivenApproach } from '../../../narrative/converse.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../../ai/actions.ts';
import { cancelAIAction } from '../../ai/control.ts';
import { findAdjacentGridExForDoor } from '../../combat/melee-reach.ts';
import { interactWithOpenableStruct, startInteractiveObject } from '../../doors/door-actions.ts';
import { OPEN_STRUCT_ACTION } from '../../doors/door-command.ts';
import { updateDoor } from '../../doors/door-table.ts';
import { ITEM_IGNORE_Z_LEVEL, soldierPickupItem } from '../../item-actions.ts';
import { getNewSoldierPath } from '../../movement.ts';
import { NOWHERE, type Soldier } from '../../soldier.ts';
import type { TacticalState } from '../../state.ts';
import { closeMenu, npcSoldier, tactical } from './common.ts';
import type { NpcActionEnv } from './env.ts';

const DOOR_SEARCH_RANGE = 5;
const DOOR_MAX_DISTANCE = 10;
const OPENABLE_SEARCH_RANGE = 7;
const OPENABLE_MAX_DISTANCE = 9999;
const ARMAND_CABINET_GRIDNO = 6968;
const MOVE_NOT_FROM_UI = 0;

interface SearchSquare {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
}

function searchSquare(origin: number, range: number): SearchSquare {
  return {
    left: Math.min(range, origin % WORLD_COLS),
    right: Math.min(range, WORLD_COLS - ((origin % WORLD_COLS) + 1)),
    up: Math.min(range, idiv(origin, WORLD_ROWS)),
    down: Math.min(range, WORLD_ROWS - (idiv(origin, WORLD_ROWS) + 1)),
  };
}

function* squareGridNos(origin: number, range: number): Generator<number> {
  const square = searchSquare(origin, range);
  for (let y = -square.up; y <= square.down; y++) for (let x = -square.left; x <= square.right; x++) yield origin + x + WORLD_COLS * y;
}

export function findClosestDoor(t: TacticalState, s: Soldier): number {
  let closest = NOWHERE;
  let closestDistance = DOOR_MAX_DISTANCE;
  for (const g of squareGridNos(s.gridNo, DOOR_SEARCH_RANGE)) {
    if (!t.world.structures.find(g, StructureFlags.ANYDOOR)) continue;
    const distance = pythSpacesAway(s.gridNo, g);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = g;
    }
  }
  return closest;
}

function hasOpenableNonDoor(t: TacticalState, g: number): boolean {
  return t.world.structures.at(g).some((s) => has(s.flags, StructureFlags.OPENABLE) && !has(s.flags, StructureFlags.ANYDOOR));
}

export function findNearestOpenableNonDoor(t: TacticalState, start: number): number {
  let closest = NOWHERE;
  let closestDistance = OPENABLE_MAX_DISTANCE;
  for (const g of squareGridNos(start, OPENABLE_SEARCH_RANGE)) {
    if (!hasOpenableNonDoor(t, g)) continue;
    const distance = cardinalSpacesAway(g, start);
    if (distance < closestDistance) {
      closest = g;
      closestDistance = distance;
    }
  }
  return closest;
}

function cabinetGridNo(t: TacticalState, s: Soldier): number {
  return s.profile === Npc.ARMAND ? ARMAND_CABINET_GRIDNO : findNearestOpenableNonDoor(t, s.gridNo);
}

function thingToOpen(t: TacticalState, s: Soldier, door: boolean): number {
  return door ? findClosestDoor(t, s) : cabinetGridNo(t, s);
}

export function npcOpenThing(env: NpcActionEnv, t: TacticalState, s: Soldier, door: boolean): boolean {
  const gridNo = thingToOpen(t, s, door);
  if (gridNo === NOWHERE) return false;
  const structure = t.world.structures.find(gridNo, door ? StructureFlags.ANYDOOR : StructureFlags.OPENABLE);
  if (!structure) return false;
  if (has(structure.flags, StructureFlags.OPEN)) {
    triggerNpcWithGivenApproach(env.host, s.profile, Approach.DONE_OPEN_STRUCTURE);
    return false;
  }
  updateDoor(t, gridNo, { locked: false });
  const approach = findAdjacentGridExForDoor(t, s, gridNo);
  if (!approach) return false;
  startInteractiveObject(t, s, gridNo);
  if (s.gridNo === approach.actionGridNo) interactWithOpenableStruct(t, s, structure, approach.direction);
  else {
    s.pendingDoorAction = { gridNo, actionGridNo: approach.actionGridNo, direction: approach.direction, action: OPEN_STRUCT_ACTION };
    getNewSoldierPath(t, s, approach.actionGridNo, s.uiMovementMode, MOVE_NOT_FROM_UI, true);
  }
  s.ai.action = AiAction.PENDING_ACTION;
  return true;
}

export function openClosestThing(env: NpcActionEnv, npc: number, door: boolean): void {
  closeMenu(env);
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (t && s) npcOpenThing(env, t, s, door);
}

export function getItemsFromClosestCabinet(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  cancelAIAction(t, s);
  s.ai.action = AiAction.PENDING_ACTION;
  s.inNonInterruptibleAnimation = false;
  s.rtNonInterruptible = false;
  soldierPickupItem(t, s, cabinetGridNo(t, s), ITEM_IGNORE_Z_LEVEL, null);
}
