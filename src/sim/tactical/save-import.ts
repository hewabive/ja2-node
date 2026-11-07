// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (the tactical part), LoadOppListInfoFromSavedGame;
// @src Tactical/Tactical_Save.cc LoadCurrentSectorsInformationFromTempItemsFile, LoadAndAddWorldItemsFromTempFile,
// @src LoadRottingCorpsesFromTempCorpseFile;
// @src TileEngine/SaveLoadMap.cc LoadAllMapChangesFromMapTempFileAndApplyThem, SetOpenableStructStatusFromMapTempFile,
// @src AddBloodOrSmellFromMapTempFileToMap;
// @src Tactical/Keys.cc LoadDoorStatusArrayFromDoorStatusTempFile (the door status flags);
// @src Tactical/Soldier_Add.cc AddSoldierToSectorGridNo (loading branch); TileEngine/WorldDef.cc LoadMapLights (light time
// @src from the saved clock); Strategic/Scheduling.cc LoadSchedulesFromSave; Tactical/Soldier_Add.cc InternalAddSoldierToSector
// @src (away slots of off-map soldiers); TileEngine/WorldDef.cc InitLoadedWorld (costs and lights after the temp files,
// @src before UpdateMercsInSector; SetBlueFlagFlags, 2026-11-04); TileEngine/SaveLoadMap.cc
// @src LoadRevealedStatusArrayFromRevealedTempFile; LoadSaveTacticalStatusType.cc ExtractTacticalStatusTypeFromFile (the
// @src panic fields, 2026-11-04); Tactical/LoadSaveSoldierType.cc (uiXRayActivatedTime, xrayed_by with
// @src SOLDIER_MISC_XRAYED) and Keys.h DOOR_HAS_TIN_CAN (2026-11-04); Tactical/LoadSaveSoldierType.cc bVehicleID of a
// @src vehicle soldier (2026-11-04); SOLDIER_DRIVER and SOLDIER_PASSENGER in the loaded sector (2026-11-05);
// @src ubHiResDirection, bTurningIncrement and SOLDIER_PAUSEANIMOVE (2026-11-05); LoadSaveTacticalStatusType.cc
// @src fAutoBandagePending (2026-11-06).

import { frameSlotOfSpriteFrame, type PresentationTimeline } from '../../content/anim/timelines.ts';
import type { MapDoor } from '../../content/formats/map.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { SavedSoldierEntry, SaveGame } from '../../content/formats/savegame.ts';
import type { SavedSoldier } from '../../content/formats/savegame-soldier.ts';
import {
  MapModificationType,
  type SavedCorpse,
  type SavedDoorStatus,
  type SavedMapModification,
} from '../../content/formats/savegame-temp-files.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { compileWorldMovementCosts } from '../../content/world/movement-costs.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { type TileTables, tileIndexFromTypeSubIndex } from '../../content/world/tile-tables.ts';
import { i16, u8 } from '../../core/int.ts';
import type { PreRandom } from '../../core/rng.ts';
import { objectFromRecord } from '../items/object.ts';
import type { DroppedNativeOption } from '../options.ts';
import { NO_VEHICLE, VehicleSeat } from '../strategic/forces/constants.ts';
import { type CivGroupState, importCivGroupHostility } from '../strategic/narrative/civ-groups.ts';
import { VehicleTypeId } from '../vehicles/vehicle-list.ts';
import { setAutoBandagePending } from './auto-bandage.ts';
import { setBlueFlagFlags } from './bombs/mine-flags.ts';
import type { Corpse } from './combat/death.ts';
import { placeLoadedCorpse } from './corpse-placement.ts';
import { loadDoorStatusArray, type StoredDoorStatus } from './doors/door-status.ts';
import type { KeyTable } from './doors/keys.ts';
import { setOpenableStructStatus } from './doors.ts';
import { Insertion } from './insertion.ts';
import { NUM_INV_SLOTS } from './inventory.ts';
import { loadedWorldItemGridNo } from './item-placement.ts';
import { lightSetBaseLevel, lightSpriteRenderAll, loadMapLights } from './lighting/lighting.ts';
import {
  type AddedExitGrid,
  applyMapChanges,
  exitGridChange,
  type MapChange,
  MapChangeKind,
  objectChange,
  structTileChange,
} from './map-changes.ts';
import { setSoldierPosition } from './movement.ts';
import { loadSavedSchedules } from './narrative/schedule-state.ts';
import { setMapRevealedStatus } from './perception/fov.ts';
import { addMercStructure, removeMercStructure } from './person-structure.ts';
import { type ProfileProgress, progressFromSavedProfile } from './profiles.ts';
import { addRottingCorpse, nowMinuteOf, removeAllCorpses } from './rotting-corpses.ts';
import { restoreBloodAndSmellAt } from './smell.ts';
import { copyDrugCourses, createSoldier, NOWHERE, type Soldier, SoldierStatusFlags, TOTAL_SOLDIERS } from './soldier.ts';
import {
  type AutoBandageState,
  type CrowStatus,
  placeOccupant,
  type RealtimeClock,
  registerSoldier,
  removeOccupant,
  type TacticalState,
} from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { addItemToPool, trashWorldItems } from './world-items.ts';

const SECTOR_ROW_LETTERS = 'abcdefghijklmnop';
const DOOR_OPEN = 0x01;
const DOOR_PERCEIVED_OPEN = 0x02;
const DOOR_PERCEIVED_NOTSET = 0x04;
const DOOR_HAS_TIN_CAN = 0x10;
const NOBODY = TOTAL_SOLDIERS;
const SAVED_OPPLIST_ENTRIES = 148;
const SOLDIER_QUOTE_SAID_BEING_PUMMELED = 0x0004;
const SOLDIER_QUOTE_SAID_EXT_CLOSE_CALL = 0x0008;
const INT16_BYTES = 2;
const MAX_TEAMS = 6;
const SAVED_NO_PENDING_STANCE = 254;
const NO_DESIRED_HEIGHT = 255;
const SAVED_NOWHERE = WORLD_MAX + 1;
const SOLDIER_MISC_HEARD_GUNSHOT = 0x01;
const SOLDIER_MISC_XRAYED = 0x04;
const AI_FLAG_ASLEEP = 0x20;
const AI_FLAG_LOCK_DOOR_INCLUDES_CLOSE = 0x40;
const AI_FLAG_CHECK_SCHEDULE = 0x80;
const BYTE_BITS = 8;

export interface SaveImportReport {
  readonly mapPath: string | null;
  readonly soldiers: number;
  readonly worldItems: number;
  readonly corpses: number;
  readonly skippedMapModifications: number;
  readonly droppedOptions?: readonly DroppedNativeOption[];
}

export interface SavedSectorChanges {
  readonly mapModifications: readonly SavedMapModification[] | null;
  readonly revealed: Uint8Array | null;
  readonly doorStatus: readonly SavedDoorStatus[] | null;
}

export const NO_SAVED_SECTOR_CHANGES: SavedSectorChanges = { mapModifications: null, revealed: null, doorStatus: null };

export interface CampaignWideState {
  readonly civGroups: CivGroupState;
  readonly keyTable: KeyTable;
  readonly profiles: Map<number, ProfileProgress>;
  readonly realtimeClock: RealtimeClock;
  readonly crows: CrowStatus;
  readonly autoBandage: AutoBandageState;
  readonly pre: PreRandom;
  readonly content: { readonly profiles: readonly MercProfile[] };
}

export function saveMapPath(save: SaveGame): string {
  const { x, y, z } = save.tactical.worldSector;
  const row = SECTOR_ROW_LETTERS[y - 1] ?? 'a';
  const underground = z > 0 ? `_b${z}` : '';
  const alternate = save.header.alternateSector ? '_a' : '';
  return `maps/${row}${x}${underground}${alternate}.dat`;
}

export function worldWithSavedDoors(world: TacticalWorld, save: SaveGame): TacticalWorld {
  const doors = save.currentSector.doors;
  if (!doors) return world;
  const mapDoors: MapDoor[] = doors.map((d) => ({
    gridNo: d.gridNo,
    locked: d.locked,
    trapLevel: d.trapLevel,
    trapId: d.trapId,
    lockId: d.lockId,
    perceivedLocked: d.perceivedLocked,
    perceivedTrapped: d.perceivedTrapped,
    lockDamage: d.lockDamage,
  }));
  return { ...world, map: { ...world.map, doors: mapDoors } };
}

export function importSave(sim: TacticalSim, save: SaveGame, presentation: PresentationTimeline): SaveImportReport {
  const t = sim.state;
  applyClock(t, save);
  t.sector = { ...save.tactical.worldSector };
  loadSavedSectorLights(sim, save);
  const worldItems = importWorldItems(t, save, sim.world.map.info.centerGridNo);
  const corpses = importCorpses(t, save.currentSector.corpses ?? []);
  const skippedMapModifications = skippedMapModificationCount(sim.world.tables, save.currentSector.mapModifications ?? []);
  t.world.costs.replaceWith(compileWorldMovementCosts(t.world).values);
  const soldiers = importSoldiers(t, save, presentation);
  importAwaySoldiers(t, save);
  t.schedules = loadSavedSchedules(save.schedules, (id) => activeSoldier(t, id));
  importOpplists(t, save);
  importTurnState(t, save);
  importCampaignWideState(t, save);
  lightSetBaseLevel(t, savedAmbientLight(sim, save));
  return { mapPath: sim.mapPath, soldiers, worldItems, corpses, skippedMapModifications };
}

export function importCampaignWideState(state: CampaignWideState, save: SaveGame): void {
  importCivGroupHostility(state.civGroups, save.tactical.civGroupHostile);
  save.keyTable.forEach((k, id) => {
    const entry = state.keyTable[id];
    if (entry) Object.assign(entry, k);
  });
  save.profiles.forEach((p, id) => {
    if (p) state.profiles.set(id, progressFromSavedProfile(p, state.content.profiles[id]));
  });
  state.realtimeClock.lastOpplistDecaySeconds = save.tactical.timeSinceLastOpplistDecay;
  state.realtimeClock.creatureTenseQuoteDelaySeconds = save.tactical.creatureTenseQuoteDelay;
  state.realtimeClock.lastCreatureTenseQuoteMs = save.tactical.creatureTenseQuoteLastUpdate;
  state.crows.possible = save.tactical.numCrowsPossible;
  state.crows.dontAddNew = save.tactical.dontAddNewCrows;
  setAutoBandagePending(state.autoBandage, save.tactical.autoBandagePending);
  state.pre.restore({ ring: save.preRandom.numbers, index: save.preRandom.index });
}

function applyClock(t: TacticalState, save: SaveGame): void {
  t.clockMs = save.generalInfo.baseJA2Clock;
}

function loadSavedSectorLights(sim: TacticalSim, save: SaveGame): void {
  const t = sim.state;
  t.lighting.underground = save.tactical.worldSector.z > 0;
  t.lighting.caves = sim.world.map.ambient?.caves ?? false;
  loadMapLights(t, sim.world.map.lights, save.worldTime.hour);
}

function savedAmbientLight(sim: TacticalSim, save: SaveGame): number {
  if (save.tactical.worldSector.z === 0) return save.clock.envLightValue;
  return sim.world.map.ambient?.lightLevel ?? sim.state.lighting.ambient;
}

function importWorldItems(t: TacticalState, save: SaveGame, centre: number): number {
  const items = save.currentSector.worldItems;
  if (!items) return t.worldItems.length;
  trashWorldItems(t);
  for (const wi of items) {
    if (!wi.exists) continue;
    const gridNo = loadedWorldItemGridNo(t, wi.gridNo, wi.flags, centre);
    addItemToPool(t, gridNo, objectFromRecord(wi.object), wi.visible, wi.level, wi.flags, wi.renderZHeightAboveLevel);
  }
  return t.worldItems.length;
}

const RottingCorpseFlags = {
  FIND_SWEETSPOT_FROM_GRIDNO: 0x01,
  USE_NORTH_ENTRY_POINT: 0x02,
  USE_SOUTH_ENTRY_POINT: 0x04,
  USE_EAST_ENTRY_POINT: 0x08,
  USE_WEST_ENTRY_POINT: 0x10,
  USE_CAMO_PALETTE: 0x20,
} as const;

const ENTRY_POINT_FLAGS: readonly (readonly [flag: number, entryPoint: number])[] = [
  [RottingCorpseFlags.USE_NORTH_ENTRY_POINT, Insertion.NORTH],
  [RottingCorpseFlags.USE_SOUTH_ENTRY_POINT, Insertion.SOUTH],
  [RottingCorpseFlags.USE_EAST_ENTRY_POINT, Insertion.EAST],
  [RottingCorpseFlags.USE_WEST_ENTRY_POINT, Insertion.WEST],
];

function corpsePlacement(flags: number): Pick<Corpse, 'findSweetSpot' | 'entryPoint'> {
  if (flags & RottingCorpseFlags.FIND_SWEETSPOT_FROM_GRIDNO) return { findSweetSpot: true };
  const entry = ENTRY_POINT_FLAGS.find(([flag]) => flags & flag);
  return entry ? { entryPoint: entry[1] } : {};
}

function savedCorpse(c: SavedCorpse): Corpse {
  return {
    gridNo: c.gridNo,
    level: c.level,
    heightAdjustment: c.heightAdjustment,
    bodyType: c.bodyType,
    direction: c.direction,
    state: 0,
    profile: c.profile,
    type: c.type,
    timeOfDeath: c.timeOfDeath,
    headTaken: c.headTaken,
    servicingCrows: c.servicingCrows,
    ...corpsePlacement(c.flags),
    palettes: [c.palettes.head, c.palettes.skin, c.palettes.vest, c.palettes.pants],
    ...(c.flags & RottingCorpseFlags.USE_CAMO_PALETTE ? { camo: true } : {}),
  };
}

function importCorpses(t: TacticalState, corpses: readonly SavedCorpse[]): number {
  removeAllCorpses(t);
  for (const saved of corpses) {
    const c = placeLoadedCorpse(t, savedCorpse(saved));
    if (c.gridNo < 0 || c.gridNo >= WORLD_MAX) continue;
    addRottingCorpse(t, c, { nowMinute: nowMinuteOf(t), loadingSave: true });
  }
  return t.corpses.length;
}

const NO_HELICOPTER = (): void => {};

export function loadSavedSectorChanges(sim: TacticalSim, saved: SavedSectorChanges, standHelicopter = NO_HELICOPTER): void {
  const t = sim.state;
  withSoldiersOffTheMap(t, () => {
    standHelicopter();
    for (const m of saved.mapModifications ?? []) applyMapModification(sim, m);
    applyRevealedStatus(t, saved.revealed);
    loadDoorStatusArray(t, (saved.doorStatus ?? []).map(storedDoorStatus));
    initLoadedWorld(t);
  });
}

function applyRevealedStatus(t: TacticalState, revealed: Uint8Array | null): void {
  if (revealed) setMapRevealedStatus(t, (g) => revealed[g] === 1);
}

export function initLoadedWorld(t: TacticalState): void {
  t.world.costs.replaceWith(compileWorldMovementCosts(t.world).values);
  lightSpriteRenderAll(t);
  setBlueFlagFlags(t);
}

function withSoldiersOffTheMap(t: TacticalState, load: () => void): void {
  const placed = t.soldiers.filter((s): s is Soldier => s?.placed === true);
  for (const s of placed) {
    removeOccupant(t, s);
    removeMercStructure(t, s);
  }
  load();
  for (const s of placed) {
    if (!s.placed) continue;
    placeOccupant(t, s);
    addMercStructure(t, s);
  }
}

function applyMapModification(sim: TacticalSim, m: SavedMapModification): void {
  const t = sim.state;
  if (m.type === MapModificationType.OPENABLE_STRUCT) setOpenableStructStatus(t, m.gridNo, m.imageType !== 0);
  else if (m.type === MapModificationType.BLOOD_SMELL) restoreBloodAndSmell(t, m.gridNo, m.imageType, m.subImageIndex);
  else {
    const change = savedMapChange(sim.world.tables, m);
    if (change) applyMapChanges(t, [change]);
  }
}

function appliedOutsideMapChanges(m: SavedMapModification): boolean {
  return m.type === MapModificationType.OPENABLE_STRUCT || m.type === MapModificationType.BLOOD_SMELL;
}

function skippedMapModificationCount(tables: TileTables, modifications: readonly SavedMapModification[]): number {
  return modifications.filter((m) => !appliedOutsideMapChanges(m) && savedMapChange(tables, m) === null).length;
}

function savedMapChange(tables: TileTables, m: SavedMapModification): MapChange | null {
  if (m.gridNo < 0 || m.gridNo >= WORLD_MAX) return null;
  if (m.type === MapModificationType.EXIT_GRIDS) return exitGridChange(savedExitGrid(m));
  const tile = savedStructTile(tables, m);
  if (tile === null) return null;
  if (m.type === MapModificationType.OBJECT) return objectChange(m.gridNo, tile);
  if (m.type === MapModificationType.STRUCT) return structTileChange(MapChangeKind.APPEND_STRUCT_TILE, m.gridNo, tile);
  if (m.type === MapModificationType.REMOVE_STRUCT) return structTileChange(MapChangeKind.REMOVE_STRUCT_TILE, m.gridNo, tile);
  return null;
}

function savedStructTile(tables: TileTables, m: SavedMapModification): number | null {
  const type = tables.types[m.imageType];
  if (!type || m.subImageIndex < 1 || m.subImageIndex > type.count) return null;
  return tileIndexFromTypeSubIndex(tables, m.imageType, m.subImageIndex);
}

function savedExitGrid(m: SavedMapModification): AddedExitGrid {
  return { mapIndex: m.gridNo, gridNo: m.subImageIndex, sector: { x: u8(m.imageType), y: u8(m.imageType >> BYTE_BITS), z: m.extra } };
}

function restoreBloodAndSmell(t: TacticalState, gridNo: number, blood: number, smell: number): void {
  if (gridNo >= 0 && gridNo < WORLD_MAX) restoreBloodAndSmellAt(t, gridNo, blood, smell);
}

function storedDoorStatus(d: SavedDoorStatus): StoredDoorStatus {
  return {
    gridNo: d.gridNo,
    open: (d.flags & DOOR_OPEN) !== 0,
    perceivedOpen: (d.flags & DOOR_PERCEIVED_OPEN) !== 0,
    perceivedNotSet: (d.flags & DOOR_PERCEIVED_NOTSET) !== 0,
    hasTinCan: (d.flags & DOOR_HAS_TIN_CAN) !== 0,
  };
}

const SEATED_FLAGS = SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER;

export function seatOfStatusFlags(statusFlags: number): number {
  if (statusFlags & SoldierStatusFlags.DRIVER) return VehicleSeat.DRIVER;
  return statusFlags & SoldierStatusFlags.PASSENGER ? VehicleSeat.PASSENGER : VehicleSeat.NONE;
}

function seatedInGroundVehicle(save: SaveGame, s: SavedSoldier): boolean {
  const v = save.vehicles.find((x) => x.valid && x.slot === s.vehicleId);
  return v !== undefined && v.type !== VehicleTypeId.HELICOPTER;
}

function onTheLoadedMap(save: SaveGame, s: SavedSoldier): boolean {
  if (s.statusFlags & (SoldierStatusFlags.DEAD | SoldierStatusFlags.OFF_MAP)) return false;
  return !(s.statusFlags & SEATED_FLAGS) || seatedInGroundVehicle(save, s);
}

export function inLoadedSector(save: SaveGame, s: SavedSoldier): boolean {
  const sector = save.tactical.worldSector;
  return (
    s.active !== 0 &&
    !s.betweenSectors &&
    s.sector.x === sector.x &&
    s.sector.y === sector.y &&
    s.sector.z === sector.z &&
    onTheLoadedMap(save, s)
  );
}

export function awayInLoadedSector(save: SaveGame, s: SavedSoldier): boolean {
  const sector = save.tactical.worldSector;
  return (
    s.active !== 0 &&
    !s.betweenSectors &&
    s.sector.x === sector.x &&
    s.sector.y === sector.y &&
    s.sector.z === sector.z &&
    (s.statusFlags & SoldierStatusFlags.OFF_MAP) !== 0 &&
    !(s.statusFlags & (SoldierStatusFlags.DEAD | SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER))
  );
}

function activeSoldier(t: TacticalState, id: number): boolean {
  const s = t.soldiers[id];
  return s !== undefined && (s.placed || s.offMap || s.away);
}

function importAwaySoldiers(t: TacticalState, save: SaveGame): void {
  for (const entry of save.soldiers) {
    const r = entry.soldier;
    if (r.id >= TOTAL_SOLDIERS || !awayInLoadedSector(save, r)) continue;
    const s = createSavedSoldier(save, entry);
    t.soldiers[s.id] = s;
    const g = grid(r.gridNo);
    s.gridNo = g;
    s.oldGridNo = grid(r.oldGridNo);
    s.destination = grid(r.destination);
    s.finalDestination = grid(r.finalDestination);
    importFacing(s, r);
    s.away = true;
    t.awaySlots.push(s);
  }
}

function importSoldiers(t: TacticalState, save: SaveGame, presentation: PresentationTimeline): number {
  const entries = save.soldiers.filter((e) => e.soldier.id < TOTAL_SOLDIERS && inLoadedSector(save, e.soldier));
  const created = entries.map((e) => placeSoldier(t, save, e, presentation));
  entries.forEach((e, k) => {
    const s = created[k];
    if (s) linkSoldier(t, s, e.soldier);
  });
  return created.length;
}

function importFacing(s: Soldier, r: SavedSoldier): void {
  s.direction = r.direction;
  s.hiResDirection = r.hiResDirection;
  s.desiredDirection = r.desiredDirection;
  s.turnIncrement = r.motion.turningIncrement;
}

function placeSoldier(t: TacticalState, save: SaveGame, entry: SavedSoldierEntry, presentation: PresentationTimeline): Soldier {
  const r = entry.soldier;
  const s = createSavedSoldier(save, entry);
  registerSoldier(t, s);
  s.destination = r.gridNo;
  setSoldierPosition(t, s, r.gridNo, { keepDestination: true, keepFinalDestination: true });
  s.destination = grid(r.destination);
  s.finalDestination = grid(r.finalDestination);
  s.oldGridNo = grid(r.oldGridNo);
  importFacing(s, r);
  s.overTerrain = r.overTerrainType;
  s.pc = r.aniCode;
  s.frameSlot = frameSlotOfSpriteFrame(presentation, r.animState, r.aniCode, r.aniFrame);
  s.nextFrameAt = t.clockMs;
  return s;
}

export function createSavedSoldier(save: SaveGame, entry: SavedSoldierEntry): Soldier {
  const r = entry.soldier;
  const profile = save.profiles[r.profile];
  const s = createSoldier({
    id: r.id,
    team: r.team,
    side: r.side,
    name: r.name,
    profile: r.profile,
    soldierClass: r.soldierClass,
    bodyType: r.bodyType,
    palettes: { hair: r.palettes.head, skin: r.palettes.skin, vest: r.palettes.vest, pants: r.palettes.pants },
    inv: Array.from({ length: NUM_INV_SLOTS }, (_, k) => objectFromRecord(r.inventory[k] ?? emptyRecord(r))),
    stats: {
      agility: r.stats.agility,
      dexterity: r.stats.dexterity,
      strength: r.stats.strength,
      wisdom: r.stats.wisdom,
      leadership: r.stats.leadership,
      marksmanship: r.stats.marksmanship,
      mechanical: r.stats.mechanical,
      explosives: r.stats.explosive,
      medical: r.stats.medical,
      experience: r.stats.expLevel,
    },
    life: r.stats.life,
    lifeMax: r.stats.lifeMax,
    morale: r.morale,
    skillTrait1: r.skillTraits[0],
    skillTrait2: r.skillTraits[1],
    personalityTrait: profile && r.profile !== NOBODY ? profile.personalityTrait : 0,
    breath: r.stats.breath,
    gridNo: NOWHERE,
    level: r.level,
    direction: r.direction,
    state: r.animState,
    civilianGroup: r.civilianGroup,
  });
  copyScalars(s, r);
  s.keyRing = entry.keyRing ? entry.keyRing.map((k) => ({ keyId: k.keyId, count: k.count })) : null;
  return s;
}

function emptyRecord(r: SavedSoldier): SavedSoldier['inventory'][number] {
  const first = r.inventory[0];
  if (!first) throw new RangeError(`soldier ${r.id} has no inventory records`);
  return { ...first, item: 0, count: 0, flags: 0 };
}

function copyScalars(s: Soldier, r: SavedSoldier): void {
  const m = r.motion;
  s.neutral = r.ai.neutral !== 0;
  s.visible = r.visible;
  s.monsterOrAnimal = (r.statusFlags & (SoldierStatusFlags.MONSTER | SoldierStatusFlags.ANIMAL)) !== 0;
  s.underAiControl = (r.statusFlags & SoldierStatusFlags.PCUNDERAICONTROL) !== 0;
  s.boxer = (r.statusFlags & SoldierStatusFlags.BOXER) !== 0;
  s.cowering = (r.statusFlags & SoldierStatusFlags.COWERING) !== 0;
  s.gassed = (r.statusFlags & SoldierStatusFlags.GASSED) !== 0;
  s.dead = (r.statusFlags & SoldierStatusFlags.DEAD) !== 0;
  s.pauseAnimMove = (r.statusFlags & SoldierStatusFlags.PAUSEANIMOVE) !== 0;
  s.lookForItems = (r.statusFlags & SoldierStatusFlags.LOOKFOR_ITEMS) !== 0;
  s.vehicleId = r.statusFlags & SoldierStatusFlags.VEHICLE ? r.vehicleSlot : NO_VEHICLE;
  s.vehicleSeat = seatOfStatusFlags(r.statusFlags);
  s.heardGunshot = (r.miscSoldierFlags & SOLDIER_MISC_HEARD_GUNSHOT) !== 0;
  s.xrayActivatedTime = r.xrayActivatedTime;
  s.breathMax = r.stats.breathMax;
  s.breathRed = r.breathRed;
  s.bleeding = r.bleeding;
  s.camo = r.camo;
  s.actionPoints = r.actionPoints;
  s.initialActionPoints = r.initialActionPoints;
  s.apsLostToSuppression = r.apsLostToSuppression;
  s.suppressionPoints = r.suppressionPoints;
  s.weightCarriedAtTurnStart = m.weightCarriedAtTurnStart;
  s.stealthMode = r.stealthMode !== 0;
  s.hasKeys = r.hasKeys;
  s.quoteRecord = r.quoteRecord;
  s.quoteActionId = r.quoteActionId;
  s.currentCivQuote = r.currentCivQuote;
  s.currentCivQuoteDelta = r.currentCivQuoteDelta;
  s.collapsed = r.collapsed !== 0;
  s.breathCollapsed = r.breathCollapsed !== 0;
  s.collapsedTurns = r.turnsCollapsed;
  s.statDamage = { ...r.statDamage };
  s.teamMoraleMod = r.moraleMods.team;
  s.tacticalMoraleMod = r.moraleMods.tactical;
  s.strategicMoraleMod = r.moraleMods.strategic;
  s.delayedStrategicMoraleMod = r.moraleMods.delayedStrategic;
  s.blindedCounter = r.blindedCounter;
  s.muzzleFlash = r.muzzleFlash;
  s.sleepDrugCounter = r.sleepDrugCounter;
  s.drugs = copyDrugCourses(r.drugs);
  s.heightAdjustment = r.heightAdjustment;
  s.targetHeightAdjustment = r.targetHeightAdjustment;
  s.uiMovementMode = m.uiMovementMode;
  s.movementDirection = m.movementDirection;
  s.reverse = m.reverse !== 0;
  s.noAPToFinishMove = m.noAPToFinishMove;
  s.pendingStanceChange = unlessSentinel(m.pendingStanceChange, SAVED_NO_PENDING_STANCE, NO_DESIRED_HEIGHT);
  s.desiredHeight = m.desiredHeight;
  s.forecastGridNo = grid(m.forecastGridNo);
  s.inNonInterruptibleAnimation = m.inNonInterruptibleAnimation;
  s.rtNonInterruptible = m.rtNonInterruptible;
  s.turningUntilDone = m.turningUntilDone;
  s.continueMoveAfterStanceChange = m.continueMoveAfterStanceChange;
  s.path = [...r.path];
  s.pathIndex = r.pathIndex;
  s.pathSize = m.pathSize;
  s.pathStored = m.pathStored !== 0;
  s.absoluteFinalDestination = grid(r.absoluteFinalDestination);
  s.endDoorOpenCode = m.endDoorOpenCode;
  s.doorHandleCode = m.doorHandleCode;
  s.lastSkillCheck = m.lastSkillCheck;
  s.serviceCount = m.serviceCount;
  s.servicePartner = m.servicePartner;
  s.skillCheckAttempts = m.skillCheckAttempts;
  s.skillCheckGridNo = grid(m.skillCheckGridNo);
  s.delayedMovement = m.delayedMovement;
  s.newOppCnt = m.newOppCount;
  s.movementNoiseHeard = m.movementNoiseHeard;
  s.oldLife = m.oldLife;
  s.dontChargeReadyAPs = m.dontChargeReadyAPs;
  s.dontChargeAPsForStanceChange = m.dontChargeAPsForStanceChange;
  s.dontChargeTurningAPs = m.dontChargeTurningAPs;
  s.turnsUntilCanSayHeardNoise = m.turnsUntilCanSayHeardNoise;
  s.sayAmmoQuotePending = m.sayAmmoQuotePending;
  s.nextBleed = m.nextBleed;
  s.warnedAboutBleeding = m.warnedAboutBleeding;
  s.dyingComment = m.dyingComment;
  s.pummeledQuoteSaid = (r.quoteSaidFlags & SOLDIER_QUOTE_SAID_BEING_PUMMELED) !== 0;
  s.closeCallQuoteSaid = (r.quoteSaidExtFlags & SOLDIER_QUOTE_SAID_EXT_CLOSE_CALL) !== 0;
  s.dontUnsetLastTargetFromTurn = m.dontUnsetLastTargetFromTurn;
  s.tilesMovedPerRTBreathUpdate = m.tilesMovedPerRTBreathUpdate;
  s.lastMovementAnimPerRTBreathUpdate = m.lastMovementAnimPerRTBreathUpdate;
  s.tilesMovedSinceLastForget = m.tilesMovedSinceLastForget;
  s.overrideMoveSpeed = m.overrideMoveSpeed;
  s.useOverrideMoveSpeed = m.useOverrideMoveSpeed;
  s.pendingActionData1 = m.pendingActionData1;
  s.pendingActionData2 = m.pendingActionData2;
  s.timeOfLastRandomAction = m.timeOfLastRandomAction;
  s.lastRenderVisible = m.lastRenderVisible;
  s.fade = m.beginFade;
  s.fadeShade = m.fadeLevel;
  s.fadeStartGridNo = grid(m.fadeStartGridNo);
  s.tilesMoved = r.tilesMoved;
  s.lastTwoLocations = [grid(r.lastTwoLocations[0] ?? NOWHERE), grid(r.lastTwoLocations[1] ?? NOWHERE)];
  s.shock = r.ai.shock;
  s.numHitsThisTurn = r.numHitsThisTurn;
  s.lastTarget = grid(r.lastTarget);
  s.initialGridNo = r.initialGridNo;
  s.aimTime = r.aimTime;
  s.aimShotLocation = r.aimShotLocation;
  s.doBurst = r.doBurst;
  s.bulletsLeft = r.bulletsLeft;
  s.attackingWeapon = r.attackingWeapon;
  s.weaponMode = r.weaponMode;
  s.hitLocation = r.hitLocation;
  s.targetGridNo = grid(r.targetGridNo);
  s.targetLevel = r.targetLevel;
  s.targetCubeLevel = m.targetCubeLevel;
  s.lastAttackHit = r.ai.lastAttackHit !== 0;
  s.interruptDuelPts = r.interrupt.duelPoints;
  s.passedLastInterrupt = r.interrupt.passedLastInterrupt !== 0;
  s.intStartAPs = r.interrupt.startAPs;
  s.moved = r.interrupt.moved !== 0;
  s.movedPriorToInterrupt = r.interrupt.movedPriorToInterrupt !== 0;
  copyAi(s, r);
  r.oppList.slice(0, SAVED_OPPLIST_ENTRIES).forEach((v, k) => {
    s.oppList[k] = v;
  });
}

function grid(g: number): number {
  return g === SAVED_NOWHERE ? NOWHERE : g;
}

function unlessSentinel(value: number, saved: number, ours: number): number {
  return value === saved ? ours : value;
}

function copyAi(s: Soldier, r: SavedSoldier): void {
  const a = r.ai;
  Object.assign(s.ai, {
    alertStatus: a.alertStatus,
    orders: a.orders,
    attitude: a.attitude,
    patrolGrid: a.patrolGrid.map(grid),
    patrolCount: a.patrolCount,
    nextPatrolPoint: a.nextPatrolPoint,
    action: a.action,
    actionData: grid(a.actionData),
    nextAction: a.nextAction,
    nextActionData: grid(a.nextActionData),
    nextTargetLevel: a.nextTargetLevel,
    lastAction: a.lastAction,
    actionInProgress: a.actionInProgress !== 0,
    newSituation: a.newSituation,
    bypassToGreen: a.bypassToGreen,
    dominantDir: a.dominantDirection,
    noiseGridNo: grid(a.noiseGridNo),
    noiseLevel: r.noiseLevel,
    noiseVolume: a.noiseVolume,
    oppCount: a.oppCount,
    underFire: a.underFire,
    morale: a.aiMorale,
    mobility: a.mobility,
    callPriority: a.callPriority,
    caller: a.caller,
    callerGridNo: grid(a.callerGridNo),
    callActedUpon: a.callActedUpon !== 0,
    frenzied: a.frenzied !== 0,
  });
  const aiFlags = u8(a.aiFlags);
  s.ai.asleep = (aiFlags & AI_FLAG_ASLEEP) !== 0;
  s.ai.lockDoorIncludesClose = (aiFlags & AI_FLAG_LOCK_DOOR_INCLUDES_CLOSE) !== 0;
  s.ai.checkSchedule = (aiFlags & AI_FLAG_CHECK_SCHEDULE) !== 0;
  s.ai.scheduleProgress = a.scheduleProgress;
  s.scheduleId = a.scheduleId;
  s.offWorldGridNo = grid(r.offWorldGridNo);
  s.hunting = a.hunting !== 0;
  s.normalSmell = a.normalSmell;
  s.monsterSmell = a.monsterSmell;
  s.regenerationCounter = a.regenerationCounter;
  s.regenBoostersUsedToday = a.regenBoostersUsedToday;
  s.pendingActionData4 = a.pendingActionData4;
}

function soldierById(t: TacticalState, id: number): Soldier | null {
  return id >= 0 && id < NOBODY ? (t.soldiers[id] ?? null) : null;
}

function linkSoldier(t: TacticalState, s: Soldier, r: SavedSoldier): void {
  s.target = soldierById(t, r.target);
  s.opponent = soldierById(t, r.opponent);
  s.attacker = soldierById(t, r.attacker);
  s.previousAttacker = soldierById(t, r.previousAttacker);
  s.nextToPreviousAttacker = soldierById(t, r.nextToPreviousAttacker);
  s.xrayedBy = (r.miscSoldierFlags & SOLDIER_MISC_XRAYED) !== 0 ? soldierById(t, r.xrayedBy) : null;
}

const PUBLIC_LAST_KNOWN_AFTER_WORLD_LOAD = NOWHERE;
const PERSONAL_LAST_KNOWN_IN_A_FRESH_PROCESS = 0;

function halfSavedGridNo(bytes: Uint8Array, index: number, unsaved: number): number {
  const at = index * INT16_BYTES;
  if (at + INT16_BYTES > bytes.length) return unsaved;
  return grid(i16((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)));
}

function importOpplists(t: TacticalState, save: SaveGame): void {
  const o = save.oppList;
  const p = t.perception;
  for (let team = 0; team < MAX_TEAMS; team++) {
    const publicOpp = p.publicOpp[team];
    const publicLastKnown = p.publicLastKnown[team];
    const publicLastKnownLevel = p.publicLastKnownLevel[team];
    if (!publicOpp || !publicLastKnown || !publicLastKnownLevel) continue;
    (o.publicOpplist[team] ?? []).forEach((v, k) => {
      publicOpp[k] = v;
    });
    for (let k = 0; k < TOTAL_SOLDIERS; k++)
      publicLastKnown[k] = halfSavedGridNo(o.publicLastKnownOppLocBytes, team * TOTAL_SOLDIERS + k, PUBLIC_LAST_KNOWN_AFTER_WORLD_LOAD);
    publicLastKnownLevel.set(o.publicLastKnownOppLevel[team] ?? []);
    p.publicNoiseVolume[team] = o.publicNoiseVolume[team] ?? 0;
    p.publicNoiseGridNo[team] = halfSavedGridNo(o.publicNoiseGridNoBytes, team, PUBLIC_LAST_KNOWN_AFTER_WORLD_LOAD);
  }
  for (const s of t.soldiers) {
    if (!s) continue;
    for (let k = 0; k < TOTAL_SOLDIERS; k++)
      s.lastKnownOpp[k] = halfSavedGridNo(o.lastKnownOppLocBytes, s.id * TOTAL_SOLDIERS + k, PERSONAL_LAST_KNOWN_IN_A_FRESH_PROCESS);
    s.lastKnownOppLevel.set(o.lastKnownOppLevel[s.id] ?? []);
  }
  o.seenOpponents.forEach((row, viewer) => {
    row.forEach((v, k) => {
      t.turn.seenOpponents[viewer * TOTAL_SOLDIERS + k] = v;
    });
  });
  const w = save.watchedLocations;
  w.gridNo.forEach((row, id) => {
    row.forEach((g, k) => {
      const at = id * row.length + k;
      t.turn.watched.gridNo[at] = grid(g);
      t.turn.watched.level[at] = w.level[id]?.[k] ?? 0;
      t.turn.watched.points[at] = w.points[id]?.[k] ?? 0;
      t.turn.watched.reset[at] = w.reset[id]?.[k] ? 1 : 0;
    });
  });
}

const ENEMY_OFFERED_SURRENDER = 0x01;

function importTurnState(t: TacticalState, save: SaveGame): void {
  const ts = save.tactical;
  const turn = t.turn;
  t.inCombat = ts.inCombat;
  turn.currentTeam = ts.currentTeam;
  turn.attackBusyCount = ts.attackBusyCount;
  turn.interruptOccurred = ts.interruptOccurred;
  turn.virginSector = ts.virginSector;
  turn.enemyInSector = ts.enemyInSector;
  turn.someoneHit = ts.someoneHit;
  turn.enemyOfferedSurrender = (ts.enemyFlags & ENEMY_OFFERED_SURRENDER) !== 0;
  turn.itemsSeenOnAttack = ts.itemsSeenOnAttack ? soldierById(t, ts.itemsSeenOnAttackSoldier) : null;
  turn.itemsSeenOnAttackGridNo = ts.itemsSeenOnAttack ? ts.itemsSeenOnAttackGridNo : NOWHERE;
  turn.lockItemLocators = ts.lockItemLocators;
  turn.spottersCalledForBy = ts.spottersCalledForBy;
  turn.consNumTurnsNotSeen = ts.consecutiveTurnsNotSeen;
  turn.consNumTurnsWeHaventSeenButEnemyDoes = ts.consecutiveTurnsWeHaventSeenButEnemyDoes;
  turn.unlockUIAfterHiddenInterrupt = ts.unlockUiAfterHiddenInterrupt;
  t.smell.lastDecaySeconds = ts.decayBloodLastUpdate;
  ts.numFoughtInBattle.forEach((n, team) => {
    turn.numFoughtInBattle[team] = n;
  });
  ts.teams.forEach((team, k) => {
    t.perception.awareOfOpposition[k] = team.awareOfOpposition !== 0;
    t.perception.lastMercToRadio[k] = soldierById(t, team.lastMercToRadio);
  });
  turn.enemySightingOnTheirTurn = null;
  const turns = save.teamTurns;
  turn.intList.length = 0;
  for (const id of turns.outOfTurnOrder) {
    const s = soldierById(t, id);
    if (s) turn.intList.push(s);
  }
  turn.hiddenInterrupt = turns.hiddenInterrupt;
  turn.lastInterruptedGuy = soldierById(t, turns.lastInterruptedGuy);
  turn.whoThrewRock = soldierById(t, turns.whoThrewRock);
  turn.selected = save.generalInfo.selectedSoldier < NOBODY ? save.generalInfo.selectedSoldier : turn.selected;
  importPanic(t, save);
}

function importPanic(t: TacticalState, save: SaveGame): void {
  const ts = save.tactical;
  const panic = t.panic;
  panic.flags = ts.panicFlags;
  panic.chosenOne = soldierById(t, ts.theChosenOne);
  panic.armyGuysKilled = ts.armyGuysKilled;
  ts.panicTriggers.forEach((saved, k) => {
    const trigger = panic.triggers[k];
    if (!trigger) return;
    trigger.gridNo = saved.gridNo;
    trigger.isAlarm = saved.isAlarm !== 0;
    trigger.tolerance = saved.tolerance;
  });
}
