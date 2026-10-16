// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc PlotPathForCharacter, ClearPathAfterThisSectorForCharacter,
// @src CancelPathForCharacter, CopyPathToCharactersSquadIfInOne, IsTheCursorAllowedToHighLightThisSector;
// @src Strategic_Pathing.cc GetLastSectorIdInCharactersPath, GetSoldierGroup. See docs/16 §3.1, §3.3.

import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { isValidSector, type Sector, sameSector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { appendStrategicPath, clearStrategicPathAfterSector } from '../map/pathing.ts';
import { sectorInfo, Traversability } from '../map/sectors.ts';
import { Assignment } from './constants.ts';
import { type Group, getGroup, removeGroupWaypoints, requireMerc } from './groups.ts';
import { buildAStrategicPath, type GroupPathOptions, rebuildWayPointsForGroupPath } from './movement.ts';
import type { StrategicContext, StrategicMerc } from './ports.ts';
import { copyPathOfCharacterToSquad } from './squads.ts';

export const PathEdit = { ABORT_PLOTTING: 'abort', PATH_CLEARED: 'cleared', PATH_SHORTENED: 'shortened' } as const;
export type PathEdit = (typeof PathEdit)[keyof typeof PathEdit];

export function isTheCursorAllowedToHighLightThisSector(ctx: StrategicContext, s: Sector): boolean {
  return isValidSector(s) && sectorInfo(ctx.state.map, s).traversability[StrategicMove.THROUGH] !== Traversability.EDGEOFWORLD;
}

export function lastSectorInMercPath(m: StrategicMerc): number {
  return m.path.length > 0 ? (m.path[m.path.length - 1] ?? strategicIndex(m.sector)) : strategicIndex(m.sector);
}

function inOrIsVehicle(m: StrategicMerc): boolean {
  return m.assignment === Assignment.VEHICLE || m.isVehicle;
}

export function soldierGroup(ctx: StrategicContext, m: StrategicMerc): Group | undefined {
  if (inOrIsVehicle(m)) return getGroup(ctx, ctx.state.forces.vehicles[m.vehicleId]?.movementGroup ?? 0);
  return getGroup(ctx, m.groupId);
}

function copyPathToCharactersSquadIfInOne(ctx: StrategicContext, m: StrategicMerc): void {
  if (m.assignment < Assignment.ON_DUTY) copyPathOfCharacterToSquad(ctx, m.id, m.assignment);
}

export function plotPathForCharacter(ctx: StrategicContext, id: number, dest: Sector, options: GroupPathOptions = {}): boolean {
  if (!isTheCursorAllowedToHighLightThisSector(ctx, dest)) return false;
  const m = requireMerc(ctx, id);
  if (m.assignment === Assignment.IN_TRANSIT || m.sector.z !== 0 || inOrIsVehicle(m)) return false;
  const g = soldierGroup(ctx, m);
  if (!g) return false;
  const section = buildAStrategicPath(ctx, lastSectorInMercPath(m), strategicIndex(dest), g, options);
  m.path = appendStrategicPath(section, m.path);
  copyPathToCharactersSquadIfInOne(ctx, m);
  return true;
}

export function confirmPathForCharacter(ctx: StrategicContext, id: number): void {
  const m = requireMerc(ctx, id);
  const g = soldierGroup(ctx, m);
  if (g) rebuildWayPointsForGroupPath(ctx, m.path, g);
}

export function cancelPathForCharacter(ctx: StrategicContext, id: number): void {
  const m = requireMerc(ctx, id);
  const g = getGroup(ctx, m.groupId);
  if (m.path.length > 0 && g) removeGroupWaypoints(g);
  m.path = [];
  if (g) rebuildWayPointsForGroupPath(ctx, null, g);
  copyPathToCharactersSquadIfInOne(ctx, m);
}

export function clearPathAfterThisSectorForCharacter(ctx: StrategicContext, id: number, s: Sector): PathEdit {
  const m = requireMerc(ctx, id);
  const original = m.path.length;
  if (!original) return PathEdit.ABORT_PLOTTING;
  if (sameSector(s, m.sector)) {
    cancelPathForCharacter(ctx, id);
    return PathEdit.PATH_CLEARED;
  }
  if (!inOrIsVehicle(m)) m.path = clearStrategicPathAfterSector(m.path, strategicIndex(s));
  if (m.path.length >= original) return PathEdit.ABORT_PLOTTING;
  copyPathToCharactersSquadIfInOne(ctx, m);
  return PathEdit.PATH_SHORTENED;
}
