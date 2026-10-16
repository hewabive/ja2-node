// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc LoadStrategicInfoFromSavedFile; LoadSaveStrategicMapElement.cc;
// @src LoadSaveSectorInfo.cc; LoadSaveUndergroundSectorInfo.cc; Strategic_Movement.cc LoadStrategicMovementGroupsFromSavedGameFile,
// @src LoadPlayerGroupList, LoadEnemyGroupStructFromSavedGame, LoadWayPointList; Tactical/Vehicles.cc
// @src LoadVehicleInformationFromSavedGameFile; LoadSaveVehicleType.cc ExtractVehicleTypeFromFile. See docs/14 §4, docs/16 §1–§2.

import type { SaveCursor } from './savegame-cursor.ts';
import { field, type Layout, readLayout, skip } from './savegame-layout.ts';

const MAP_WORLD_CELLS = 18 * 18;
const SECTOR_INFO_COUNT = 256;
const TRAVERSABILITY_DIRECTIONS = 5;
const MILITIA_LEVELS = 3;
const GROUP_ID_MASK_BYTES = 32;
const MAX_PASSENGERS_IN_VEHICLE = 10;
const FIRST_VERSION_WITH_NO_PROFILE_PASSENGERS = 86;
const NO_PROFILE = 200;
const MERC_PATH_NODE_BYTES = 20;

const MAP_ELEMENT_LAYOUT: Layout = [
  skip(16),
  field('bNameId', 'i8'),
  field('fEnemyControlled', 'bool'),
  field('fEnemyAirControlled', 'bool'),
  skip(1),
  field('bSAMCondition', 'i8'),
  skip(20),
];

const SECTOR_INFO_LAYOUT: Layout = [
  field('uiFlags', 'u32'),
  skip(1),
  field('ubGarrisonID', 'u8'),
  field('ubPendingReinforcements', 'i8'),
  field('fMilitiaTrainingPaid', 'bool'),
  field('ubMilitiaTrainingPercentDone', 'u8'),
  field('ubMilitiaTrainingHundredths', 'u8'),
  skip(4),
  field('ubNumTroops', 'u8'),
  field('ubNumElites', 'u8'),
  field('ubNumAdmins', 'u8'),
  field('ubNumCreatures', 'u8'),
  field('ubTroopsInBattle', 'u8'),
  field('ubElitesInBattle', 'u8'),
  field('ubAdminsInBattle', 'u8'),
  field('ubCreaturesInBattle', 'u8'),
  skip(2),
  field('ubDayOfLastCreatureAttack', 'u32'),
  field('uiFacilitiesFlags', 'u32'),
  field('ubTraversability', 'u8', TRAVERSABILITY_DIRECTIONS),
  skip(2),
  field('bBloodCats', 'i8'),
  field('bBloodCatPlacements', 'i8'),
  skip(1),
  field('ubTravelRating', 'u8'),
  field('ubNumberOfCivsAtLevel', 'u8', MILITIA_LEVELS),
  skip(6),
  field('uiTimeCurrentSectorWasLastLoaded', 'u32'),
  skip(4),
  field('uiTimeLastPlayerLiberated', 'u32'),
  field('fSurfaceWasEverPlayerControlled', 'bool'),
  skip(3),
  field('uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer', 'u32'),
  skip(44),
];

const UNDERGROUND_LAYOUT: Layout = [
  field('uiFlags', 'u32'),
  field('x', 'u8'),
  field('y', 'u8'),
  field('z', 'u8'),
  field('ubNumElites', 'u8'),
  field('ubNumTroops', 'u8'),
  field('ubNumAdmins', 'u8'),
  field('ubNumCreatures', 'u8'),
  skip(5),
  field('uiTimeCurrentSectorWasLastLoaded', 'u32'),
  skip(4, 'next'),
  field('ubAdjacentSectors', 'u8'),
  field('ubCreatureHabitat', 'u8'),
  field('ubElitesInBattle', 'u8'),
  field('ubTroopsInBattle', 'u8'),
  field('ubAdminsInBattle', 'u8'),
  field('ubCreaturesInBattle', 'u8'),
  skip(2),
  field('uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer', 'u32'),
  skip(36),
];

export const GROUP_LAYOUT: Layout = [
  field('fDebugGroup', 'bool'),
  field('fPlayer', 'bool'),
  field('fVehicle', 'bool'),
  field('fPersistant', 'bool'),
  field('ubGroupID', 'u8'),
  field('ubGroupSize', 'u8'),
  field('ubSectorX', 'u8'),
  field('ubSectorY', 'u8'),
  field('ubSectorZ', 'u8'),
  field('ubNextX', 'u8'),
  field('ubNextY', 'u8'),
  field('ubPrevX', 'u8'),
  field('ubPrevY', 'u8'),
  field('ubOriginalSector', 'u8'),
  field('fBetweenSectors', 'bool'),
  field('ubMoveType', 'u8'),
  field('ubNextWaypointID', 'u8'),
  skip(3),
  field('uiArrivalTime', 'u32'),
  field('uiTraverseTime', 'u32'),
  skip(8),
  field('ubTransportationMask', 'u8'),
  skip(3),
  field('uiFlags', 'u32'),
  field('ubCreatedSectorID', 'u8'),
  field('ubSectorIDOfLastReassignment', 'u8'),
  skip(38),
];

const ENEMY_GROUP_LAYOUT: Layout = [
  field('ubNumTroops', 'u8'),
  field('ubNumElites', 'u8'),
  field('ubNumAdmins', 'u8'),
  skip(1),
  field('ubPendingReinforcements', 'u8'),
  field('ubAdminsInBattle', 'u8'),
  field('ubIntention', 'u8'),
  field('ubTroopsInBattle', 'u8'),
  field('ubElitesInBattle', 'u8'),
  skip(20),
];

const WAYPOINT_LAYOUT: Layout = [field('x', 'u8'), field('y', 'u8'), skip(6)];

const VEHICLE_LAYOUT: Layout = [
  skip(4, 'pMercPath'),
  field('ubMovementGroup', 'u8'),
  field('ubVehicleType', 'u8'),
  field('x', 'i16'),
  field('y', 'i16'),
  field('z', 'i16'),
  field('fBetweenSectors', 'bool'),
  skip(3),
  ...Array.from({ length: MAX_PASSENGERS_IN_VEHICLE }, (_, k) => [field(`passenger${k}`, 'u8'), skip(3)]).flat(),
  skip(61),
  field('fDestroyed', 'bool'),
  skip(2),
  field('uiMovementSoundID', 'u32'),
  skip(1),
  field('fValid', 'bool'),
  skip(2),
];

export interface SavedMapElement {
  readonly nameId: number;
  readonly enemyControlled: boolean;
  readonly enemyAirControlled: boolean;
  readonly samCondition: number;
}

export interface SavedSectorInfo {
  readonly flags: number;
  readonly garrisonId: number;
  readonly pendingReinforcements: number;
  readonly militiaTrainingPaid: boolean;
  readonly militiaTrainingPercentDone: number;
  readonly militiaTrainingHundredths: number;
  readonly numTroops: number;
  readonly numElites: number;
  readonly numAdmins: number;
  readonly numCreatures: number;
  readonly troopsInBattle: number;
  readonly elitesInBattle: number;
  readonly adminsInBattle: number;
  readonly creaturesInBattle: number;
  readonly dayOfLastCreatureAttack: number;
  readonly facilities: number;
  readonly traversability: readonly number[];
  readonly bloodCats: number;
  readonly bloodCatPlacements: number;
  readonly travelRating: number;
  readonly militia: readonly number[];
  readonly timeLastLoaded: number;
  readonly timeLastPlayerLiberated: number;
  readonly surfaceWasEverPlayerControlled: boolean;
  readonly visibleItems: number;
}

export interface StrategicInfo {
  readonly elements: readonly SavedMapElement[];
  readonly sectors: readonly SavedSectorInfo[];
  readonly ortaFound: boolean;
}

export interface SavedSector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface UndergroundSector {
  readonly sector: SavedSector;
  readonly flags: number;
  readonly numElites: number;
  readonly numTroops: number;
  readonly numAdmins: number;
  readonly numCreatures: number;
  readonly timeLastLoaded: number;
  readonly adjacentSectors: number;
  readonly creatureHabitat: number;
  readonly elitesInBattle: number;
  readonly troopsInBattle: number;
  readonly adminsInBattle: number;
  readonly creaturesInBattle: number;
  readonly visibleItems: number;
}

export interface SavedEnemyGroup {
  readonly numTroops: number;
  readonly numElites: number;
  readonly numAdmins: number;
  readonly pendingReinforcements: number;
  readonly adminsInBattle: number;
  readonly intention: number;
  readonly troopsInBattle: number;
  readonly elitesInBattle: number;
}

export interface StrategicGroup {
  readonly id: number;
  readonly debug: boolean;
  readonly player: boolean;
  readonly vehicle: boolean;
  readonly persistent: boolean;
  readonly size: number;
  readonly sector: SavedSector;
  readonly next: { readonly x: number; readonly y: number };
  readonly prev: { readonly x: number; readonly y: number };
  readonly originalSector: number;
  readonly betweenSectors: boolean;
  readonly moveType: number;
  readonly nextWaypointId: number;
  readonly arrivalTime: number;
  readonly traverseTime: number;
  readonly transportMask: number;
  readonly flags: number;
  readonly createdSectorId: number;
  readonly sectorIdOfLastReassignment: number;
  readonly playerProfiles: readonly number[];
  readonly enemy: SavedEnemyGroup | null;
  readonly waypoints: readonly { readonly x: number; readonly y: number }[];
}

export interface SavedVehicle {
  readonly slot: number;
  readonly valid: boolean;
  readonly movementGroup: number;
  readonly type: number;
  readonly sector: SavedSector;
  readonly betweenSectors: boolean;
  readonly passengerProfiles: readonly number[];
  readonly passengerSlots: readonly (number | null)[];
  readonly destroyed: boolean;
  readonly path: readonly number[];
}

export function readMercPath(c: SaveCursor): number[] {
  const nodes = c.u32();
  return Array.from({ length: nodes }, () => {
    const sectorId = c.u32();
    c.skip(MERC_PATH_NODE_BYTES - 4);
    return sectorId;
  });
}

export function readStrategicInfo(c: SaveCursor): StrategicInfo {
  const elements = Array.from({ length: MAP_WORLD_CELLS }, () => {
    const r = readLayout(c, MAP_ELEMENT_LAYOUT, false, 'StrategicMapElement');
    return {
      nameId: r.num('bNameId'),
      enemyControlled: r.bool('fEnemyControlled'),
      enemyAirControlled: r.bool('fEnemyAirControlled'),
      samCondition: r.num('bSAMCondition'),
    };
  });
  const sectors = Array.from({ length: SECTOR_INFO_COUNT }, () => {
    const r = readLayout(c, SECTOR_INFO_LAYOUT, false, 'SECTORINFO');
    return {
      flags: r.num('uiFlags'),
      garrisonId: r.num('ubGarrisonID'),
      pendingReinforcements: r.num('ubPendingReinforcements'),
      militiaTrainingPaid: r.bool('fMilitiaTrainingPaid'),
      militiaTrainingPercentDone: r.num('ubMilitiaTrainingPercentDone'),
      militiaTrainingHundredths: r.num('ubMilitiaTrainingHundredths'),
      numTroops: r.num('ubNumTroops'),
      numElites: r.num('ubNumElites'),
      numAdmins: r.num('ubNumAdmins'),
      numCreatures: r.num('ubNumCreatures'),
      troopsInBattle: r.num('ubTroopsInBattle'),
      elitesInBattle: r.num('ubElitesInBattle'),
      adminsInBattle: r.num('ubAdminsInBattle'),
      creaturesInBattle: r.num('ubCreaturesInBattle'),
      dayOfLastCreatureAttack: r.num('ubDayOfLastCreatureAttack'),
      facilities: r.num('uiFacilitiesFlags'),
      traversability: r.nums('ubTraversability'),
      bloodCats: r.num('bBloodCats'),
      bloodCatPlacements: r.num('bBloodCatPlacements'),
      travelRating: r.num('ubTravelRating'),
      militia: r.nums('ubNumberOfCivsAtLevel'),
      timeLastLoaded: r.num('uiTimeCurrentSectorWasLastLoaded'),
      timeLastPlayerLiberated: r.num('uiTimeLastPlayerLiberated'),
      surfaceWasEverPlayerControlled: r.bool('fSurfaceWasEverPlayerControlled'),
      visibleItems: r.num('uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer'),
    };
  });
  c.skip(MAP_WORLD_CELLS);
  return { elements, sectors, ortaFound: c.bool() };
}

export function readUndergroundSectors(c: SaveCursor): UndergroundSector[] {
  const count = c.u32();
  return Array.from({ length: count }, () => {
    const r = readLayout(c, UNDERGROUND_LAYOUT, false, 'UNDERGROUND_SECTORINFO');
    return {
      sector: { x: r.num('x'), y: r.num('y'), z: r.num('z') },
      flags: r.num('uiFlags'),
      numElites: r.num('ubNumElites'),
      numTroops: r.num('ubNumTroops'),
      numAdmins: r.num('ubNumAdmins'),
      numCreatures: r.num('ubNumCreatures'),
      timeLastLoaded: r.num('uiTimeCurrentSectorWasLastLoaded'),
      adjacentSectors: r.num('ubAdjacentSectors'),
      creatureHabitat: r.num('ubCreatureHabitat'),
      elitesInBattle: r.num('ubElitesInBattle'),
      troopsInBattle: r.num('ubTroopsInBattle'),
      adminsInBattle: r.num('ubAdminsInBattle'),
      creaturesInBattle: r.num('ubCreaturesInBattle'),
      visibleItems: r.num('uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer'),
    };
  });
}

function readEnemyGroup(c: SaveCursor): SavedEnemyGroup {
  const r = readLayout(c, ENEMY_GROUP_LAYOUT, false, 'ENEMYGROUP');
  return {
    numTroops: r.num('ubNumTroops'),
    numElites: r.num('ubNumElites'),
    numAdmins: r.num('ubNumAdmins'),
    pendingReinforcements: r.num('ubPendingReinforcements'),
    adminsInBattle: r.num('ubAdminsInBattle'),
    intention: r.num('ubIntention'),
    troopsInBattle: r.num('ubTroopsInBattle'),
    elitesInBattle: r.num('ubElitesInBattle'),
  };
}

export function readGroups(c: SaveCursor): StrategicGroup[] {
  const count = c.u32();
  const groups: StrategicGroup[] = [];
  for (let i = 0; i < count; i++) {
    const r = readLayout(c, GROUP_LAYOUT, false, 'GROUP');
    const player = r.bool('fPlayer');
    const size = r.num('ubGroupSize');
    const playerProfiles: number[] = [];
    if (player && size > 0) playerProfiles.push(...c.u32s(c.u32()));
    const enemy = player ? null : readEnemyGroup(c);
    const waypoints = Array.from({ length: c.u32() }, () => {
      const w = readLayout(c, WAYPOINT_LAYOUT, false, 'WAYPOINT');
      return { x: w.num('x'), y: w.num('y') };
    });
    groups.push({
      id: r.num('ubGroupID'),
      debug: r.bool('fDebugGroup'),
      player,
      vehicle: r.bool('fVehicle'),
      persistent: r.bool('fPersistant'),
      size,
      sector: { x: r.num('ubSectorX'), y: r.num('ubSectorY'), z: r.num('ubSectorZ') },
      next: { x: r.num('ubNextX'), y: r.num('ubNextY') },
      prev: { x: r.num('ubPrevX'), y: r.num('ubPrevY') },
      originalSector: r.num('ubOriginalSector'),
      betweenSectors: r.bool('fBetweenSectors'),
      moveType: r.num('ubMoveType'),
      nextWaypointId: r.num('ubNextWaypointID'),
      arrivalTime: r.num('uiArrivalTime'),
      traverseTime: r.num('uiTraverseTime'),
      transportMask: r.num('ubTransportationMask'),
      flags: r.num('uiFlags'),
      createdSectorId: r.num('ubCreatedSectorID'),
      sectorIdOfLastReassignment: r.num('ubSectorIDOfLastReassignment'),
      playerProfiles,
      enemy,
      waypoints,
    });
  }
  c.skip(GROUP_ID_MASK_BYTES);
  return groups;
}

export function readVehicles(c: SaveCursor, version: number): SavedVehicle[] {
  const count = c.u8();
  const noone = version < FIRST_VERSION_WITH_NO_PROFILE_PASSENGERS ? 0 : NO_PROFILE;
  const vehicles: SavedVehicle[] = [];
  for (let slot = 0; slot < count; slot++) {
    if (!c.bool()) {
      vehicles.push({
        slot,
        valid: false,
        movementGroup: 0,
        type: 0,
        sector: { x: 0, y: 0, z: 0 },
        betweenSectors: false,
        passengerProfiles: [],
        passengerSlots: [],
        destroyed: false,
        path: [],
      });
      continue;
    }
    const r = readLayout(c, VEHICLE_LAYOUT, false, 'VEHICLETYPE');
    const passengerSlots = Array.from({ length: MAX_PASSENGERS_IN_VEHICLE }, (_, k) => r.num(`passenger${k}`)).map((p) =>
      p === noone ? null : p,
    );
    const passengerProfiles = passengerSlots.filter((p): p is number => p !== null);
    vehicles.push({
      slot,
      valid: true,
      movementGroup: r.num('ubMovementGroup'),
      type: r.num('ubVehicleType'),
      sector: { x: r.num('x'), y: r.num('y'), z: r.num('z') },
      betweenSectors: r.bool('fBetweenSectors'),
      passengerProfiles,
      passengerSlots,
      destroyed: r.bool('fDestroyed'),
      path: readMercPath(c),
    });
  }
  return vehicles;
}
