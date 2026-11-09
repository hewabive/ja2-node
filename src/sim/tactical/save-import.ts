// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (the tactical part), LoadOppListInfoFromSavedGame;
// @src Tactical/Tactical_Save.cc LoadCurrentSectorsInformationFromTempItemsFile, LoadAndAddWorldItemsFromTempFile,
// @src LoadRottingCorpsesFromTempCorpseFile (the map changes, revealed tiles, door status, smoke and light effects in the
// @src order of the first, 2026-11-08); Tactical/Soldier_Control.cc SetSoldierGridNo (the gas test of the soldiers
// @src entering the map after them, 2026-11-08);
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
// @src fAutoBandagePending (2026-11-06); Tactical/LoadSaveSoldierType.cc sDestXPos, sDestYPos, fPastXDest and fPastYDest
// @src (2026-11-07); SOLDIER_LOCKPENDINGACTIONCOUNTER (2026-11-07); Tactical/Soldier_Add.cc InternalAddSoldierToSector (the
// @src helicopter's passengers in their merc slots with no tile) and Strategic/StrategicMap.cc UpdateMercInSector (a
// @src chopper merc of a save made in mid-drop back in the seats, AddMercToHeli, 2026-11-08; its return for a merc in transit,
// @src 2026-11-08); SOLDIER_ENGAGEDINACTION (2026-11-08); TileEngine/Explosion_Control.cc LoadExplosionTableFromSavedGameFile
// @src (the bomb queue and the explosions in flight, after the soldiers and the world load's light level) with
// @src LoadGeneralInfo's gfExplosionQueueActive, the DISALLOW_SIGHT and CHECK_SIGHT_AT_END_OF_ATTACK bits of the saved
// @src uiFlags, and the busy count LoadSavedGame zeroes in combat and out of it (2026-11-08).

import type { MercProfile } from '../../content/formats/prof.ts';
import type { SavedSoldierEntry, SaveGame } from '../../content/formats/savegame.ts';
import type { SavedExplosionTable } from '../../content/formats/savegame-effects.ts';
import type { SavedSoldier } from '../../content/formats/savegame-soldier.ts';
import type {
  SavedCorpse,
  SavedDoorStatus,
  SavedLightEffect,
  SavedMapModification,
  SavedSmokeEffect,
} from '../../content/formats/savegame-temp-files.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { compileWorldMovementCosts } from '../../content/world/movement-costs.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { i16, u8 } from '../../core/int.ts';
import type { PreRandom } from '../../core/rng.ts';
import { objectFromRecord } from '../items/object.ts';
import type { DroppedNativeOption } from '../options.ts';
import { Assignment, NO_VEHICLE, VehicleSeat } from '../strategic/forces/constants.ts';
import { type CivGroupState, importCivGroupHostility } from '../strategic/narrative/civ-groups.ts';
import { VehicleTypeId } from '../vehicles/vehicle-list.ts';
import { anim } from './anim-states.ts';
import { restartAnimationOnLoad } from './animation.ts';
import { setAutoBandagePending } from './auto-bandage.ts';
import { loadExplosionQueue } from './bombs/bomb-queue.ts';
import { setBlueFlagFlags } from './bombs/mine-flags.ts';
import type { TacticalContent } from './content.ts';
import { placeLoadedCorpse } from './corpse-placement.ts';
import { loadDoorStatusArray } from './doors/door-status.ts';
import type { KeyTable } from './doors/keys.ts';
import { explosionAnimationById, generateExplosion } from './explosions/explosion.ts';
import { updateGassedOnNewGridNo } from './explosions/smoke.ts';
import { addMercToHeli } from './helicopter-drop.ts';
import { Insertion } from './insertion.ts';
import { NUM_INV_SLOTS } from './inventory.ts';
import { loadedWorldItemGridNo } from './item-placement.ts';
import { lightSetBaseLevel, lightSpriteRenderAll, loadMapLights } from './lighting/lighting.ts';
import { setSoldierPosition } from './movement.ts';
import { loadSavedSchedules } from './narrative/schedule-state.ts';
import {
  loadAllMapChangesFromMapTempFile,
  loadLightEffectsFromMapTempFile,
  loadRevealedStatusFromRevealedTempFile,
  loadSmokeEffectsFromMapTempFile,
  savedCorpse,
  savedMapDoor,
  skippedMapModificationCount,
  storedDoorStatus,
} from './native-temp-files.ts';
import { addMercStructure, removeMercStructure } from './person-structure.ts';
import { type ProfileProgress, progressFromSavedProfile } from './profiles.ts';
import { addRottingCorpse, nowMinuteOf, removeAllCorpses } from './rotting-corpses.ts';
import {
  copyDrugCourses,
  createSoldier,
  NO_PENDING_ANIMATION,
  NO_PENDING_DIRECTION,
  NOWHERE,
  type Soldier,
  SoldierStatusFlags,
  TOTAL_SOLDIERS,
} from './soldier.ts';
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
import { seatInTheHelicopterOnSectorEntry } from './vehicle-passengers.ts';
import { addItemToPool, trashWorldItems } from './world-items.ts';

const SECTOR_ROW_LETTERS = 'abcdefghijklmnop';
const NOBODY = TOTAL_SOLDIERS;
const SAVED_OPPLIST_ENTRIES = 148;
const SOLDIER_QUOTE_SAID_BEING_PUMMELED = 0x0004;
const SOLDIER_QUOTE_SAID_EXT_CLOSE_CALL = 0x0008;
const INT16_BYTES = 2;
const MAX_TEAMS = 6;
const SAVED_NO_PENDING_STANCE = 254;
const SAVED_NO_PENDING_ANIMATION = 32001;
const SAVED_NO_PENDING_DIRECTION = 253;
const NO_DESIRED_HEIGHT = 255;
const SAVED_NOWHERE = WORLD_MAX + 1;
const SOLDIER_MISC_HEARD_GUNSHOT = 0x01;
const SOLDIER_MISC_XRAYED = 0x04;
const AI_FLAG_ASLEEP = 0x20;
const AI_FLAG_LOCK_DOOR_INCLUDES_CLOSE = 0x40;
const AI_FLAG_CHECK_SCHEDULE = 0x80;

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
  readonly smoke: readonly SavedSmokeEffect[] | null;
  readonly lights: readonly SavedLightEffect[] | null;
}

export const NO_SAVED_SECTOR_CHANGES: SavedSectorChanges = {
  mapModifications: null,
  revealed: null,
  doorStatus: null,
  smoke: null,
  lights: null,
};

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
  return { ...world, map: { ...world.map, doors: doors.map(savedMapDoor) } };
}

export type SavedSoldiers = ReadonlyMap<number, Soldier>;

export interface ImportedSave {
  readonly report: SaveImportReport;
  readonly soldiers: SavedSoldiers;
}

export type AroundAnimationRestart = (t: TacticalState, restart: () => void) => void;

export const RESTART_ON_OWN_DRAWS: AroundAnimationRestart = (_t, restart) => restart();

export function importSave(sim: TacticalSim, save: SaveGame, aroundRestart = RESTART_ON_OWN_DRAWS): ImportedSave {
  const t = sim.state;
  applyClock(t, save);
  t.sector = { ...save.tactical.worldSector };
  importTacticalStatus(t, save);
  loadSavedSectorLights(sim, save);
  const worldItems = importWorldItems(t, save, sim.world.map.info.centerGridNo);
  const corpses = importCorpses(t, save.currentSector.corpses ?? []);
  const skippedMapModifications = skippedMapModificationCount(sim.world.tables, save.currentSector.mapModifications ?? []);
  t.world.costs.replaceWith(compileWorldMovementCosts(t.world).values);
  const soldiers = createSavedSoldiers(save);
  const placed = whileLoadingSave(t, () => {
    restartSavedSoldiers(t, save, soldiers, aroundRestart);
    const count = importSoldiers(t, save, soldiers);
    seatHelicopterDropArrivals(t, save);
    importAwaySoldiers(t, save, soldiers);
    return count;
  });
  t.schedules = loadSavedSchedules(save.schedules, (id) => activeSoldier(t, id));
  importOpplists(t, save);
  linkTacticalStatus(t, save);
  importCampaignWideState(t, save);
  lightSetBaseLevel(t, savedAmbientLight(sim, save));
  loadExplosionTable(t, save.explosionTable, save.generalInfo.explosionQueueActive);
  dropSavedAttackBusyCount(t);
  return { report: { mapPath: sim.mapPath, soldiers: placed, worldItems, corpses, skippedMapModifications }, soldiers };
}

function dropSavedAttackBusyCount(t: TacticalState): void {
  t.turn.attackBusyCount = 0;
}

function loadExplosionTable(t: TacticalState, table: SavedExplosionTable, queueActive: boolean): void {
  const entries = table.queue.map((e) => ({ bomb: e.worldBombIndex, timestamp: e.timestamp, exists: e.exists }));
  loadExplosionQueue(t, entries, queueActive);
  for (const e of table.explosions) {
    const animation = explosionAnimationById(t, e.animationId);
    if (!animation) continue;
    const { item, x, y, z, gridNo, level, frame } = e;
    generateExplosion(t, { owner: soldierById(t, e.ownerId), animation, item, x, y, z, gridNo, level, frame });
  }
}

function whileLoadingSave<T>(t: TacticalState, load: () => T): T {
  t.loadingSave = true;
  try {
    return load();
  } finally {
    t.loadingSave = false;
  }
}

function createSavedSoldiers(save: SaveGame): SavedSoldiers {
  return new Map(save.soldiers.filter((e) => e.soldier.id < TOTAL_SOLDIERS).map((e) => [e.soldier.id, createSavedSoldier(save, e)]));
}

const CLIMBING_STATES = ['HOPFENCE', 'CLIMBDOWNROOF', 'FALLFORWARD_ROOF', 'FALLOFF', 'CLIMBUPROOF'];

export function createWorldlessSavedSoldiers(save: SaveGame, content: TacticalContent): SavedSoldiers {
  const soldiers = createSavedSoldiers(save);
  for (const s of soldiers.values()) standUpFromClimbingWithoutWorld(content, s);
  return soldiers;
}

function standUpFromClimbingWithoutWorld(content: TacticalContent, s: Soldier): void {
  if (!CLIMBING_STATES.includes(content.animations.controls[s.state]?.id ?? '')) return;
  s.state = anim(content, 'STANDING');
  s.pc = 0;
}

function withSavedRecords(save: SaveGame, soldiers: SavedSoldiers): (readonly [Soldier, SavedSoldier])[] {
  return save.soldiers.flatMap(({ soldier: r }) => {
    const s = soldiers.get(r.id);
    return s ? [[s, r] as const] : [];
  });
}

function restartSavedSoldiers(t: TacticalState, save: SaveGame, soldiers: SavedSoldiers, aroundRestart: AroundAnimationRestart): void {
  const pairs = withSavedRecords(save, soldiers);
  const entering = pairs.filter(([, r]) => enteringTheMercSlots(save, r));
  for (const [s, r] of pairs) {
    holdSavedPendingAnimation(s, r);
    if (enteringTheMercSlots(save, r) || awayInLoadedSector(save, r)) putAtSavedPosition(s, r);
  }
  for (const [s] of entering) t.soldiers[s.id] = s;
  for (const [s, r] of entering) linkSoldier(t, s, r);
  aroundRestart(t, () => {
    for (const s of soldiers.values()) restartAnimationOnLoad(t, s, s.pc);
  });
  for (const s of soldiers.values()) dropPendingAnimation(s);
}

function holdSavedPendingAnimation(s: Soldier, r: SavedSoldier): void {
  s.pendingAnimation = unlessSentinel(r.pendingAnimation, SAVED_NO_PENDING_ANIMATION, NO_PENDING_ANIMATION);
  s.pendingDirection = unlessSentinel(r.motion.pendingDirection, SAVED_NO_PENDING_DIRECTION, NO_PENDING_DIRECTION);
}

function dropPendingAnimation(s: Soldier): void {
  s.pendingAnimation = NO_PENDING_ANIMATION;
  s.pendingDirection = NO_PENDING_DIRECTION;
}

function putAtSavedPosition(s: Soldier, r: SavedSoldier): void {
  s.gridNo = grid(r.gridNo);
  s.oldGridNo = grid(r.oldGridNo);
  s.destination = grid(r.destination);
  s.finalDestination = grid(r.finalDestination);
  s.x = Math.fround(r.xPos);
  s.y = Math.fround(r.yPos);
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

export function loadSavedSectorChanges(sim: TacticalSim, saved: SavedSectorChanges, standHelicopter = NO_HELICOPTER): boolean {
  const t = sim.state;
  let mapModificationsKept = true;
  withSoldiersOffTheMap(t, () => {
    standHelicopter();
    if (saved.mapModifications) mapModificationsKept = loadAllMapChangesFromMapTempFile(t, saved.mapModifications);
    if (saved.revealed) loadRevealedStatusFromRevealedTempFile(t, saved.revealed);
    loadDoorStatusArray(t, (saved.doorStatus ?? []).map(storedDoorStatus));
    if (saved.smoke) loadSmokeEffectsFromMapTempFile(t, saved.smoke);
    if (saved.lights) loadLightEffectsFromMapTempFile(t, saved.lights);
    initLoadedWorld(t);
  });
  return mapModificationsKept;
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
    updateGassedOnNewGridNo(t, s, s.gridNo);
  }
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

function seatedInHelicopter(save: SaveGame, s: SavedSoldier): boolean {
  return (s.statusFlags & SEATED_FLAGS) !== 0 && !seatedInGroundVehicle(save, s);
}

function waitingForTheHelicopterDrop(s: SavedSoldier): boolean {
  return s.strategicInsertionCode === Insertion.CHOPPER;
}

function enteringTheLoadedSector(save: SaveGame, s: SavedSoldier): boolean {
  const sector = save.tactical.worldSector;
  return (
    s.active !== 0 &&
    !s.betweenSectors &&
    s.sector.x === sector.x &&
    s.sector.y === sector.y &&
    s.sector.z === sector.z &&
    s.assignment !== Assignment.IN_TRANSIT &&
    !(s.statusFlags & (SoldierStatusFlags.DEAD | SoldierStatusFlags.OFF_MAP))
  );
}

export function inLoadedSector(save: SaveGame, s: SavedSoldier): boolean {
  return enteringTheLoadedSector(save, s) && !seatedInHelicopter(save, s) && !waitingForTheHelicopterDrop(s);
}

export function helicopterPassengerInLoadedSector(save: SaveGame, s: SavedSoldier): boolean {
  return enteringTheLoadedSector(save, s) && seatedInHelicopter(save, s);
}

function helicopterSeatInLoadedSector(save: SaveGame, s: SavedSoldier): boolean {
  return enteringTheLoadedSector(save, s) && !seatedInHelicopter(save, s) && waitingForTheHelicopterDrop(s);
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

function importAwaySoldiers(t: TacticalState, save: SaveGame, soldiers: SavedSoldiers): void {
  for (const [s, r] of withSavedRecords(save, soldiers)) {
    if (!awayInLoadedSector(save, r)) continue;
    t.soldiers[s.id] = s;
    s.away = true;
    t.awaySlots.push(s);
  }
}

function enteringTheMercSlots(save: SaveGame, s: SavedSoldier): boolean {
  return s.id < TOTAL_SOLDIERS && (inLoadedSector(save, s) || helicopterPassengerInLoadedSector(save, s));
}

function importSoldiers(t: TacticalState, save: SaveGame, soldiers: SavedSoldiers): number {
  let placed = 0;
  for (const [s, r] of withSavedRecords(save, soldiers)) {
    if (!enteringTheMercSlots(save, r)) continue;
    if (helicopterPassengerInLoadedSector(save, r)) seatInTheHelicopterOnSectorEntry(t, s);
    else placeSoldier(t, s);
    keepSavedMotion(s, r);
    if (s.placed) placed++;
  }
  return placed;
}

function seatHelicopterDropArrivals(t: TacticalState, save: SaveGame): void {
  for (const entry of save.soldiers)
    if (helicopterSeatInLoadedSector(save, entry.soldier)) addMercToHeli(t.helicopterDrop, entry.soldier.id);
}

function importFacing(s: Soldier, r: SavedSoldier): void {
  s.direction = r.direction;
  s.hiResDirection = r.hiResDirection;
  s.desiredDirection = r.desiredDirection;
  s.turnIncrement = r.motion.turningIncrement;
}

function placeSoldier(t: TacticalState, s: Soldier): void {
  registerSoldier(t, s);
  setSoldierPosition(t, s, s.gridNo, { keepDestination: true, keepFinalDestination: true });
}

function keepSavedMotion(s: Soldier, r: SavedSoldier): void {
  s.oldGridNo = grid(r.oldGridNo);
  s.overTerrain = r.overTerrainType;
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
  importFacing(s, r);
  s.overTerrain = r.overTerrainType;
  s.pc = r.aniCode;
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
  s.pendingActionCounterLocked = (r.statusFlags & SoldierStatusFlags.LOCKPENDINGACTIONCOUNTER) !== 0;
  s.engagedInAction = (r.statusFlags & SoldierStatusFlags.ENGAGEDINACTION) !== 0;
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
  s.destX = m.destXPos;
  s.destY = m.destYPos;
  s.pastX = m.pastXDest;
  s.pastY = m.pastYDest;
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
const DISALLOW_SIGHT = 0x00001000;
const CHECK_SIGHT_AT_END_OF_ATTACK = 0x00002000;

function importTacticalStatus(t: TacticalState, save: SaveGame): void {
  const ts = save.tactical;
  const turn = t.turn;
  t.inCombat = ts.inCombat;
  turn.currentTeam = ts.currentTeam;
  turn.attackBusyCount = ts.attackBusyCount;
  t.perception.disallowSight = (ts.flags & DISALLOW_SIGHT) !== 0;
  turn.checkSightAtEndOfAttack = (ts.flags & CHECK_SIGHT_AT_END_OF_ATTACK) !== 0;
  turn.interruptOccurred = ts.interruptOccurred;
  turn.virginSector = ts.virginSector;
  turn.enemyInSector = ts.enemyInSector;
  turn.someoneHit = ts.someoneHit;
  turn.enemyOfferedSurrender = (ts.enemyFlags & ENEMY_OFFERED_SURRENDER) !== 0;
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
  });
  turn.enemySightingOnTheirTurn = null;
  turn.hiddenInterrupt = save.teamTurns.hiddenInterrupt;
}

function linkTacticalStatus(t: TacticalState, save: SaveGame): void {
  const ts = save.tactical;
  const turn = t.turn;
  turn.itemsSeenOnAttack = ts.itemsSeenOnAttack ? soldierById(t, ts.itemsSeenOnAttackSoldier) : null;
  ts.teams.forEach((team, k) => {
    t.perception.lastMercToRadio[k] = soldierById(t, team.lastMercToRadio);
  });
  const turns = save.teamTurns;
  turn.intList.length = 0;
  for (const id of turns.outOfTurnOrder) {
    const s = soldierById(t, id);
    if (s) turn.intList.push(s);
  }
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
