// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (tactical part), LoadOppListInfoFromSavedGame; Tactical/Tactical_Save.cc
// @src LoadCurrentSectorsInformationFromTempItemsFile, LoadAndAddWorldItemsFromTempFile, LoadRottingCorpsesFromTempCorpseFile;
// @src TileEngine/SaveLoadMap.cc LoadAllMapChangesFromMapTempFileAndApplyThem, SetOpenableStructStatusFromMapTempFile,
// @src AddBloodOrSmellFromMapTempFileToMap;
// @src Tactical/Keys.cc LoadDoorStatusArrayFromDoorStatusTempFile, SynchronizeDoorStatusToStructureData;
// @src Tactical/Soldier_Add.cc AddSoldierToSectorGridNo (loading branch); TileEngine/WorldDef.cc LoadMapLights (light time
// @src from the saved clock); Strategic/Scheduling.cc LoadSchedulesFromSave; Tactical/Soldier_Add.cc InternalAddSoldierToSector
// @src (away slots of off-map soldiers).

import { frameSlotOfSpriteFrame, type PresentationTimeline } from '../../content/anim/timelines.ts';
import type { MapDoor } from '../../content/formats/map.ts';
import type { SavedSoldierEntry, SaveGame } from '../../content/formats/savegame.ts';
import type { SavedSoldier } from '../../content/formats/savegame-soldier.ts';
import { MapModificationType, type SavedCorpse, type SavedDoorStatus } from '../../content/formats/savegame-temp-files.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { compileWorldMovementCosts } from '../../content/world/movement-costs.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { u8 } from '../../core/int.ts';
import { objectFromRecord } from '../items/object.ts';
import type { DroppedNativeOption } from '../options.ts';
import { importCivGroupHostility } from '../strategic/narrative/civ-groups.ts';
import { addCorpseStructure } from './combat/death.ts';
import { setOpenableStructStatus, swapStructureForPartner } from './doors.ts';
import { NUM_INV_SLOTS } from './inventory.ts';
import { lightSetBaseLevel, loadMapLights } from './lighting/lighting.ts';
import { setSoldierPosition } from './movement.ts';
import { loadSavedSchedules } from './narrative/schedule-state.ts';
import { progressFromProfile } from './profiles.ts';
import { restoreBloodAndSmellAt } from './smell.ts';
import {
  createSoldier,
  NO_PENDING_ANIMATION,
  NO_PENDING_DIRECTION,
  NOWHERE,
  type Soldier,
  SoldierStatusFlags,
  TOTAL_SOLDIERS,
} from './soldier.ts';
import { registerSoldier, type TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { addItemToPool, WorldItemFlags } from './world-items.ts';

const SECTOR_ROW_LETTERS = 'abcdefghijklmnop';
const DOOR_OPEN = 0x01;
const DOOR_PERCEIVED_OPEN = 0x02;
const NOBODY = TOTAL_SOLDIERS;
const SAVED_OPPLIST_ENTRIES = 148;
const SOLDIER_QUOTE_SAID_BEING_PUMMELED = 0x0004;
const SOLDIER_QUOTE_SAID_EXT_CLOSE_CALL = 0x0008;
const INT16_BYTES = 2;
const MAX_TEAMS = 6;
const SAVED_NO_PENDING_ANIMATION = 32001;
const SAVED_NO_PENDING_DIRECTION = 253;
const SAVED_NO_PENDING_STANCE = 254;
const NO_DESIRED_HEIGHT = 255;
const SAVED_NOWHERE = WORLD_MAX + 1;
const SOLDIER_MISC_HEARD_GUNSHOT = 0x01;
const AI_FLAG_ASLEEP = 0x20;
const AI_FLAG_LOCK_DOOR_INCLUDES_CLOSE = 0x40;
const AI_FLAG_CHECK_SCHEDULE = 0x80;

export interface SaveImportReport {
  readonly mapPath: string;
  readonly soldiers: number;
  readonly worldItems: number;
  readonly corpses: number;
  readonly skippedMapModifications: number;
  readonly droppedOptions?: readonly DroppedNativeOption[];
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
  importCivGroupHostility(t.civGroups, save.tactical.civGroupHostile);
  save.keyTable.forEach((k, id) => {
    const entry = t.keyTable[id];
    if (entry) Object.assign(entry, k);
  });
  importProfileProgress(t, save);
  loadSavedSectorLights(sim, save);
  const worldItems = importWorldItems(t, save, sim.world.map.info.centerGridNo);
  const corpses = importCorpses(t, save.currentSector.corpses ?? []);
  const skippedMapModifications = applyMapModifications(t, save);
  applyDoorStatus(t, save.currentSector.doorStatus ?? []);
  t.world.costs.values.set(compileWorldMovementCosts(t.world).values);
  const soldiers = importSoldiers(t, save, presentation);
  importAwaySoldiers(t, save);
  t.schedules = loadSavedSchedules(save.schedules, (id) => activeSoldier(t, id));
  importOpplists(t, save);
  importTurnState(t, save);
  t.pre.restore({ ring: save.preRandom.numbers, index: save.preRandom.index });
  lightSetBaseLevel(t, savedAmbientLight(sim, save));
  return { mapPath: sim.mapPath, soldiers, worldItems, corpses, skippedMapModifications };
}

function importProfileProgress(t: TacticalState, save: SaveGame): void {
  save.profiles.forEach((p, id) => {
    if (p) t.profiles.set(id, progressFromProfile(p, p, true));
  });
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
  t.worldItems.length = 0;
  for (const wi of items) {
    if (!wi.exists) continue;
    const gridNo = wi.flags & WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT ? centre : wi.gridNo;
    addItemToPool(t, gridNo, objectFromRecord(wi.object), wi.visible, wi.level, wi.flags, wi.renderZHeightAboveLevel);
  }
  return t.worldItems.length;
}

const ROTTING_CORPSE_USE_CAMO_PALETTE = 0x20;

function importCorpses(t: TacticalState, corpses: readonly SavedCorpse[]): number {
  t.corpses.length = 0;
  for (const c of corpses) {
    if (c.gridNo < 0 || c.gridNo >= WORLD_MAX) continue;
    t.corpses.push({
      gridNo: c.gridNo,
      level: c.level,
      bodyType: c.bodyType,
      direction: c.direction,
      state: 0,
      profile: c.profile,
      type: c.type,
      timeOfDeath: c.timeOfDeath,
      palettes: [c.palettes.head, c.palettes.skin, c.palettes.vest, c.palettes.pants],
      ...(c.flags & ROTTING_CORPSE_USE_CAMO_PALETTE ? { camo: true } : {}),
    });
    addCorpseStructure(t, c.gridNo, c.level, c.type, c.direction);
  }
  return t.corpses.length;
}

function applyMapModifications(t: TacticalState, save: SaveGame): number {
  let skipped = 0;
  for (const m of save.currentSector.mapModifications ?? []) {
    if (m.type === MapModificationType.OPENABLE_STRUCT) setOpenableStructStatus(t, m.gridNo, m.imageType !== 0);
    else if (m.type === MapModificationType.BLOOD_SMELL) restoreBloodAndSmell(t, m.gridNo, m.imageType, m.subImageIndex);
    else skipped++;
  }
  return skipped;
}

function restoreBloodAndSmell(t: TacticalState, gridNo: number, blood: number, smell: number): void {
  if (gridNo >= 0 && gridNo < WORLD_MAX) restoreBloodAndSmellAt(t, gridNo, blood, smell);
}

function applyDoorStatus(t: TacticalState, statuses: readonly SavedDoorStatus[]): void {
  t.doorStatus.clear();
  for (const d of statuses) {
    t.doorStatus.set(d.gridNo, { perceivedOpen: (d.flags & DOOR_PERCEIVED_OPEN) !== 0 });
    const door = t.world.structures.find(d.gridNo, StructureFlags.ANYDOOR);
    if (!door || has(door.flags, StructureFlags.OPEN) === ((d.flags & DOOR_OPEN) !== 0)) continue;
    const base = t.world.structures.findBase(door);
    if (base) swapStructureForPartner(t, base);
  }
}

export function inLoadedSector(save: SaveGame, s: SavedSoldier): boolean {
  const sector = save.tactical.worldSector;
  return (
    s.active !== 0 &&
    !s.betweenSectors &&
    s.sector.x === sector.x &&
    s.sector.y === sector.y &&
    s.sector.z === sector.z &&
    !(s.statusFlags & (SoldierStatusFlags.DEAD | SoldierStatusFlags.OFF_MAP | SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER))
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
    s.direction = r.direction;
    s.desiredDirection = r.desiredDirection;
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

function placeSoldier(t: TacticalState, save: SaveGame, entry: SavedSoldierEntry, presentation: PresentationTimeline): Soldier {
  const r = entry.soldier;
  const s = createSavedSoldier(save, entry);
  registerSoldier(t, s);
  s.destination = r.gridNo;
  setSoldierPosition(t, s, r.gridNo, { keepDestination: true, keepFinalDestination: true });
  s.destination = grid(r.destination);
  s.finalDestination = grid(r.finalDestination);
  s.oldGridNo = grid(r.oldGridNo);
  s.direction = r.direction;
  s.desiredDirection = r.desiredDirection;
  s.overTerrain = r.overTerrainType;
  s.pc = r.aniCode;
  s.frameSlot = frameSlotOfSpriteFrame(presentation, r.animState, r.aniCode, r.aniFrame);
  s.nextFrameAt = t.clockMs;
  s.reservedGridNo = grid(r.motion.reservedGridNo);
  if (s.reservedGridNo !== NOWHERE && s.reservedGridNo >= 0 && s.reservedGridNo < WORLD_MAX) t.reserved[s.reservedGridNo] = s.id;
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
  s.heardGunshot = (r.miscSoldierFlags & SOLDIER_MISC_HEARD_GUNSHOT) !== 0;
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
  s.hasKeys = r.hasKeys !== 0;
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
  s.heightAdjustment = r.heightAdjustment;
  s.uiMovementMode = m.uiMovementMode;
  s.movementDirection = m.movementDirection;
  s.reverse = m.reverse !== 0;
  s.noAPToFinishMove = m.noAPToFinishMove;
  s.pendingAnimation = unlessSentinel(r.pendingAnimation, SAVED_NO_PENDING_ANIMATION, NO_PENDING_ANIMATION);
  s.pendingDirection = unlessSentinel(m.pendingDirection, SAVED_NO_PENDING_DIRECTION, NO_PENDING_DIRECTION);
  s.pendingStanceChange = unlessSentinel(m.pendingStanceChange, SAVED_NO_PENDING_STANCE, NO_DESIRED_HEIGHT);
  s.desiredHeight = m.desiredHeight;
  s.forecastGridNo = grid(m.forecastGridNo);
  s.inNonInterruptibleAnimation = m.inNonInterruptibleAnimation;
  s.rtNonInterruptible = m.rtNonInterruptible;
  s.turningUntilDone = m.turningUntilDone;
  s.continueMoveAfterStanceChange = m.continueMoveAfterStanceChange ? 1 : 0;
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
  s.delayedMovement = m.delayedMovement ? 1 : 0;
  s.newOppCnt = m.newOppCount;
  s.movementNoiseHeard = m.movementNoiseHeard;
  s.oldLife = m.oldLife;
  s.dontChargeReadyAPs = m.dontChargeReadyAPs;
  s.dontChargeAPsForStanceChange = m.dontChargeAPsForStanceChange;
  s.dontChargeTurningAPs = m.dontChargeTurningAPs;
  s.turnsUntilCanSayHeardNoise = m.turnsUntilCanSayHeardNoise;
  s.pummeledQuoteSaid = (r.quoteSaidFlags & SOLDIER_QUOTE_SAID_BEING_PUMMELED) !== 0;
  s.closeCallQuoteSaid = (r.quoteSaidExtFlags & SOLDIER_QUOTE_SAID_EXT_CLOSE_CALL) !== 0;
  s.dontUnsetLastTargetFromTurn = m.dontUnsetLastTargetFromTurn;
  s.tilesMovedPerRTBreathUpdate = m.tilesMovedPerRTBreathUpdate;
  s.lastMovementAnimPerRTBreathUpdate = m.lastMovementAnimPerRTBreathUpdate;
  s.pendingActionData1 = m.pendingActionData1;
  s.pendingActionData2 = m.pendingActionData2;
  s.lastRenderVisible = m.lastRenderVisible;
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
}

function int16At(bytes: Uint8Array, index: number): number | null {
  const at = index * INT16_BYTES;
  if (at + INT16_BYTES > bytes.length) return null;
  return (((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)) << 16) >> 16;
}

function importOpplists(t: TacticalState, save: SaveGame): void {
  const o = save.oppList;
  const p = t.perception;
  for (let team = 0; team < MAX_TEAMS; team++) {
    const publicOpp = p.publicOpp[team];
    const publicLastKnown = p.publicLastKnown[team];
    if (!publicOpp || !publicLastKnown) continue;
    (o.publicOpplist[team] ?? []).forEach((v, k) => {
      publicOpp[k] = v;
    });
    for (let k = 0; k < TOTAL_SOLDIERS; k++)
      publicLastKnown[k] = grid(int16At(o.publicLastKnownOppLocBytes, team * TOTAL_SOLDIERS + k) ?? NOWHERE);
    p.publicNoiseVolume[team] = o.publicNoiseVolume[team] ?? 0;
    p.publicNoiseGridNo[team] = grid(int16At(o.publicNoiseGridNoBytes, team) ?? NOWHERE);
  }
  for (const s of t.soldiers) {
    if (!s) continue;
    for (let k = 0; k < TOTAL_SOLDIERS; k++)
      s.lastKnownOpp[k] = grid(int16At(o.lastKnownOppLocBytes, s.id * TOTAL_SOLDIERS + k) ?? NOWHERE);
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
  turn.spottersCalledForBy = ts.spottersCalledForBy;
  turn.consNumTurnsNotSeen = ts.consecutiveTurnsNotSeen;
  turn.consNumTurnsWeHaventSeenButEnemyDoes = ts.consecutiveTurnsWeHaventSeenButEnemyDoes;
  turn.unlockUIAfterHiddenInterrupt = ts.unlockUiAfterHiddenInterrupt;
  t.smell.lastDecaySeconds = ts.decayBloodLastUpdate;
  t.realtimeClock.lastOpplistDecaySeconds = ts.timeSinceLastOpplistDecay;
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
}
