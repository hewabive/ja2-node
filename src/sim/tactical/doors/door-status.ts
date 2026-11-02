// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Keys.h DOOR_STATUS; Keys.cc ModifyDoorStatus, GetDoorStatus, IsCloseEnoughAndHasLOS,
// @src AllMercsLookForDoor, MercLooksForDoors, InternalIsPerceivedDifferentThanReality, InternalUpdateDoorsPerceivedValue,
// @src InternalUpdateDoorGraphicFromStatus (the graphic as an open or a closed door), UpdateDoorGraphicsFromStatus,
// @src SynchronizeDoorStatusToStructureData, SaveDoorStatusArrayToDoorStatusTempFile, LoadDoorStatusArrayFromDoorStatusTempFile.

import { DIRECTION_INCREMENT, Direction, newGridNo, pythSpacesAway } from '../../../content/world/grid.ts';
import { recompileLocalMovementCosts } from '../../../content/world/movement-costs.ts';
import { has, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { u8 } from '../../../core/int.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { swapStructureForPartner } from '../doors.ts';
import type { DoorStatus } from '../pathfinding.ts';
import { distanceVisible } from '../perception/sight.ts';
import { OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';

export interface DoorStatusEntry extends DoorStatus {
  open: boolean;
  perceivedOpen: boolean;
  perceivedNotSet: boolean;
  busy: boolean;
  shownOpen: boolean;
}

export interface StoredDoorStatus {
  readonly gridNo: number;
  readonly open: boolean;
  readonly perceivedOpen: boolean;
  readonly perceivedNotSet: boolean;
}

const DIRECTION_IRRELEVANT = -1;
const GROUND_LEVEL = 0;
const NO_CUBE_LEVEL = 0;
const LOOK_DIRECTIONS = [
  Direction.NORTH,
  Direction.SOUTH,
  Direction.EAST,
  Direction.WEST,
  Direction.NORTHEAST,
  Direction.NORTHWEST,
  Direction.SOUTHEAST,
  Direction.SOUTHWEST,
] as const;

export function doorBaseGridNo(t: TacticalState, gridNo: number): number | null {
  const door = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  if (!door) return null;
  return t.world.structures.findBase(door)?.gridNo ?? null;
}

export function doorStatusAt(t: TacticalState, gridNo: number): DoorStatusEntry | null {
  if (t.doorStatus.size === 0) return null;
  const base = doorBaseGridNo(t, gridNo);
  return base === null ? null : (t.doorStatus.get(base) ?? null);
}

export function isDoorBusy(t: TacticalState, gridNo: number): boolean {
  return doorStatusAt(t, gridNo)?.busy === true;
}

function doorStructureOpen(t: TacticalState, base: number): boolean | null {
  const door = t.world.structures.find(base, StructureFlags.ANYDOOR);
  return door ? (door.flags & StructureFlags.OPEN) !== 0 : null;
}

export function shownDoorOpen(t: TacticalState, base: number): boolean {
  return t.doorStatus.get(base)?.shownOpen ?? doorStructureOpen(t, base) === true;
}

export function setDoorStatusOpen(t: TacticalState, base: number, open: boolean): DoorStatusEntry {
  const known = t.doorStatus.get(base);
  if (known) {
    known.open = open;
    return known;
  }
  const added: DoorStatusEntry = { open, perceivedOpen: false, perceivedNotSet: true, busy: false, shownOpen: shownDoorOpen(t, base) };
  t.doorStatus.set(base, added);
  return added;
}

export function modifyDoorStatus(t: TacticalState, gridNo: number, open: boolean): void {
  const base = doorBaseGridNo(t, gridNo);
  if (base !== null) setDoorStatusOpen(t, base, open);
}

export function storedDoorStatuses(t: TacticalState): StoredDoorStatus[] {
  return [...t.doorStatus].map(([gridNo, s]) => ({
    gridNo,
    open: s.open,
    perceivedOpen: s.perceivedOpen,
    perceivedNotSet: s.perceivedNotSet,
  }));
}

export function loadDoorStatusArray(t: TacticalState, stored: readonly StoredDoorStatus[]): void {
  t.doorStatus.clear();
  for (const d of stored) {
    const shownOpen = doorStructureOpen(t, d.gridNo) === true;
    t.doorStatus.set(d.gridNo, {
      open: d.open,
      perceivedOpen: d.perceivedOpen,
      perceivedNotSet: d.perceivedNotSet,
      busy: false,
      shownOpen,
    });
  }
  updateDoorGraphicsFromStatus(t);
}

export function perceiveDoor(status: DoorStatusEntry, open: boolean): void {
  status.perceivedOpen = open;
  status.perceivedNotSet = false;
}

function seesTile(t: TacticalState, s: Soldier, g: number, range: number): boolean {
  return pythSpacesAway(s.gridNo, g) <= range && soldierTo3DLocationLos(t, s, g, GROUND_LEVEL, NO_CUBE_LEVEL, u8(range), true) !== 0;
}

function sightRange(t: TacticalState, s: Soldier, g: number): number {
  return distanceVisible(t, s, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, GROUND_LEVEL);
}

function adjacentTile(g: number, direction: number): number {
  return newGridNo(g, DIRECTION_INCREMENT[direction] ?? 0);
}

function mercSeesDoorOrAround(t: TacticalState, s: Soldier, g: number): boolean {
  if (seesTile(t, s, g, sightRange(t, s, g))) return true;
  return LOOK_DIRECTIONS.some((d) => {
    const next = adjacentTile(g, d);
    return seesTile(t, s, next, sightRange(t, s, next));
  });
}

export function allMercsLookForDoor(t: TacticalState, gridNo: number): boolean {
  if (!doorStatusAt(t, gridNo)) return false;
  return teamMembers(t, Team.OUR).some((s) => s.life >= OKLIFE && mercSeesDoorOrAround(t, s, gridNo));
}

function perceivedDifferentThanReality(status: DoorStatusEntry): boolean {
  return status.perceivedNotSet || status.open !== status.perceivedOpen;
}

function seesDoorWithItsRange(t: TacticalState, s: Soldier, base: number): boolean {
  const range = sightRange(t, s, base);
  return seesTile(t, s, base, range) || LOOK_DIRECTIONS.some((d) => seesTile(t, s, adjacentTile(base, d), range));
}

function swapDoorStructure(t: TacticalState, door: StructureInstance): void {
  const base = t.world.structures.findBase(door);
  if (!base) return;
  swapStructureForPartner(t, base);
  recompileLocalMovementCosts(t.world.costs, t.world, base.gridNo);
}

function updateDoorGraphicFromStatus(t: TacticalState, base: number, status: DoorStatusEntry): void {
  const door = t.world.structures.find(base, StructureFlags.ANYDOOR);
  if (!door) return;
  const wantOpen = status.perceivedOpen;
  if (has(door.flags, StructureFlags.OPEN) === wantOpen) {
    status.shownOpen = wantOpen;
    return;
  }
  if (status.shownOpen === wantOpen) return;
  status.shownOpen = wantOpen;
  swapDoorStructure(t, door);
}

function synchronizeDoorStatusToStructureData(t: TacticalState, base: number, status: DoorStatusEntry): void {
  const door = t.world.structures.find(base, StructureFlags.ANYDOOR);
  if (door && has(door.flags, StructureFlags.OPEN) !== status.open) swapDoorStructure(t, door);
}

export function mercLooksForDoors(t: TacticalState, s: Soldier): void {
  for (const [base, status] of t.doorStatus) {
    if (!perceivedDifferentThanReality(status)) continue;
    if (!seesDoorWithItsRange(t, s, base)) continue;
    perceiveDoor(status, status.open);
    updateDoorGraphicFromStatus(t, base, status);
    return;
  }
}

export function updateDoorGraphicsFromStatus(t: TacticalState): void {
  for (const [base, status] of t.doorStatus) {
    synchronizeDoorStatusToStructureData(t, base, status);
    updateDoorGraphicFromStatus(t, base, status);
  }
}

export function clearDoorBusy(t: TacticalState, base: number): void {
  const status = t.doorStatus.get(base);
  if (status) status.busy = false;
}
