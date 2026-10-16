// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (punch and blade tile choice);
// @src Overhead.cc FindAdjacentGridEx (with and without fDoor), FindNextToAdjacentGridEx, FindAdjacentPunchTarget;
// @src Soldier_Find.cc FindSoldier (FIND_SOLDIER_GRIDNO). See docs/11 §6.1.

import { Orientation } from '../../../content/formats/jsd.ts';
import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction, newGridNo, pythSpacesAway, WORLD_MAX } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { has, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { plotPathCost } from '../ai/utils.ts';
import { InvSlot } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { newOKDestination, newOKDestinationAndDirection } from '../pathfinding.ts';
import { doorTravelCost } from '../points.ts';
import { Body, isCreatureOrBloodcat, NOWHERE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';

export interface MeleeSpot {
  readonly targetGridNo: number;
  readonly direction: number;
}

export interface MeleeApproach {
  readonly actionGridNo: number;
  readonly targetGridNo: number;
  readonly direction: number;
}

const SIDE_DIRECTIONS: readonly number[] = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST];
const UI_LEVEL = 0;
const NO_PATH_DISTANCE = WORLD_MAX + 1;
const WORLD_MAX_DISTANCE = WORLD_MAX;

function pointsContext(t: TacticalState) {
  return { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
}

function doorAdjustedCost(t: TacticalState, s: Soldier, spot: number, cost: number, perceived = false): number {
  return doorTravelCost(pointsContext(t), s, spot, cost, perceived, false);
}

function walkCost(t: TacticalState, s: Soldier, g: number): number {
  return plotPathCost(t, s, g, s.uiMovementMode);
}

export function findSoldierAtGridNo(t: TacticalState, g: number, level: number): Soldier | null {
  for (const m of t.mercSlots) {
    if (!m?.placed || m.dead) continue;
    if (m.visible === -1 && !t.pathEnv.showAllMercs) continue;
    if (m.gridNo === g && !newOKDestination(t.pathEnv, m, g, true, level)) return m;
  }
  return null;
}

export function bladeSpot(t: TacticalState, s: Soldier, g: number): MeleeSpot | null {
  for (const dir of SIDE_DIRECTIONS) {
    const spot = newGridNo(g, DIRECTION_INCREMENT[dir] ?? 0);
    if (doorAdjustedCost(t, s, spot, t.world.costs.get(spot, dir, s.level)) >= TravelCost.BLOCKED) continue;
    if (spot === s.gridNo) return { targetGridNo: g, direction: directionToward(s.gridNo, g) };
  }
  return null;
}

export function findAdjacentPunchTarget(t: TacticalState, s: Soldier, tgt: Soldier): MeleeApproach | null {
  for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
    const spot = newGridNo(s.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
    if (doorAdjustedCost(t, s, spot, t.world.costs.get(spot, dir, s.level)) >= TravelCost.BLOCKED) continue;
    if (whoIsThere(t, spot, s.level) === tgt) return { actionGridNo: spot, targetGridNo: tgt.gridNo, direction: dir };
  }
  return null;
}

export function punchSpot(t: TacticalState, s: Soldier, g: number, level: number): MeleeSpot | null {
  const tgt = whoIsThere(t, g, level);
  if (tgt) {
    for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
      const spot = newGridNo(s.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
      const cost = t.world.costs.get(spot, dir, level);
      if (cost >= TravelCost.BLOCKED || doorAdjustedCost(t, s, spot, cost) >= TravelCost.BLOCKED) continue;
      if (whoIsThere(t, spot, s.level) === tgt) return { targetGridNo: tgt.gridNo, direction: dir };
    }
  }
  return bladeSpot(t, s, g);
}

export function meleeSpot(t: TacticalState, s: Soldier, g: number, level: number): MeleeSpot | null {
  const hand = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? NOTHING);
  return hand?.itemClass === ItemClass.BLADE ? bladeSpot(t, s, g) : punchSpot(t, s, g, level);
}

interface Candidate {
  distance: number;
  gridNo: number;
}

function forcedToPerson(t: TacticalState, g: number): number {
  return findSoldierAtGridNo(t, g, UI_LEVEL)?.gridNo ?? g;
}

function offerTarget(t: TacticalState, s: Soldier, g: number, best: Candidate): void {
  if (!newOKDestination(t.pathEnv, s, g, true, s.level) || t.world.exitGrids.has(g)) return;
  const distance = walkCost(t, s, g);
  if (distance > 0 && distance < best.distance) {
    best.distance = distance;
    best.gridNo = g;
  }
}

function offerSpot(t: TacticalState, s: Soldier, spot: number, target: number, best: Candidate): void {
  if (!newOKDestinationAndDirection(t.pathEnv, s, spot, directionToward(spot, target), true, s.level)) return;
  const distance = walkCost(t, s, spot);
  if (distance > 0 && distance < best.distance) {
    best.distance = distance;
    best.gridNo = spot;
  }
}

function approachTo(best: Candidate, target: number, fallbackDirection: number): MeleeApproach | null {
  if (best.gridNo === NOWHERE) return null;
  const direction = best.gridNo === target ? fallbackDirection : directionToward(best.gridNo, target);
  return { actionGridNo: best.gridNo, targetGridNo: target, direction };
}

const ORIENT_LEFT = Orientation.INSIDE_LEFT | Orientation.OUTSIDE_LEFT;
const ORIENT_RIGHT = Orientation.INSIDE_RIGHT | Orientation.OUTSIDE_RIGHT;

function sameTileDoorDirection(t: TacticalState, s: Soldier, g: number): number {
  const door = t.world.structures.find(g, StructureFlags.ANYDOOR);
  if (!door) return s.direction;
  let direction = s.direction;
  if (door.wallOrientation & ORIENT_LEFT) direction = directionToward(s.gridNo, newGridNo(g, DIRECTION_INCREMENT[Direction.SOUTH] ?? 0));
  if (door.wallOrientation & ORIENT_RIGHT) direction = directionToward(s.gridNo, newGridNo(g, DIRECTION_INCREMENT[Direction.EAST] ?? 0));
  return direction;
}

function refusedByDoor(door: StructureInstance | null, dir: number): boolean {
  if (!door) return false;
  if (door.wallOrientation & ORIENT_RIGHT && (dir === Direction.NORTH || dir === Direction.WEST || dir === Direction.SOUTH)) return true;
  return (door.wallOrientation & ORIENT_LEFT) !== 0 && (dir === Direction.NORTH || dir === Direction.WEST || dir === Direction.EAST);
}

export function findAdjacentGridExForDoor(t: TacticalState, s: Soldier, g: number): MeleeApproach | null {
  if (s.gridNo === g && !t.world.structures.find(g, StructureFlags.SWITCH))
    return { actionGridNo: g, targetGridNo: g, direction: sameTileDoorDirection(t, s, g) };
  const door = t.world.structures.find(g, StructureFlags.ANYDOOR | StructureFlags.SWITCH);
  const isSwitch = door !== null && has(door.flags, StructureFlags.SWITCH);
  const best: Candidate = { distance: NO_PATH_DISTANCE, gridNo: NOWHERE };
  if (!isSwitch) offerTarget(t, s, g, best);
  for (const dir of SIDE_DIRECTIONS) {
    const spot = newGridNo(g, DIRECTION_INCREMENT[dir] ?? 0);
    const testDirection = isSwitch ? (dir + DIRECTION_COUNT / 2) % DIRECTION_COUNT : dir;
    if (t.world.costs.get(spot, testDirection, s.level) >= TravelCost.BLOCKED) continue;
    if (refusedByDoor(door, dir)) continue;
    if (spot === s.gridNo) return { actionGridNo: spot, targetGridNo: g, direction: directionToward(s.gridNo, g) };
    offerSpot(t, s, spot, g, best);
  }
  if (best.gridNo === NOWHERE) return null;
  if (best.gridNo !== g) return { actionGridNo: best.gridNo, targetGridNo: g, direction: directionToward(best.gridNo, g) };
  const direction = door ? (door.wallOrientation & ORIENT_LEFT ? Direction.SOUTH : Direction.EAST) : s.direction;
  return { actionGridNo: g, targetGridNo: g, direction };
}

export function findAdjacentGridEx(t: TacticalState, s: Soldier, gIn: number, forceToPerson: boolean): MeleeApproach | null {
  let g = gIn;
  if (s.gridNo === g) return { actionGridNo: g, targetGridNo: g, direction: s.direction };
  let direction = s.direction;
  if (forceToPerson) {
    const person = forcedToPerson(t, g);
    if (person !== g) direction = directionToward(s.gridNo, person);
    g = person;
  }
  const best: Candidate = { distance: NO_PATH_DISTANCE, gridNo: NOWHERE };
  offerTarget(t, s, g, best);
  for (const dir of SIDE_DIRECTIONS) {
    const spot = newGridNo(g, DIRECTION_INCREMENT[dir] ?? 0);
    if (doorAdjustedCost(t, s, spot, t.world.costs.get(spot, dir, s.level)) >= TravelCost.BLOCKED) continue;
    if (spot === s.gridNo) return { actionGridNo: spot, targetGridNo: g, direction: directionToward(s.gridNo, g) };
    offerSpot(t, s, spot, g, best);
  }
  return approachTo(best, g, direction);
}

function blockedByOther(t: TacticalState, s: Soldier, g: number): boolean {
  const other = whoIsThere(t, g, s.level);
  return other !== null && other !== s;
}

export function findNextToAdjacentGridEx(t: TacticalState, s: Soldier, gIn: number, forceToPerson: boolean): MeleeApproach | null {
  let g = gIn;
  if (s.gridNo === g) return { actionGridNo: g, targetGridNo: g, direction: s.direction };
  if (forceToPerson) g = forcedToPerson(t, g);
  const best: Candidate = { distance: WORLD_MAX_DISTANCE, gridNo: NOWHERE };
  if (newOKDestination(t.pathEnv, s, g, true, s.level)) {
    const distance = walkCost(t, s, g);
    if (distance > 0 && distance < best.distance) {
      best.distance = distance;
      best.gridNo = g;
    }
  }
  const perceived = s.team === Team.OUR;
  for (const dir of SIDE_DIRECTIONS) {
    const first = newGridNo(g, DIRECTION_INCREMENT[dir] ?? 0);
    if (t.world.costs.get(first, dir, s.level) >= TravelCost.BLOCKED || blockedByOther(t, s, first)) continue;
    const spot = newGridNo(first, DIRECTION_INCREMENT[dir] ?? 0);
    const cost = t.world.costs.get(spot, dir, s.level);
    if (cost >= TravelCost.BLOCKED || doorAdjustedCost(t, s, spot, cost, perceived) === TravelCost.DOOR) continue;
    if (blockedByOther(t, s, spot)) continue;
    if (spot === s.gridNo) return { actionGridNo: spot, targetGridNo: g, direction: directionToward(s.gridNo, g) };
    offerSpot(t, s, spot, g, best);
  }
  return approachTo(best, g, s.direction);
}

export function bladeApproach(t: TacticalState, s: Soldier, g: number): MeleeApproach | null {
  if (s.bodyType === Body.BLOODCAT) return findNextToAdjacentGridEx(t, s, g, true);
  if (isCreatureOrBloodcat(s) && pythSpacesAway(s.gridNo, g) > 1)
    return findNextToAdjacentGridEx(t, s, g, true) ?? findAdjacentGridEx(t, s, g, true);
  return findAdjacentGridEx(t, s, g, true);
}

export function directPunchApproach(t: TacticalState, s: Soldier, tgt: Soldier, level: number): MeleeApproach | null {
  for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
    const spot = newGridNo(s.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
    const cost = t.world.costs.get(spot, dir, level);
    if (cost >= TravelCost.BLOCKED || doorAdjustedCost(t, s, spot, cost) >= TravelCost.BLOCKED) continue;
    if (whoIsThere(t, spot, s.level) === tgt) return { actionGridNo: spot, targetGridNo: tgt.gridNo, direction: dir };
  }
  return null;
}
