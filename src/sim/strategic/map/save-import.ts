// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (strategic info, underground, squads, groups, vehicles, general info);
// @src Strategic_Movement.cc LoadStrategicMovementGroupsFromSavedGameFile, LoadPlayerGroupList; Tactical/Squads.cc
// @src LoadSquadInfoFromSavedGameFile; StrategicMap_Secrets.cc; Tactical/Vehicles.cc; TileEngine/SaveLoadMap.cc
// @src LoadAllMapChangesFromMapTempFileAndApplyThem (flag reset); LoadGeneralInfo (the helicopter globals). See docs/14 §4, docs/16 §2.1.

import type { SaveGame, StrategicGroup } from '../../../content/formats/savegame.ts';
import type { SavedHelicopter } from '../../../content/formats/savegame-tactical.ts';
import { MapModificationType } from '../../../content/formats/savegame-temp-files.ts';
import { isValidSector, type Sector } from '../../../content/strategic/sector-ids.ts';
import { NUMBER_OF_SQUADS, SectorFlag } from '../forces/constants.ts';
import { emptyPassengerSlots, type Group, type VehicleRecord } from '../forces/groups.ts';
import { type HelicopterState, REFUEL_SITES } from '../forces/helicopter-state.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { type MapElement, resetSectorFlag, type SectorInfo, type UndergroundSector } from './sectors.ts';

const PLAYER_TEAM = 0;
const MAP_CHANGES_WRITTEN_BACK_ON_LOAD: ReadonlySet<number> = new Set([
  MapModificationType.OBJECT,
  MapModificationType.STRUCT,
  MapModificationType.REMOVE_STRUCT,
  MapModificationType.EXIT_GRIDS,
  MapModificationType.WINDOW_HIT,
]);
const SOLDIER_VEHICLE_FLAG = 0x00008000;

function playerSoldierByProfile(save: SaveGame): Map<number, { id: number; groupId: number }> {
  const byProfile = new Map<number, { id: number; groupId: number }>();
  for (const { soldier } of save.soldiers) {
    if (soldier.team === PLAYER_TEAM && !byProfile.has(soldier.profile))
      byProfile.set(soldier.profile, { id: soldier.id, groupId: soldier.groupId });
  }
  return byProfile;
}

function importGroup(g: StrategicGroup, members: number[]): Group {
  return {
    id: g.id,
    debug: g.debug,
    player: g.player,
    vehicle: g.vehicle,
    persistent: g.persistent,
    size: g.player && g.size ? members.length : g.size,
    sector: { ...g.sector },
    next: { x: g.next.x, y: g.next.y, z: 0 },
    prev: { x: g.prev.x, y: g.prev.y, z: 0 },
    originalSector: g.originalSector,
    createdSectorId: g.createdSectorId,
    sectorIdOfLastReassignment: g.sectorIdOfLastReassignment,
    betweenSectors: g.betweenSectors,
    moveType: g.moveType,
    nextWaypointId: g.nextWaypointId,
    arrivalTime: g.arrivalTime,
    traverseTime: g.traverseTime,
    waypoints: g.waypoints.map((w) => ({ x: w.x, y: w.y, z: 0 })),
    transportMask: g.transportMask,
    flags: g.flags,
    members,
    enemy: g.enemy ? { ...g.enemy } : null,
  };
}

function importSectors(save: SaveGame): SectorInfo[] {
  return save.strategicInfo.sectors.map((s) => ({ ...s, traversability: [...s.traversability], militia: [...s.militia] }));
}

function importElements(save: SaveGame): MapElement[] {
  return save.strategicInfo.elements.map((e) => ({ ...e }));
}

function importUnderground(save: SaveGame): UndergroundSector[] {
  return save.undergroundSectors.map((u) => ({ ...u, sector: { ...u.sector } }));
}

function importSecrets(ctx: StrategicContext, save: SaveGame): boolean[] {
  const plain = [save.generalInfo.foundTixa, save.strategicInfo.ortaFound];
  let plainIndex = 0;
  let samIndex = 0;
  return ctx.content.secrets.map((s) => (s.isSamSite ? save.generalInfo.samSitesFound[samIndex++] === true : plain[plainIndex++] === true));
}

function passengerSlots(saved: readonly (number | null)[], byProfile: Map<number, { id: number }>): number[] {
  const slots = emptyPassengerSlots();
  saved.forEach((profile, slot) => {
    const s = profile === null ? undefined : byProfile.get(profile);
    if (s && slot < slots.length) slots[slot] = s.id;
  });
  return slots;
}

function importHelicopter(saved: SavedHelicopter): HelicopterState {
  return { ...saved, refuelSiteAvailable: REFUEL_SITES.map((_, i) => saved.refuelSiteAvailable[i] === true) };
}

function importVehicles(save: SaveGame, byProfile: Map<number, { id: number }>): VehicleRecord[] {
  return save.vehicles.map((v) => {
    const vehicleSoldier = save.soldiers.find(
      (e) => e.soldier.team === PLAYER_TEAM && e.soldier.statusFlags & SOLDIER_VEHICLE_FLAG && e.soldier.vehicleSlot === v.slot,
    );
    return {
      valid: v.valid,
      destroyed: v.destroyed,
      type: v.type,
      sector: { ...v.sector },
      movementGroup: v.movementGroup,
      path: [...v.path],
      betweenSectors: v.betweenSectors,
      passengers: passengerSlots(v.passengerSlots, byProfile),
      soldierId: vehicleSoldier?.soldier.id ?? -1,
    };
  });
}

export function importStrategicMap(ctx: StrategicContext, save: SaveGame): void {
  const { state } = ctx;
  const info = save.generalInfo;
  state.options.difficulty = info.gameOptions.difficulty;
  state.options.sciFi = info.gameOptions.sciFi;
  state.options.gunNut = info.gameOptions.gunNut;
  state.map.sectors = importSectors(save);
  state.map.elements = importElements(save);
  state.map.underground = importUnderground(save);
  state.map.secretsFound = importSecrets(ctx, save);
  state.map.selectedSector = { ...info.selectedSector };
  const byProfile = playerSoldierByProfile(save);
  const f = state.forces;
  f.groups = save.groups.map((g) => {
    const members = g.playerProfiles.flatMap((p) => {
      const s = byProfile.get(p);
      return s && s.groupId === g.id ? [s.id] : [];
    });
    return importGroup(g, members);
  });
  f.squads = Array.from({ length: NUMBER_OF_SQUADS }, (_, q) => [...(save.squads[q] ?? [])]);
  f.squadGroupIds = save.squadMovementGroups.map((id) => id & 0xff);
  f.deadSquadMembers = info.deadSquadMembers.map((row) => [...row]);
  f.vehicleGroupIds = [...save.vehicleMovementGroups];
  f.vehicles = importVehicles(save, byProfile);
  f.helicopterVehicleId = info.helicopterVehicleId;
  f.helicopterAirborne = info.helicopterAirborne;
  f.helicopter = importHelicopter(info.helicopter);
  state.movement.disableMapInterfaceDueToBattle = info.disableMapInterfaceDueToBattle;
  const world: Sector = save.tactical.worldSector;
  state.worldSector = isValidSector(world) ? { ...world } : null;
  if (save.header.worldLoaded && state.worldSector) applyLoadedSectorMapChanges(ctx, save, state.worldSector);
}

function applyLoadedSectorMapChanges(ctx: StrategicContext, save: SaveGame, world: Sector): void {
  const changes = save.currentSector.mapModifications;
  if (!changes || changes.some((m) => MAP_CHANGES_WRITTEN_BACK_ON_LOAD.has(m.type))) return;
  resetSectorFlag(ctx.state.map, world, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS);
}
