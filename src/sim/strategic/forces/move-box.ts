// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc SetUpMovingListsForSector (who the move box lists),
// @src HandleMoveoutOfSectorMovementTroops (mercs parting from their squad or vehicle join a compatible squad or a new
// @src one), FindSquadThatSoldierCanJoin, HandleSettingTheSelectedListOfMercs (the first moving merc plots),
// @src DeselectSelectedListMercsWhoCantMoveWithThisGuy, CanSoldierMoveWithVehicleId.

import { type Sector, sameSector } from '../../../content/strategic/sector-ids.ts';
import { OKLIFE } from '../../tactical/soldier.ts';
import { Assignment, NUMBER_OF_SQUADS } from './constants.ts';
import type { StrategicContext, StrategicMerc } from './ports.ts';
import { addCharacterToSquad, addCharacterToUniqueSquad, isThisSquadFull, sectorSquadIsIn } from './squads.ts';
import { findVehicle, inHelicopter } from './vehicles.ts';

export interface MoveBoxSelection {
  readonly soldiers: ReadonlySet<number>;
  readonly squads: ReadonlySet<number>;
  readonly vehicles: ReadonlySet<number>;
}

export interface Regrouped {
  readonly soldier: number;
  readonly squad: number;
}

export interface MoveOut {
  readonly selected: readonly number[];
  readonly regrouped: readonly Regrouped[];
}

export function movingListForSector(ctx: StrategicContext, sector: Sector): StrategicMerc[] {
  return ctx.mercs
    .all()
    .filter(
      (m) =>
        m.assignment !== Assignment.IN_TRANSIT &&
        m.assignment !== Assignment.ASSIGNMENT_POW &&
        sameSector(m.sector, sector) &&
        !m.isVehicle &&
        m.life >= OKLIFE &&
        !inHelicopter(ctx, m),
    );
}

export function squadsOfList(list: readonly StrategicMerc[]): number[] {
  return [...new Set(list.filter((m) => m.assignment < Assignment.ON_DUTY).map((m) => m.assignment))];
}

function onSquad(m: StrategicMerc): boolean {
  return m.assignment < Assignment.ON_DUTY;
}

function partsWithUnit(m: StrategicMerc, moving: boolean, squads: ReadonlySet<number>, vehicles: ReadonlySet<number>): boolean {
  if (onSquad(m)) return moving !== squads.has(m.assignment);
  if (m.assignment === Assignment.VEHICLE) return moving !== vehicles.has(m.vehicleId);
  return moving;
}

function squadInSector(ctx: StrategicContext, q: number, sector: Sector): boolean {
  const at = sectorSquadIsIn(ctx, q);
  return at !== null && sameSector(at, sector);
}

function findSquadThatSoldierCanJoin(ctx: StrategicContext, m: StrategicMerc, moving: boolean, squads: ReadonlySet<number>): number {
  for (let q = 0; q < NUMBER_OF_SQUADS; q++)
    if (squadInSector(ctx, q, m.sector) && !isThisSquadFull(ctx, q) && squads.has(q) === moving) return q;
  return -1;
}

export function regroupsMovingMerc(list: readonly StrategicMerc[], selection: MoveBoxSelection): StrategicMerc | null {
  return list.find((m) => m.betweenSectors && partsWithUnit(m, selection.soldiers.has(m.id), selection.squads, selection.vehicles)) ?? null;
}

export function moveOutOfSector(ctx: StrategicContext, list: readonly StrategicMerc[], selection: MoveBoxSelection): MoveOut {
  const moving = new Set(selection.soldiers);
  const squads = new Set(selection.squads);
  const regrouped: Regrouped[] = [];
  for (const m of list) {
    const goes = moving.has(m.id);
    if (!partsWithUnit(m, goes, squads, selection.vehicles)) continue;
    const q = findSquadThatSoldierCanJoin(ctx, m, goes, squads);
    if (q !== -1) {
      if (addCharacterToSquad(ctx, m.id, q)) regrouped.push({ soldier: m.id, squad: q });
      else if (goes) moving.delete(m.id);
      else moving.add(m.id);
      continue;
    }
    const fresh = addCharacterToUniqueSquad(ctx, m.id);
    regrouped.push({ soldier: m.id, squad: fresh });
    if (goes) squads.add(fresh);
  }
  return { selected: list.filter((m) => moving.has(m.id)).map((m) => m.id), regrouped };
}

function vehicleIdOf(m: StrategicMerc): number | null {
  return m.assignment === Assignment.VEHICLE ? m.vehicleId : null;
}

function canSoldierMoveWithVehicleId(ctx: StrategicContext, m: StrategicMerc, vehicle: number): boolean {
  const own = vehicleIdOf(m);
  if (own === null) return false;
  if (own === vehicle) return true;
  const heli = ctx.state.forces.helicopterVehicleId;
  if (own === heli || vehicle === heli) return false;
  const a = findVehicle(ctx, vehicle);
  const b = findVehicle(ctx, own);
  return a !== null && b !== null && sameSector(a.sector, b.sector) && !a.betweenSectors && !b.betweenSectors;
}

function movesWith(ctx: StrategicContext, anchor: StrategicMerc, other: StrategicMerc): boolean {
  const anchorVehicle = vehicleIdOf(anchor);
  if (anchorVehicle !== null) return canSoldierMoveWithVehicleId(ctx, other, anchorVehicle);
  const otherVehicle = vehicleIdOf(other);
  if (otherVehicle !== null) return canSoldierMoveWithVehicleId(ctx, anchor, otherVehicle);
  if (!onSquad(other)) return false;
  if (!sameSector(anchor.sector, other.sector)) return false;
  return !((anchor.betweenSectors || other.betweenSectors) && anchor.groupId !== other.groupId);
}

export function travellersWith(ctx: StrategicContext, anchor: StrategicMerc, selected: readonly number[]): number[] {
  return selected.filter((id) => {
    if (id === anchor.id) return true;
    const other = ctx.mercs.get(id);
    return other !== undefined && movesWith(ctx, anchor, other);
  });
}
