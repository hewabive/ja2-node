// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Campaign_Types.h SECTORINFO, UNDERGROUND_SECTORINFO; StrategicMap.h StrategicMapElement;
// @src src/game/Tactical/Tactical_Save.cc SetSectorFlag, ReSetSectorFlag, GetSectorFlagStatus,
// @src SetNumberOfVisibleWorldItemsInSectorStructureForSector; Queen_Command.cc FindUnderGroundSector;
// @src StrategicMap.cc GetMapFileName; Strategic_Movement_Costs.cc GetTraversability, SectorIsPassable;
// @src Strategic_Status.cc UpdateLastDayOfPlayerActivity.

import { StrategicMove, TRAVERSABILITY_DIRECTIONS } from '../../../content/strategic/map-tables.ts';
import { MAP_WORLD_CELLS, mapFileName, SECTOR_COUNT, type Sector, sameSector, sectorId } from '../../../content/strategic/sector-ids.ts';
import { u32 } from '../../../core/int.ts';
import { Facility, NEW_SECTORS_EQUAL_TO_ACTIVITY, SectorFlag } from '../forces/constants.ts';

export const Traversability = {
  TOWN: 0,
  ROAD: 1,
  PLAINS: 2,
  SAND: 3,
  SPARSE: 4,
  DENSE: 5,
  SWAMP: 6,
  WATER: 7,
  HILLS: 8,
  GROUNDBARRIER: 9,
  NS_RIVER: 10,
  EW_RIVER: 11,
  EDGEOFWORLD: 12,
} as const;

export const MILITIA_LEVELS = 3;
const TIXA: Sector = { x: 9, y: 10, z: 0 };
const GUN_RANGE: Sector = { x: 13, y: 8, z: 0 };
const GUN_RANGE_SECTORS: readonly Sector[] = [
  { x: 13, y: 8, z: 0 },
  { x: 14, y: 8, z: 0 },
  { x: 13, y: 9, z: 0 },
  { x: 14, y: 9, z: 0 },
];

export interface SectorInfo {
  flags: number;
  garrisonId: number;
  pendingReinforcements: number;
  militiaTrainingPaid: boolean;
  militiaTrainingPercentDone: number;
  militiaTrainingHundredths: number;
  numTroops: number;
  numElites: number;
  numAdmins: number;
  numCreatures: number;
  troopsInBattle: number;
  elitesInBattle: number;
  adminsInBattle: number;
  creaturesInBattle: number;
  dayOfLastCreatureAttack: number;
  facilities: number;
  traversability: number[];
  bloodCats: number;
  bloodCatPlacements: number;
  travelRating: number;
  militia: number[];
  timeLastLoaded: number;
  timeLastPlayerLiberated: number;
  surfaceWasEverPlayerControlled: boolean;
  visibleItems: number;
}

export interface MapElement {
  nameId: number;
  enemyControlled: boolean;
  enemyAirControlled: boolean;
  samCondition: number;
}

export interface UndergroundSector {
  flags: number;
  sector: Sector;
  numElites: number;
  numTroops: number;
  numAdmins: number;
  numCreatures: number;
  timeLastLoaded: number;
  adjacentSectors: number;
  creatureHabitat: number;
  elitesInBattle: number;
  troopsInBattle: number;
  adminsInBattle: number;
  creaturesInBattle: number;
  visibleItems: number;
}

export interface PlayerActivity {
  newSectorsVisitedToday: number;
  lastDayOfPlayerActivity: number;
  daysOfInactivity: number;
}

export interface StrategicMapState {
  sectors: SectorInfo[];
  elements: MapElement[];
  underground: UndergroundSector[];
  secretsFound: boolean[];
  selectedSector: Sector;
  activity: PlayerActivity;
}

export function createSectorInfo(): SectorInfo {
  return {
    flags: 0,
    garrisonId: 0,
    pendingReinforcements: 0,
    militiaTrainingPaid: false,
    militiaTrainingPercentDone: 0,
    militiaTrainingHundredths: 0,
    numTroops: 0,
    numElites: 0,
    numAdmins: 0,
    numCreatures: 0,
    troopsInBattle: 0,
    elitesInBattle: 0,
    adminsInBattle: 0,
    creaturesInBattle: 0,
    dayOfLastCreatureAttack: 0,
    facilities: 0,
    traversability: new Array<number>(TRAVERSABILITY_DIRECTIONS).fill(0),
    bloodCats: 0,
    bloodCatPlacements: 0,
    travelRating: 0,
    militia: new Array<number>(MILITIA_LEVELS).fill(0),
    timeLastLoaded: 0,
    timeLastPlayerLiberated: 0,
    surfaceWasEverPlayerControlled: false,
    visibleItems: 0,
  };
}

export function createMapElement(): MapElement {
  return { nameId: 0, enemyControlled: false, enemyAirControlled: false, samCondition: 0 };
}

export function createUndergroundSector(sector: Sector, adjacentSectors = 0): UndergroundSector {
  return {
    flags: 0,
    sector,
    numElites: 0,
    numTroops: 0,
    numAdmins: 0,
    numCreatures: 0,
    timeLastLoaded: 0,
    adjacentSectors,
    creatureHabitat: 0,
    elitesInBattle: 0,
    troopsInBattle: 0,
    adminsInBattle: 0,
    creaturesInBattle: 0,
    visibleItems: 0,
  };
}

export function createMapState(): StrategicMapState {
  return {
    sectors: Array.from({ length: SECTOR_COUNT }, createSectorInfo),
    elements: Array.from({ length: MAP_WORLD_CELLS }, createMapElement),
    underground: [],
    secretsFound: [],
    selectedSector: { x: 1, y: 1, z: 0 },
    activity: { newSectorsVisitedToday: 0, lastDayOfPlayerActivity: 0, daysOfInactivity: 0 },
  };
}

export function sectorInfo(map: StrategicMapState, s: { readonly x: number; readonly y: number }): SectorInfo {
  const info = map.sectors[sectorId(s)];
  if (!info) throw new RangeError(`no sector info for ${s.x},${s.y}`);
  return info;
}

export function findUndergroundSector(map: StrategicMapState, s: Sector): UndergroundSector | undefined {
  return map.underground.find((u) => sameSector(u.sector, s));
}

export function setVisibleItemCount(map: StrategicMapState, s: Sector, count: number): void {
  if (s.z === 0) {
    sectorInfo(map, s).visibleItems = count;
    return;
  }
  const u = findUndergroundSector(map, s);
  if (u) u.visibleItems = count;
}

export function getSectorFlags(map: StrategicMapState, s: Sector): number {
  if (s.z === 0) return sectorInfo(map, s).flags;
  return findUndergroundSector(map, s)?.flags ?? 0;
}

export function getSectorFlagStatus(map: StrategicMapState, s: Sector, flag: number): boolean {
  return (getSectorFlags(map, s) & flag) !== 0;
}

export function updateLastDayOfPlayerActivity(map: StrategicMapState, day: number): void {
  if (day <= map.activity.lastDayOfPlayerActivity) return;
  map.activity.lastDayOfPlayerActivity = day;
  map.activity.daysOfInactivity = 0;
}

export function setSectorFlag(map: StrategicMapState, s: Sector, flag: number, worldDay: number): void {
  if (flag === SectorFlag.ALREADY_VISITED) {
    if (sameSector(s, TIXA)) {
      const tixa = sectorInfo(map, TIXA);
      tixa.facilities = u32(tixa.facilities | Facility.PRISON);
    } else if (sameSector(s, GUN_RANGE)) {
      for (const g of GUN_RANGE_SECTORS) {
        const info = sectorInfo(map, g);
        info.facilities = u32(info.facilities | Facility.GUN_RANGE);
      }
    }
    if (!getSectorFlagStatus(map, s, SectorFlag.ALREADY_VISITED)) {
      map.activity.newSectorsVisitedToday = (map.activity.newSectorsVisitedToday + 1) & 0xff;
      if (map.activity.newSectorsVisitedToday === NEW_SECTORS_EQUAL_TO_ACTIVITY) updateLastDayOfPlayerActivity(map, worldDay);
    }
  }
  if (s.z === 0) {
    const info = sectorInfo(map, s);
    info.flags = u32(info.flags | flag);
    return;
  }
  const u = findUndergroundSector(map, s);
  if (u) u.flags = u32(u.flags | flag);
}

export function resetSectorFlag(map: StrategicMapState, s: Sector, flag: number): void {
  if (s.z === 0) {
    const info = sectorInfo(map, s);
    info.flags = u32(info.flags & ~flag);
    return;
  }
  const u = findUndergroundSector(map, s);
  if (u) u.flags = u32(u.flags & ~flag);
}

export function mapFileNameForSector(map: StrategicMapState, s: Sector): string {
  return mapFileName(s, getSectorFlagStatus(map, s, SectorFlag.USE_ALTERNATE_MAP));
}

export function traversabilityBetween(map: StrategicMapState, fromId: number, toId: number): number {
  const difference = toId - fromId;
  const direction =
    difference === -1
      ? StrategicMove.WEST
      : difference === 1
        ? StrategicMove.EAST
        : difference === 16
          ? StrategicMove.SOUTH
          : StrategicMove.NORTH;
  return map.sectors[fromId]?.traversability[direction] ?? Traversability.EDGEOFWORLD;
}

export function sectorIsPassable(map: StrategicMapState, id: number): boolean {
  const t = map.sectors[id]?.traversability[StrategicMove.THROUGH];
  return t !== Traversability.GROUNDBARRIER && t !== Traversability.EDGEOFWORLD;
}

export function isSectorDesert(map: StrategicMapState, s: { readonly x: number; readonly y: number }): boolean {
  return sectorInfo(map, s).traversability[StrategicMove.THROUGH] === Traversability.SAND;
}

export function totalMilitia(info: SectorInfo): number {
  return info.militia.reduce((n, m) => (n + m) & 0xff, 0);
}
