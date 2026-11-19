// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc PlotPathForCharacter, ClearPathAfterThisSectorForCharacter,
// @src CancelPathForCharacter, CopyPathToCharactersSquadIfInOne, IsTheCursorAllowedToHighLightThisSector;
// @src Strategic_Pathing.cc GetLastSectorIdInCharactersPath, GetSoldierGroup; MapScreen.cc (the plotting legs: each leg built
// @src from the last sector of the path so far, the temporary path to the cursor, CopyPathToAllSelectedCharacters);
// @src MapScreen.cc CancelPathsOfAllSelectedCharacters, MAP_EVENT_PLOT_PATH's SectorIsPassable, Strategic_Pathing.cc
// @src FindStratPath's SHIFT read at each leg, PlotPathForCharacter's underground message (2026-11-19); MapScreen.cc
// @src CopyPathToAllSelectedCharacters at each plotting click, RebuildWayPointsForAllSelectedCharsGroups (2026-11-19).

import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { isValidSector, type Sector, sameSector, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { appendStrategicPath, clearStrategicPathAfterSector, lastSectorOfPath } from '../map/pathing.ts';
import { sectorInfo, sectorIsPassable, Traversability } from '../map/sectors.ts';
import { Assignment } from './constants.ts';
import { type Group, getGroup, removeGroupWaypoints, requireMerc } from './groups.ts';
import type { TravelOrderWho } from './helicopter-events.ts';
import { buildAStrategicPath, type GroupPathOptions, rebuildWayPointsForGroupPath } from './movement.ts';
import type { StrategicContext, StrategicMerc } from './ports.ts';
import { copyPathOfCharacterToSquad } from './squads.ts';
import { cancelPathForVehicle, moveCharactersPathToVehicle, setUpMvtGroupForVehicle } from './vehicles.ts';

export const PathEdit = { ABORT_PLOTTING: 'abort', PATH_CLEARED: 'cleared', PATH_SHORTENED: 'shortened' } as const;
export type PathEdit = (typeof PathEdit)[keyof typeof PathEdit];

export function isTheCursorAllowedToHighLightThisSector(ctx: Pick<StrategicContext, 'state'>, s: Sector): boolean {
  return isValidSector(s) && sectorInfo(ctx.state.map, s).traversability[StrategicMove.THROUGH] !== Traversability.EDGEOFWORLD;
}

export function lastSectorInMercPath(m: StrategicMerc): number {
  return m.path.length > 0 ? (m.path[m.path.length - 1] ?? strategicIndex(m.sector)) : strategicIndex(m.sector);
}

export function lastSectorIdInCharactersPath(ctx: StrategicContext, m: StrategicMerc): number {
  return lastSectorOfPath(soldierMercPath(ctx, m), strategicIndex(m.sector));
}

function inOrIsVehicle(m: StrategicMerc): boolean {
  return m.assignment === Assignment.VEHICLE || m.isVehicle;
}

export function soldierGroup(ctx: StrategicContext, m: StrategicMerc): Group | undefined {
  if (inOrIsVehicle(m)) return getGroup(ctx, ctx.state.forces.vehicles[m.vehicleId]?.movementGroup ?? 0);
  return getGroup(ctx, m.groupId);
}

function travelOrderWho(m: StrategicMerc): TravelOrderWho {
  return m.assignment >= Assignment.ON_DUTY ? { kind: 'merc', soldier: m.id } : { kind: 'squad', squad: m.assignment };
}

function copyPathToCharactersSquadIfInOne(ctx: StrategicContext, m: StrategicMerc): void {
  if (m.assignment < Assignment.ON_DUTY) copyPathOfCharacterToSquad(ctx, m.id, m.assignment);
}

export function plotPathForCharacter(ctx: StrategicContext, id: number, dest: Sector, options: GroupPathOptions = {}): boolean {
  if (!isTheCursorAllowedToHighLightThisSector(ctx, dest)) return false;
  const m = requireMerc(ctx, id);
  if (m.assignment === Assignment.IN_TRANSIT) return false;
  if (m.sector.z !== 0) {
    ctx.helicopter.emit({ type: 'noTravelOrdersUnderground', who: travelOrderWho(m) });
    return false;
  }
  const vehicle = inOrIsVehicle(m);
  if (vehicle) setUpMvtGroupForVehicle(ctx, m);
  const g = soldierGroup(ctx, m);
  if (!g) return false;
  const section = buildAStrategicPath(ctx, lastSectorInMercPath(m), strategicIndex(dest), g, options);
  m.path = appendStrategicPath(section, m.path);
  if (vehicle) moveCharactersPathToVehicle(ctx, m);
  else copyPathToCharactersSquadIfInOne(ctx, m);
  return true;
}

export function soldierMercPath(ctx: StrategicContext, m: StrategicMerc): readonly number[] {
  if (inOrIsVehicle(m)) return ctx.state.forces.vehicles[m.vehicleId]?.path ?? [];
  return m.path;
}

export function confirmPathForCharacter(ctx: StrategicContext, id: number): void {
  const m = requireMerc(ctx, id);
  const g = soldierGroup(ctx, m);
  if (g) rebuildWayPointsForGroupPath(ctx, soldierMercPath(ctx, m), g);
}

export function cancelPathForCharacter(ctx: StrategicContext, id: number): void {
  const m = requireMerc(ctx, id);
  const g = getGroup(ctx, m.groupId);
  if (m.path.length > 0 && g) removeGroupWaypoints(g);
  m.path = [];
  if (g) rebuildWayPointsForGroupPath(ctx, null, g);
  const v = m.assignment === Assignment.VEHICLE ? ctx.state.forces.vehicles[m.vehicleId] : undefined;
  if (v?.valid) cancelPathForVehicle(ctx, v, true);
  copyPathToCharactersSquadIfInOne(ctx, m);
}

export function cancelPathOfCharacterWithRoute(ctx: StrategicContext, id: number): boolean {
  const m = requireMerc(ctx, id);
  if (soldierMercPath(ctx, m).length === 0) return false;
  const vehicle = m.isVehicle ? ctx.state.forces.vehicles[m.vehicleId] : undefined;
  if (vehicle) cancelPathForVehicle(ctx, vehicle, false);
  else cancelPathForCharacter(ctx, id);
  return true;
}

export function clearPathAfterThisSectorForCharacter(ctx: StrategicContext, id: number, s: Sector): PathEdit {
  const m = requireMerc(ctx, id);
  const original = soldierMercPath(ctx, m).length;
  if (!original) return PathEdit.ABORT_PLOTTING;
  if (sameSector(s, m.sector)) {
    cancelPathForCharacter(ctx, id);
    return PathEdit.PATH_CLEARED;
  }
  const v = inOrIsVehicle(m) ? ctx.state.forces.vehicles[m.vehicleId] : undefined;
  if (v) v.path = clearStrategicPathAfterSector(v.path, strategicIndex(s));
  else m.path = clearStrategicPathAfterSector(m.path, strategicIndex(s));
  if (soldierMercPath(ctx, m).length >= original) return PathEdit.ABORT_PLOTTING;
  copyPathToCharactersSquadIfInOne(ctx, m);
  return PathEdit.PATH_SHORTENED;
}

export const PlotRefusal = { BAD_SECTOR: 'badSector', NO_ROUTE: 'noRoute' } as const;
export type PlotRefusal = (typeof PlotRefusal)[keyof typeof PlotRefusal];

export interface PlottedLegs {
  readonly path: readonly number[];
  readonly vias: readonly (readonly number[])[];
  readonly temp: readonly number[] | null;
}

export type LegShortest = boolean | readonly boolean[];

export interface PlotLegOptions {
  readonly shortest?: LegShortest;
  readonly helicopter?: boolean;
}

export function legShortest(value: unknown): LegShortest {
  return Array.isArray(value) ? value.map((flag) => flag === true) : value === true;
}

function isLegShortest(shortest: LegShortest | undefined, leg: number): boolean {
  return Array.isArray(shortest) ? shortest[leg] === true : shortest === true;
}

export function canPlotLegTo(ctx: Pick<StrategicContext, 'state'>, s: Sector, helicopter = false): boolean {
  if (!isTheCursorAllowedToHighLightThisSector(ctx, s)) return false;
  return helicopter || sectorIsPassable(ctx.state.map, sectorId(s));
}

export function plotLegs(
  ctx: StrategicContext,
  g: Group,
  start: readonly number[],
  origin: number,
  via: readonly Sector[],
  to: Sector,
  options: PlotLegOptions = {},
): PlottedLegs | PlotRefusal {
  let path: readonly number[] = start;
  const vias: (readonly number[])[] = [];
  for (const [leg, sector] of via.entries()) {
    if (!canPlotLegTo(ctx, sector, options.helicopter)) return PlotRefusal.BAD_SECTOR;
    const direct = isLegShortest(options.shortest, leg);
    const section = buildAStrategicPath(ctx, lastSectorOfPath(path, origin), strategicIndex(sector), g, { direct });
    if (!section) return PlotRefusal.NO_ROUTE;
    path = appendStrategicPath(section, path);
    vias.push(path);
  }
  const direct = isLegShortest(options.shortest, via.length);
  const temp = isTheCursorAllowedToHighLightThisSector(ctx, to)
    ? buildAStrategicPath(ctx, lastSectorOfPath(path, origin), strategicIndex(to), g, { direct })
    : null;
  return { path, vias, temp };
}

export function plottedRoute(legs: PlottedLegs, origin: number, to: Sector): number[] | null {
  if (legs.temp) return appendStrategicPath(legs.temp, legs.path);
  return lastSectorOfPath(legs.path, origin) === strategicIndex(to) ? [...legs.path] : null;
}

export function pathAfterEachLeg(legs: PlottedLegs, origin: number, to: Sector): (readonly number[])[] | null {
  const route = plottedRoute(legs, origin, to);
  if (!route) return null;
  return legs.temp ? [...legs.vias, route] : [...legs.vias];
}

function sharesPathWith(plotter: StrategicMerc, m: StrategicMerc): boolean {
  if (inOrIsVehicle(plotter)) return inOrIsVehicle(m) && m.vehicleId === plotter.vehicleId;
  return m.id === plotter.id;
}

export function copyPathToAllSelectedCharacters(
  ctx: StrategicContext,
  plotter: StrategicMerc,
  selected: readonly number[],
  path: readonly number[],
): void {
  for (const id of selected) {
    const m = ctx.mercs.get(id);
    if (!m || sharesPathWith(plotter, m)) continue;
    if (!inOrIsVehicle(m)) m.path = [...path];
    else {
      const v = ctx.state.forces.vehicles[m.vehicleId];
      if (v) v.path = [...path];
    }
  }
}

function groupToRebuild(ctx: StrategicContext, plotter: StrategicMerc, m: StrategicMerc): { groupId: number; path: readonly number[] } {
  if (!inOrIsVehicle(m)) return { groupId: m.groupId, path: plotter.path };
  const v = ctx.state.forces.vehicles[m.vehicleId];
  return { groupId: v?.movementGroup ?? 0, path: v?.path ?? [] };
}

export function rebuildWayPointsForAllSelectedCharsGroups(
  ctx: StrategicContext,
  plotter: StrategicMerc,
  selected: readonly number[],
): void {
  const rebuilt = new Set<number>();
  for (const id of selected) {
    const m = ctx.mercs.get(id);
    if (!m) continue;
    const { groupId, path } = groupToRebuild(ctx, plotter, m);
    if (rebuilt.has(groupId)) continue;
    rebuilt.add(groupId);
    const g = getGroup(ctx, groupId);
    if (g) rebuildWayPointsForGroupPath(ctx, path, g);
  }
}

export function setPathForCharacter(ctx: StrategicContext, id: number, path: readonly number[]): void {
  const m = requireMerc(ctx, id);
  const vehicle = inOrIsVehicle(m);
  if (vehicle) setUpMvtGroupForVehicle(ctx, m);
  m.path = [...path];
  if (vehicle) moveCharactersPathToVehicle(ctx, m);
  else copyPathToCharactersSquadIfInOne(ctx, m);
}
