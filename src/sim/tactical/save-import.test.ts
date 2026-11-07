import { beforeAll, describe, expect, it } from 'vitest';
import { stubProfiles } from '../../../tests/support/contracts.ts';
import { loadTestContent, loadTestTimelines, testDoorCosts } from '../../../tests/support/tactical.ts';
import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { SavedSoldierEntry, SavedVehicle, SaveGame } from '../../content/formats/savegame.ts';
import { layoutOffsets } from '../../content/formats/savegame-layout.ts';
import type { SavedMercProfile } from '../../content/formats/savegame-profile.ts';
import { decodeSoldierRecord, SOLDIER_LAYOUT, SOLDIER_RECORD_BYTES } from '../../content/formats/savegame-soldier.ts';
import type { SavedCorpse, SavedWorldItem } from '../../content/formats/savegame-temp-files.ts';
import { gridNo, WORLD_MAX } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticMap, syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { createRosterState } from '../campaign/merc-record.ts';
import { Roster } from '../campaign/roster.ts';
import { addSavedMercsToRoster } from '../campaign/save-roster.ts';
import { NO_VEHICLE, VehicleSeat } from '../strategic/forces/constants.ts';
import { createStrategicState } from '../strategic/state.ts';
import { VehicleTypeId } from '../vehicles/vehicle-list.ts';
import { states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { Direction } from './directions.ts';
import { LightSpriteFlags, lightTrueLevel } from './lighting/lighting.ts';
import { RevealedFlags, revealedRooms } from './perception/fov.ts';
import { handleCrowLeave } from './rotting-corpses.ts';
import { importCampaignWideState, importSave, loadSavedSectorChanges, NO_SAVED_SECTOR_CHANGES } from './save-import.ts';
import {
  Body,
  cellCentre,
  NO_PENDING_ANIMATION,
  NO_PENDING_DIRECTION,
  NOWHERE,
  type Soldier,
  SoldierFade,
  Team,
  TOTAL_SOLDIERS,
  Visible,
} from './soldier.ts';
import { whoIsThere } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';
import { WorldItemFlags } from './world-items.ts';

let content: TacticalContent;
let presentation: PresentationTimeline;

beforeAll(async () => {
  content = await loadTestContent();
  presentation = (await loadTestTimelines()).presentation;
});

const SAVE_VERSION = 99;
const SECTOR = { x: 13, y: 4, z: 0 };
const CENTRE = gridNo(80, 80);
const MERC_ID = 3;
const CIVILIAN_ID = 120;
const MAX_TEAMS = 6;
const SAVED_NOWHERE = WORLD_MAX + 1;
const INT16_BYTES = 2;
const NOBODY = TOTAL_SOLDIERS;
const SMERC_FWD = 3;
const ROTTING_CORPSE_FIND_SWEETSPOT = 0x01;
const SOLDIER_LOOKFOR_ITEMS = 0x200;
const SOLDIER_GASSED = 0x01000000;
const SOLDIER_DEAD = 0x00000080;
const SOLDIER_MISC_XRAYED = 0x04;
const DOOR_HAS_TIN_CAN = 0x10;

type SoldierFields = Readonly<Record<string, number>>;

function soldierRecord(fields: SoldierFields): Uint8Array {
  const bytes = new Uint8Array(SOLDIER_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  const offsets = layoutOffsets(SOLDIER_LAYOUT, false);
  for (const [name, value] of Object.entries(fields)) {
    const entry = SOLDIER_LAYOUT.find((e) => e.name === name);
    const at = offsets.get(name);
    if (entry?.kind !== 'scalar' || at === undefined) throw new Error(`no scalar field ${name}`);
    if (entry.type === 'u8' || entry.type === 'bool' || entry.type === 'i8') view.setUint8(at, value);
    else if (entry.type === 'u16' || entry.type === 'i16') view.setUint16(at, value, true);
    else if (entry.type === 'u32' || entry.type === 'i32') view.setUint32(at, value, true);
    else if (entry.type === 'f32') view.setFloat32(at, value, true);
    else throw new Error(`cannot fill ${name}`);
  }
  return bytes;
}

type SoldierArrays = Readonly<Record<string, readonly number[]>>;

function fillInt8Arrays(record: Uint8Array, arrays: SoldierArrays): void {
  const offsets = layoutOffsets(SOLDIER_LAYOUT, false);
  for (const [name, values] of Object.entries(arrays)) {
    const at = offsets.get(name);
    if (at === undefined) throw new Error(`no field ${name}`);
    values.forEach((v, k) => {
      new DataView(record.buffer).setInt8(at + k, v);
    });
  }
}

function savedSoldier(id: number, team: number, at: number, extra: SoldierFields = {}, arrays: SoldierArrays = {}): SavedSoldierEntry {
  const standing = states(content.animations).STANDING;
  const record = soldierRecord({
    ubID: id,
    bTeam: team,
    bActive: 1,
    bInSector: 1,
    sGridNo: at,
    sDestination: at,
    sFinalDestination: at,
    sSectorX: SECTOR.x,
    sSectorY: SECTOR.y,
    bLife: 50,
    bLifeMax: 50,
    bBreath: 100,
    usAnimState: standing,
    usPendingAnimation: 32001,
    ubPendingDirection: 253,
    sReservedMovementGridNo: SAVED_NOWHERE,
    ...extra,
  });
  fillInt8Arrays(record, arrays);
  return { soldier: decodeSoldierRecord(record, SAVE_VERSION, false), mercPath: [], keyRing: null };
}

interface SyntheticSave {
  readonly soldiers?: readonly SavedSoldierEntry[];
  readonly vehicles?: readonly SavedVehicle[];
  readonly lastKnownOppLocBytes?: Uint8Array;
  readonly lastKnownOppLevel?: readonly (readonly number[])[];
  readonly publicLastKnownOppLevel?: readonly (readonly number[])[];
  readonly worldItems?: readonly SavedWorldItem[];
  readonly corpses?: readonly SavedCorpse[];
  readonly tactical?: Readonly<Record<string, unknown>>;
}

function levelRows(count: number, entries: readonly (readonly [row: number, opponent: number, level: number])[] = []): number[][] {
  const rows = Array.from({ length: count }, () => new Array<number>(TOTAL_SOLDIERS).fill(0));
  for (const [row, opponent, level] of entries) (rows[row] as number[])[opponent] = level;
  return rows;
}

function syntheticSave({
  soldiers = [],
  vehicles = [],
  lastKnownOppLocBytes = new Uint8Array(TOTAL_SOLDIERS * TOTAL_SOLDIERS),
  lastKnownOppLevel = levelRows(TOTAL_SOLDIERS),
  publicLastKnownOppLevel = levelRows(MAX_TEAMS),
  worldItems,
  corpses,
  tactical,
}: SyntheticSave): SaveGame {
  return {
    generalInfo: { baseJA2Clock: 0, selectedSoldier: NOBODY },
    tactical: {
      worldSector: SECTOR,
      civGroupHostile: [],
      inCombat: false,
      currentTeam: Team.OUR,
      attackBusyCount: 0,
      interruptOccurred: false,
      virginSector: false,
      enemyInSector: false,
      someoneHit: 0,
      enemyFlags: 0,
      spottersCalledForBy: NOBODY,
      consecutiveTurnsNotSeen: 0,
      consecutiveTurnsWeHaventSeenButEnemyDoes: 0,
      unlockUiAfterHiddenInterrupt: false,
      decayBloodLastUpdate: 0,
      timeSinceLastOpplistDecay: 0,
      numFoughtInBattle: [],
      teams: [],
      itemsSeenOnAttack: false,
      itemsSeenOnAttackSoldier: NOBODY,
      itemsSeenOnAttackGridNo: 0,
      lockItemLocators: false,
      numCrowsPossible: 0,
      dontAddNewCrows: false,
      autoBandagePending: false,
      creatureTenseQuoteDelay: 0,
      creatureTenseQuoteLastUpdate: 0,
      panicFlags: 0,
      theChosenOne: NOBODY,
      armyGuysKilled: 0,
      panicTriggers: [],
      ...tactical,
    },
    keyTable: [],
    profiles: [],
    worldTime: { hour: 12 },
    clock: { envLightValue: 3 },
    currentSector: { worldItems: worldItems ?? null, corpses: corpses ?? null, mapModifications: null, doorStatus: null, doors: null },
    soldiers,
    vehicles,
    schedules: [],
    oppList: {
      publicOpplist: [],
      seenOpponents: [],
      lastKnownOppLocBytes,
      lastKnownOppLevel,
      publicLastKnownOppLocBytes: new Uint8Array(MAX_TEAMS * TOTAL_SOLDIERS),
      publicLastKnownOppLevel,
      publicNoiseVolume: [],
      publicNoiseGridNoBytes: new Uint8Array(MAX_TEAMS),
    },
    watchedLocations: { gridNo: [], level: [], points: [], reset: [] },
    teamTurns: { outOfTurnOrder: [], hiddenInterrupt: false, lastInterruptedGuy: NOBODY, whoThrewRock: NOBODY },
    preRandom: { index: 0, numbers: Array.from({ length: 256 }, () => 0) },
  } as unknown as SaveGame;
}

function importedSim(save: SaveGame, blocked: readonly number[] = [], mapFields: Readonly<Record<string, unknown>> = {}): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), (structures) => {
    for (const g of blocked) structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
  });
  const world = {
    ...base,
    map: syntheticMap({ info: { centerGridNo: CENTRE }, ...mapFields }),
    mapPath: 'synthetic',
  } as unknown as TacticalWorld;
  const sim = new TacticalSim(world, content, 1);
  importSave(sim, save, presentation);
  return sim;
}

function soldierOf(sim: TacticalSim, id: number): Soldier {
  const s = sim.state.soldiers[id];
  if (!s) throw new Error(`soldier ${id} was not imported`);
  return s;
}

function lastKnownOppLocBytes(entries: readonly (readonly [viewer: number, opponent: number, gridNo: number])[]): Uint8Array {
  const bytes = new Uint8Array(TOTAL_SOLDIERS * TOTAL_SOLDIERS);
  const view = new DataView(bytes.buffer);
  for (const [viewer, opponent, g] of entries) view.setInt16((viewer * TOTAL_SOLDIERS + opponent) * INT16_BYTES, g, true);
  return bytes;
}

function savedWorldItem(item: number, at: number, flags: number): SavedWorldItem {
  return {
    index: 0,
    exists: true,
    gridNo: at,
    level: 0,
    object: {
      item,
      count: 1,
      status: [100, 0, 0, 0, 0, 0, 0, 0],
      gunStatus: 100,
      gunAmmoType: 0,
      gunShotsLeft: 0,
      gunAmmoItem: 0,
      gunAmmoStatus: 0,
      money: 0,
      attachments: [],
      flags: 0,
      mission: 0,
      trap: 0,
      imprintId: 0,
      keyId: 0,
    },
    flags,
    renderZHeightAboveLevel: 0,
    visible: 1,
    nonExistChance: 0,
  };
}

function savedCorpse(at: number, flags: number): SavedCorpse {
  return {
    type: SMERC_FWD,
    bodyType: 0,
    gridNo: at,
    heightAdjustment: 0,
    palettes: { head: 'BROWNHEAD', pants: 'GREENPANTS', vest: 'YELLOWVEST', skin: 'PINKSKIN' },
    direction: Direction.SOUTH,
    timeOfDeath: 0,
    flags,
    level: 0,
    visible: 1,
    servicingCrows: 0,
    profile: 200,
    headTaken: false,
    aiWarningValue: 0,
  };
}

describe('importSave, the tactical part of LoadSavedGame', () => {
  it('drops a saved movement reservation and pending animation: adding a soldier to the sector clears them (Soldier_Add.cc AddSoldierToSectorGridNo)', () => {
    const walker = gridNo(80, 82);
    const reserved = gridNo(80, 83);
    const save = syntheticSave({
      soldiers: [
        savedSoldier(CIVILIAN_ID, Team.CIV, walker, {
          sReservedMovementGridNo: reserved,
          usPendingAnimation: states(content.animations).WALKING,
          ubPendingDirection: 4,
        }),
      ],
    });
    const sim = importedSim(save);
    const civilian = soldierOf(sim, CIVILIAN_ID);
    expect(civilian.gridNo).toBe(walker);
    expect(civilian.reservedGridNo).toBe(NOWHERE);
    expect(sim.state.reserved[reserved]).toBe(-1);
    expect(civilian.pendingAnimation).toBe(NO_PENDING_ANIMATION);
    expect(civilian.pendingDirection).toBe(NO_PENDING_DIRECTION);
  });

  it('reads both drug courses, adrenaline first, and the regeneration counters (LoadSaveSoldierType.cc)', () => {
    const drugs = {
      bFutureDrugEffect: [3, 6],
      bDrugEffectRate: [4, -2],
      bDrugEffect: [12, 24],
      bDrugSideEffectRate: [0, 1],
      bDrugSideEffect: [20, 9],
    };
    const regen = { bRegenerationCounter: 2, bRegenBoostersUsedToday: 3 };
    const save = syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), regen, drugs)] });
    const merc = soldierOf(importedSim(save), MERC_ID);
    expect(merc.drugs).toEqual({
      adrenaline: { future: 3, rate: 4, effect: 12, sideEffectRate: 0, sideEffect: 20 },
      alcohol: { future: 6, rate: -2, effect: 24, sideEffectRate: 1, sideEffect: 9 },
    });
    expect([merc.regenerationCounter, merc.regenBoostersUsedToday]).toEqual([2, 3]);
  });

  it('keeps the height a crow is flying to (sDesiredHeight)', () => {
    const save = syntheticSave({ soldiers: [savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(80, 82), { sDesiredHeight: 100 })] });
    expect(soldierOf(importedSim(save), CIVILIAN_ID).targetHeightAdjustment).toBe(100);
  });

  it('restores the personal last-known locations of soldiers 0-77 only, the rest keep the zeroed memory of a fresh process: the original saves the INT16 array with its element count as byte count (SaveLoadGame.cc LoadOppListInfoFromSavedGame, TODO000F)', () => {
    const merc = gridNo(80, 82);
    const civilian = gridNo(90, 82);
    const seenAt = gridNo(91, 83);
    const save = syntheticSave({
      soldiers: [savedSoldier(MERC_ID, Team.OUR, merc), savedSoldier(CIVILIAN_ID, Team.CIV, civilian)],
      lastKnownOppLocBytes: lastKnownOppLocBytes([
        [MERC_ID, CIVILIAN_ID, seenAt],
        [MERC_ID, MERC_ID + 1, SAVED_NOWHERE],
      ]),
    });
    const sim = importedSim(save);
    expect(soldierOf(sim, MERC_ID).lastKnownOpp[CIVILIAN_ID]).toBe(seenAt);
    expect(soldierOf(sim, MERC_ID).lastKnownOpp[MERC_ID + 1]).toBe(NOWHERE);
    expect(soldierOf(sim, CIVILIAN_ID).lastKnownOpp[MERC_ID]).toBe(0);
    expect(sim.state.perception.publicLastKnown[Team.MILITIA]?.[MERC_ID]).toBe(NOWHERE);
  });

  it('restores every last-known level, personal and public: the original saves the INT8 arrays whole (SaveLoadGame.cc LoadOppListInfoFromSavedGame)', () => {
    const roof = 1;
    const save = syntheticSave({
      soldiers: [savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82)), savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(90, 82))],
      lastKnownOppLevel: levelRows(TOTAL_SOLDIERS, [
        [MERC_ID, CIVILIAN_ID, roof],
        [CIVILIAN_ID, MERC_ID, roof],
      ]),
      publicLastKnownOppLevel: levelRows(MAX_TEAMS, [[Team.MILITIA, MERC_ID, roof]]),
    });
    const sim = importedSim(save);
    expect(soldierOf(sim, MERC_ID).lastKnownOppLevel[CIVILIAN_ID]).toBe(roof);
    expect(soldierOf(sim, CIVILIAN_ID).lastKnownOppLevel[MERC_ID]).toBe(roof);
    expect(soldierOf(sim, MERC_ID).lastKnownOppLevel[MERC_ID + 1]).toBe(0);
    expect(sim.state.perception.publicLastKnownLevel[Team.MILITIA]?.[MERC_ID]).toBe(roof);
  });

  it('moves an item dropped while its sector was unloaded to the nearest free tile, as every load of the temp file does (Tactical_Save.cc LoadAndAddWorldItemsFromTempFile)', () => {
    const blocked = gridNo(80, 84);
    const around = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => gridNo(80 + dx, 84 + dy))).filter((g) => g !== blocked);
    const knife = content.items.byName.get('COMBAT_KNIFE')?.index ?? -1;
    const dropped = savedWorldItem(knife, blocked, WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO | WorldItemFlags.REACHABLE);
    const placed = savedWorldItem(knife, blocked, WorldItemFlags.REACHABLE);
    const sim = importedSim(syntheticSave({ worldItems: [dropped, placed] }), [blocked]);
    const [moved, kept] = sim.state.worldItems;
    expect(around).toContain(moved?.gridNo);
    expect(kept?.gridNo).toBe(blocked);
  });

  it('moves a corpse dropped while its sector was unloaded to the nearest free tile, facing the first direction its structure fits, and keeps it searching at every load (Tactical_Save.cc LoadRottingCorpsesFromTempCorpseFile)', () => {
    const blocked = gridNo(80, 84);
    const north = gridNo(80, 83);
    const sim = importedSim(syntheticSave({ corpses: [savedCorpse(blocked, ROTTING_CORPSE_FIND_SWEETSPOT), savedCorpse(blocked, 0)] }), [
      blocked,
    ]);
    const [moved, kept] = sim.state.corpses;
    expect(moved).toMatchObject({ gridNo: north, direction: Direction.NORTH, findSweetSpot: true });
    expect(kept).toMatchObject({ gridNo: blocked, direction: Direction.SOUTH });
    expect(kept?.findSweetSpot).toBeUndefined();
  });

  it('keeps the ubMission of a saved object, which no game logic sets (LoadSaveObjectType.cc ExtractObject)', () => {
    const at = gridNo(80, 84);
    const knife = content.items.byName.get('COMBAT_KNIFE')?.index ?? -1;
    const saved = savedWorldItem(knife, at, WorldItemFlags.REACHABLE);
    const sim = importedSim(syntheticSave({ worldItems: [{ ...saved, object: { ...saved.object, mission: 3 } }] }));
    expect(sim.state.worldItems[0]?.object.mission).toBe(3);
  });

  it('keeps whether a saved corpse lost its head (fHeadTaken)', () => {
    const at = gridNo(80, 84);
    const sim = importedSim(syntheticSave({ corpses: [{ ...savedCorpse(at, 0), headTaken: true }, savedCorpse(at + 2, 0)] }));
    expect(sim.state.corpses.map((c) => c.headTaken)).toEqual([true, false]);
  });

  it('keeps the height a saved corpse is drawn at above its level (sHeightAdjustment)', () => {
    const at = gridNo(80, 84);
    const sim = importedSim(syntheticSave({ corpses: [{ ...savedCorpse(at, 0), heightAdjustment: 58 }, savedCorpse(at + 2, 0)] }));
    expect(sim.state.corpses.map((c) => c.heightAdjustment)).toEqual([58, 0]);
  });

  it('keeps how many breathing loops passed since the last random idle animation check (uiTimeOfLastRandomAction)', () => {
    const save = syntheticSave({ soldiers: [savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(80, 82), { uiTimeOfLastRandomAction: 2 })] });
    expect(soldierOf(importedSim(save), CIVILIAN_ID).timeOfLastRandomAction).toBe(2);
  });

  it('keeps the crows feeding on a saved corpse and the corpse each saved crow feeds on (bNumServicingCrows, uiPendingActionData1, sPendingActionData2)', () => {
    const at = gridNo(80, 84);
    const save = syntheticSave({
      corpses: [savedCorpse(at - 4, 0), { ...savedCorpse(at, 0), servicingCrows: 2 }],
      soldiers: [savedSoldier(CIVILIAN_ID, Team.CIV, at + 1, { ubBodyType: Body.CROW, uiPendingActionData1: 1, sPendingActionData2: at })],
    });
    const sim = importedSim(save);
    expect(sim.state.corpses.map((c) => c.servicingCrows)).toEqual([0, 2]);
    handleCrowLeave(sim.state, soldierOf(sim, CIVILIAN_ID));
    expect(sim.state.corpses.map((c) => c.servicingCrows)).toEqual([0, 1]);
  });

  it('puts a soldier saved mid-step at the centre of his saved tile, as setting his position on load does (Soldier_Add.cc AddSoldierToSectorGridNo)', () => {
    const at = gridNo(80, 82);
    const centre = cellCentre(at);
    const save = syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, at, { dXPos: centre.x + 3, dYPos: centre.y - 2 })] });
    const merc = soldierOf(importedSim(save), MERC_ID);
    expect([merc.gridNo, merc.x, merc.y]).toEqual([at, centre.x, centre.y]);
  });

  it('keeps the centre of the tile a walking soldier steps to and whether he is past it on each axis, which only a step sets (sDestXPos, sDestYPos, fPastXDest, fPastYDest)', () => {
    const at = gridNo(38, 63);
    const next = cellCentre(gridNo(39, 62));
    const save = syntheticSave({
      soldiers: [
        savedSoldier(CIVILIAN_ID, Team.CIV, at, { sDestination: gridNo(39, 62), sDestXPos: next.x, sDestYPos: next.y, fPastXDest: 1 }),
      ],
    });
    const walker = soldierOf(importedSim(save), CIVILIAN_ID);
    expect([walker.destX, walker.destY, walker.pastX, walker.pastY]).toEqual([next.x, next.y, true, false]);
  });

  it('restores the fades in progress, a fade-in included: fBeginFade is a byte that keeps its 2 (LoadSaveSoldierType.cc ExtractSoldierType)', () => {
    const fadingIn = gridNo(80, 82);
    const fadingOut = gridNo(90, 82);
    const fadeOut = { bVisible: Visible.FADING_OUT, bLastRenderVisibleValue: Visible.FADING_OUT, fBeginFade: SoldierFade.OUT };
    const save = syntheticSave({
      soldiers: [
        savedSoldier(CIVILIAN_ID, Team.CIV, fadingIn, {
          bVisible: 1,
          bLastRenderVisibleValue: 1,
          fBeginFade: SoldierFade.IN,
          ubFadeLevel: 9,
          sLocationOfFadeStart: fadingIn,
        }),
        savedSoldier(CIVILIAN_ID + 1, Team.CIV, fadingOut, { ...fadeOut, ubFadeLevel: 7, sLocationOfFadeStart: SAVED_NOWHERE }),
      ],
    });
    const sim = importedSim(save);
    const fadeOf = (s: Soldier) => [s.visible, s.lastRenderVisible, s.fade, s.fadeShade, s.fadeStartGridNo];
    expect(fadeOf(soldierOf(sim, CIVILIAN_ID))).toEqual([1, 1, SoldierFade.IN, 9, fadingIn]);
    expect(fadeOf(soldierOf(sim, CIVILIAN_ID + 1))).toEqual([Visible.FADING_OUT, Visible.FADING_OUT, SoldierFade.OUT, 7, NOWHERE]);
  });

  it('restores the fence hop continuing a move and the wait for a tile at their stored byte values, not as flags (fContinueMoveAfterStanceChange, fDelayedMovement)', () => {
    const fenceHopContinuation = 2;
    const waitForTempBlockedTile = 100;
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), {
          fContinueMoveAfterStanceChange: fenceHopContinuation,
          fDelayedMovement: waitForTempBlockedTile,
        }),
      ],
    });
    const merc = soldierOf(importedSim(save), MERC_ID);
    expect([merc.continueMoveAfterStanceChange, merc.delayedMovement]).toEqual([fenceHopContinuation, waitForTempBlockedTile]);
  });

  it('restores an order to look for items, the item locator lock and a quote held for the end of an attack with its tile (SOLDIER_LOOKFOR_ITEMS, fLockItemLocators, fItemsSeenOnAttack, usItemsSeenOnAttackGridNo)', () => {
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { uiStatusFlags: SOLDIER_LOOKFOR_ITEMS }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82)),
      ],
      tactical: {
        itemsSeenOnAttack: true,
        itemsSeenOnAttackSoldier: MERC_ID,
        itemsSeenOnAttackGridNo: gridNo(80, 86),
        lockItemLocators: true,
      },
    });
    const sim = importedSim(save);
    const merc = soldierOf(sim, MERC_ID);
    expect([merc.lookForItems, soldierOf(sim, MERC_ID + 1).lookForItems]).toEqual([true, false]);
    const turn = sim.state.turn;
    expect([turn.lockItemLocators, turn.itemsSeenOnAttack, turn.itemsSeenOnAttackGridNo]).toEqual([true, merc, gridNo(80, 86)]);
  });

  it('restores the panic state, the chosen one by id, and a keys byte as the INT8 the panic stack may have wrapped (LoadSaveTacticalStatusType.cc, bHasKeys)', () => {
    const enemyId = 20;
    const trigger = { gridNo: gridNo(80, 70), isAlarm: 1, tolerance: 35 };
    const none = { gridNo: NOWHERE, isAlarm: 0, tolerance: 0 };
    const save = syntheticSave({
      soldiers: [savedSoldier(enemyId, Team.ENEMY, gridNo(80, 82), { bHasKeys: 0xc0 })],
      tactical: { panicFlags: 3, theChosenOne: enemyId, armyGuysKilled: 4, panicTriggers: [trigger, none, none] },
    });
    const sim = importedSim(save);
    const enemy = soldierOf(sim, enemyId);
    expect(sim.state.panic).toEqual({
      flags: 3,
      triggers: [
        { gridNo: gridNo(80, 70), isAlarm: true, tolerance: 35 },
        { gridNo: NOWHERE, isAlarm: false, tolerance: 0 },
        { gridNo: NOWHERE, isAlarm: false, tolerance: 0 },
      ],
      chosenOne: enemy,
      armyGuysKilled: 4,
    });
    expect(enemy.hasKeys).toBe(-64);
  });

  it('restores the x-ray: when a merc started it, and whom it shows by xrayed_by while SOLDIER_MISC_XRAYED is set', () => {
    const enemyId = 20;
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { uiXRayActivatedTime: 4321 }),
        savedSoldier(enemyId, Team.ENEMY, gridNo(80, 92), { ubMiscSoldierFlags: SOLDIER_MISC_XRAYED, xrayed_by: MERC_ID }),
        savedSoldier(enemyId + 1, Team.ENEMY, gridNo(84, 92), { xrayed_by: MERC_ID }),
      ],
    });
    const sim = importedSim(save);
    const merc = soldierOf(sim, MERC_ID);
    expect(merc.xrayActivatedTime).toBe(4321);
    expect([soldierOf(sim, enemyId).xrayedBy, soldierOf(sim, enemyId + 1).xrayedBy]).toEqual([merc, null]);
  });

  it('keeps a tin can on a door from the door status flags (DOOR_HAS_TIN_CAN)', () => {
    const sim = importedSim(syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82))] }));
    const [canned, plain] = [gridNo(70, 70), gridNo(72, 70)];
    loadSavedSectorChanges(sim, {
      mapModifications: null,
      revealed: null,
      doorStatus: [
        { gridNo: canned, flags: DOOR_HAS_TIN_CAN },
        { gridNo: plain, flags: 0 },
      ],
    });
    expect([sim.state.doorStatus.get(canned)?.hasTinCan, sim.state.doorStatus.get(plain)?.hasTinCan]).toEqual([true, false]);
  });

  it('restores the gassed state of a soldier (SOLDIER_GASSED)', () => {
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { uiStatusFlags: SOLDIER_GASSED }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82)),
      ],
    });
    const sim = importedSim(save);
    expect([soldierOf(sim, MERC_ID).gassed, soldierOf(sim, MERC_ID + 1).gassed]).toEqual([true, false]);
  });

  it('restores an out-of-ammo quote pending until the end of an attack (fSayAmmoQuotePending)', () => {
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { fSayAmmoQuotePending: 1 }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82)),
      ],
    });
    const sim = importedSim(save);
    expect([soldierOf(sim, MERC_ID).sayAmmoQuotePending, soldierOf(sim, MERC_ID + 1).sayAmmoQuotePending]).toEqual([true, false]);
  });

  it('restores the bleeding lines already said (fWarnedAboutBleeding, fDyingComment)', () => {
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { fWarnedAboutBleeding: 1 }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82), { fDyingComment: 1 }),
      ],
    });
    const sim = importedSim(save);
    const flags = (s: Soldier) => [s.warnedAboutBleeding, s.dyingComment];
    expect([flags(soldierOf(sim, MERC_ID)), flags(soldierOf(sim, MERC_ID + 1))]).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('restores the time left to the next bleeding point of a wounded soldier (dNextBleed)', () => {
    const halfwayToTheNextPoint = 4.7;
    const save = syntheticSave({
      soldiers: [savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { bBleeding: 6, dNextBleed: halfwayToTheNextPoint })],
    });
    expect(soldierOf(importedSim(save), MERC_ID).nextBleed).toBe(Math.fround(halfwayToTheNextPoint));
  });
});

describe('the revealed map of the loaded sector (SaveLoadMap.cc LoadRevealedStatusArrayFromRevealedTempFile, SetMapRevealedStatus)', () => {
  const ROOM = 4;
  const SEEN = gridNo(80, 84);
  const UNSEEN = gridNo(90, 84);
  const ROOF_SEEN = gridNo(100, 84);

  function caveImport(): TacticalSim {
    const sprites = [SEEN, UNSEEN].map((g) => ({ x: g % 160, y: Math.trunc(g / 160), flags: 0, template: 'L-R03.LHT' }));
    const sim = importedSim(syntheticSave({ tactical: { worldSector: { ...SECTOR, z: 1 } } }), [], {
      ambient: { basement: false, caves: true, lightLevel: 11 },
      lights: { colors: [[0, 0, 0]], sprites },
    });
    sim.state.world.level.rooms[SEEN] = ROOM;
    return sim;
  }

  it('reveals the saved tiles and their rooms, unreveals the ground of the others and switches on the cave light of each revealed tile', () => {
    const sim = caveImport();
    const t = sim.state;
    t.fog.revealed[UNSEEN] = RevealedFlags.GROUND;
    t.fog.revealed[ROOF_SEEN] = RevealedFlags.GROUND | RevealedFlags.ROOF;
    const revealed = new Uint8Array(WORLD_MAX);
    revealed[SEEN] = 1;
    loadSavedSectorChanges(sim, { mapModifications: null, revealed, doorStatus: null });
    expect([SEEN, UNSEEN, ROOF_SEEN].map((g) => t.fog.revealed[g])).toEqual([RevealedFlags.GROUND, 0, RevealedFlags.ROOF]);
    expect(revealedRooms(t)).toEqual([ROOM]);
    expect(t.lighting.sprites.flatMap((l) => (l ? [(l.flags & LightSpriteFlags.ON) !== 0] : []))).toEqual([true, false]);
    expect(lightTrueLevel(t, SEEN, 0)).toBe(8);
  });

  it('keeps the fog of a save without a revealed map', () => {
    const sim = caveImport();
    sim.state.fog.revealed[UNSEEN] = RevealedFlags.GROUND;
    loadSavedSectorChanges(sim, NO_SAVED_SECTOR_CHANGES);
    expect(sim.state.fog.revealed[UNSEEN]).toBe(RevealedFlags.GROUND);
    expect(revealedRooms(sim.state)).toEqual([]);
  });
});

function importedCampaignWideState(save: SaveGame) {
  const strategic = createStrategicState({ seed: 1 });
  const { civGroups, keyTable, profiles, pre } = strategic;
  const contentProfiles = { profiles: stubProfiles(content.items) };
  const { realtimeClock, crows, autoBandage } = strategic.sectorFlow;
  importCampaignWideState({ civGroups, keyTable, profiles, pre, realtimeClock, crows, autoBandage, content: contentProfiles }, save);
  return strategic;
}

function savedProfile(p: MercProfile, nickname: string): SavedMercProfile {
  return { ...p, nickname, kills: 0, assists: 0, shotsFired: 0, shotsHit: 0, battlesFought: 0, timesWounded: 0, checksum: 0 };
}

describe('the campaign-wide part of an import (SaveLoadGame.cc LoadSavedGame)', () => {
  it("keeps a saved nickname that differs from the content profile's, as the terrorists' reveal leaves it", () => {
    const [renamed, kept] = stubProfiles(content.items).filter((p) => p.nickname !== '');
    if (!renamed || !kept) throw new Error('the stub pack needs two named profiles');
    const profiles: SavedMercProfile[] = [];
    profiles[renamed.id] = savedProfile(renamed, `${renamed.nickname}!`);
    profiles[kept.id] = savedProfile(kept, kept.nickname);
    const strategic = importedCampaignWideState({ ...syntheticSave({}), profiles } as SaveGame);
    expect(strategic.profiles.get(renamed.id)?.nickname).toBe(`${renamed.nickname}!`);
    expect(strategic.profiles.get(kept.id)?.nickname).toBeUndefined();
  });

  it('keeps the lifetime drug count of a saved profile (LoadSaveMercProfile.cc ubNumTimesDrugUseInLifetime)', () => {
    const [user] = stubProfiles(content.items).filter((p) => p.nickname !== '');
    if (!user) throw new Error('the stub pack needs a named profile');
    const profiles: SavedMercProfile[] = [];
    profiles[user.id] = { ...savedProfile(user, user.nickname), numTimesDrugUseInLifetime: 7 };
    const strategic = importedCampaignWideState({ ...syntheticSave({}), profiles } as SaveGame);
    expect(strategic.profiles.get(user.id)?.numTimesDrugUseInLifetime).toBe(7);
  });

  it('keeps a dead merc of ours dead on his soldier as on his record, the one SOLDIER_DEAD of the original', () => {
    const DEAD_ID = MERC_ID + 1;
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82)),
        savedSoldier(DEAD_ID, Team.OUR, gridNo(82, 82), { uiStatusFlags: SOLDIER_DEAD, bLife: 0 }),
      ],
    });
    const sim = importedSim(save);
    const roster = new Roster({ state: createRosterState(), content, combat: () => sim.state });
    addSavedMercsToRoster(roster, save, sim.state);
    const merc = (id: number) => roster.get(id);
    expect([merc(MERC_ID)?.soldier.dead, merc(DEAD_ID)?.soldier.dead]).toEqual([false, true]);
    expect(((merc(DEAD_ID)?.statusFlags ?? 0) & SOLDIER_DEAD) !== 0).toBe(true);
  });

  it('fills a strategic state that has no world: the PreRandom ring, the key table, the civilian groups, the opplist decay, the crows, the pending auto-bandage and the creature tension timer', () => {
    const base = syntheticSave({});
    const ring = Array.from({ length: 256 }, (_, k) => (k * 37) % 1000);
    const key = { sectorFound: 12, dateFound: 345 };
    const save = {
      ...base,
      preRandom: { index: 65, numbers: ring },
      keyTable: [key],
      tactical: {
        ...base.tactical,
        civGroupHostile: [0, 2, 1],
        timeSinceLastOpplistDecay: 4321,
        numCrowsPossible: 7,
        dontAddNewCrows: true,
        autoBandagePending: true,
        creatureTenseQuoteDelay: 74,
        creatureTenseQuoteLastUpdate: 912_345,
      },
    } as SaveGame;
    const strategic = importedCampaignWideState(save);
    expect(strategic.sectorFlow.crows).toEqual({ possible: 7, dontAddNew: true });
    expect(strategic.sectorFlow.autoBandage.pending).toBe(true);
    expect(strategic.pre.state()).toEqual({ ring, index: 65 });
    expect(strategic.keyTable[0]).toEqual(key);
    expect(strategic.civGroups.hostility.slice(0, 3)).toEqual([0, 2, 1]);
    expect(strategic.sectorFlow.realtimeClock).toMatchObject({
      lastOpplistDecaySeconds: 4321,
      creatureTenseQuoteDelaySeconds: 74,
      lastCreatureTenseQuoteMs: 912_345,
    });
  });
});

describe('the vehicle ids of an import (LoadSaveSoldierType.cc bVehicleID, iVehicleId)', () => {
  const SOLDIER_VEHICLE = 0x00008000;
  const OUR_HUMMER_ID = 18;
  const CIVILIAN_TRUCK_ID = 121;
  const ENEMY_TANK_ID = 22;
  const OUR_HUMMER_SLOT = 1;
  const TRUCK_SLOT = 3;
  const TANK_SLOT = 4;
  const RIDDEN_SLOT = 2;
  const STALE_SLOT = 6;

  function vehicleSoldier(id: number, team: number, body: number, slot: number, at: number): SavedSoldierEntry {
    return savedSoldier(id, team, at, { uiStatusFlags: SOLDIER_VEHICLE, ubBodyType: body, bVehicleID: slot, iVehicleId: RIDDEN_SLOT });
  }

  function vehicleSave(): SaveGame {
    return syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { bVehicleID: STALE_SLOT, iVehicleId: RIDDEN_SLOT }),
        vehicleSoldier(OUR_HUMMER_ID, Team.OUR, Body.HUMVEE, OUR_HUMMER_SLOT, gridNo(70, 70)),
        vehicleSoldier(ENEMY_TANK_ID, Team.ENEMY, Body.TANK_NW, TANK_SLOT, gridNo(90, 70)),
        vehicleSoldier(CIVILIAN_TRUCK_ID, Team.CIV, Body.ICECREAMTRUCK, TRUCK_SLOT, gridNo(70, 90)),
      ],
    });
  }

  it('reads the vehicle a soldier is from bVehicleID for every team, and none for a soldier who is no vehicle', () => {
    const sim = importedSim(vehicleSave());
    const ids = [MERC_ID, OUR_HUMMER_ID, ENEMY_TANK_ID, CIVILIAN_TRUCK_ID].map((id) => soldierOf(sim, id).vehicleId);
    expect(ids).toEqual([NO_VEHICLE, OUR_HUMMER_SLOT, TANK_SLOT, TRUCK_SLOT]);
  });

  it('gives our vehicle merc the vehicle he is, not the iVehicleId the original never sets for him, and a merc the one he rides', () => {
    const save = vehicleSave();
    const sim = importedSim(save);
    const state = createRosterState();
    const roster = new Roster({ state, content, combat: () => sim.state });
    addSavedMercsToRoster(roster, save, sim.state);
    expect([roster.get(OUR_HUMMER_ID)?.vehicleId, roster.get(MERC_ID)?.vehicleId]).toEqual([OUR_HUMMER_SLOT, RIDDEN_SLOT]);
  });

  it('keeps a tank saved mid-turn turning: its 32-step facing, its step and its paused move (ubHiResDirection, bTurningIncrement, SOLDIER_PAUSEANIMOVE)', () => {
    const SOLDIER_PAUSEANIMOVE = 0x04000000;
    const HALF_WAY_TO_NORTHEAST = 2;
    const CLOCKWISE = 1;
    const turning = savedSoldier(ENEMY_TANK_ID, Team.ENEMY, gridNo(90, 70), {
      uiStatusFlags: SOLDIER_VEHICLE | SOLDIER_PAUSEANIMOVE,
      ubBodyType: Body.TANK_NW,
      bVehicleID: TANK_SLOT,
      bDirection: Direction.NORTH,
      bDesiredDirection: Direction.EAST,
      ubHiResDirection: HALF_WAY_TO_NORTHEAST,
      bTurningIncrement: CLOCKWISE,
    });
    const sim = importedSim(syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82)), turning] }));
    const tank = soldierOf(sim, ENEMY_TANK_ID);
    expect([tank.direction, tank.desiredDirection, tank.hiResDirection, tank.turnIncrement, tank.pauseAnimMove]).toEqual([
      Direction.NORTH,
      Direction.EAST,
      HALF_WAY_TO_NORTHEAST,
      CLOCKWISE,
      true,
    ]);
    expect(soldierOf(sim, MERC_ID).pauseAnimMove).toBe(false);
  });
});

describe('the mercs seated in a vehicle in the loaded sector of an import (SOLDIER_DRIVER, SOLDIER_PASSENGER)', () => {
  const SOLDIER_VEHICLE = 0x00008000;
  const SOLDIER_DRIVER = 0x08000000;
  const SOLDIER_PASSENGER = 0x10000000;
  const OUR_HUMMER_ID = 18;
  const HUMMER_SLOT = 0;
  const HELICOPTER_SLOT = 1;
  const PARKED_AT = gridNo(80, 82);
  const DRIVER_ID = 0;
  const PASSENGER_ID = 1;
  const FLYING_ID = 2;

  function savedVehicle(slot: number, type: number, passengerSlots: readonly (number | null)[]): SavedVehicle {
    return {
      slot,
      valid: true,
      movementGroup: 0,
      type,
      sector: SECTOR,
      betweenSectors: false,
      passengerProfiles: [],
      passengerSlots,
      destroyed: false,
      path: [],
    };
  }

  function seatedSave(): SaveGame {
    return syntheticSave({
      soldiers: [
        savedSoldier(DRIVER_ID, Team.OUR, PARKED_AT, { uiStatusFlags: SOLDIER_DRIVER, iVehicleId: HUMMER_SLOT }),
        savedSoldier(PASSENGER_ID, Team.OUR, PARKED_AT, { uiStatusFlags: SOLDIER_PASSENGER, iVehicleId: HUMMER_SLOT }),
        savedSoldier(FLYING_ID, Team.OUR, gridNo(90, 90), { uiStatusFlags: SOLDIER_PASSENGER, iVehicleId: HELICOPTER_SLOT }),
        savedSoldier(OUR_HUMMER_ID, Team.OUR, PARKED_AT, {
          uiStatusFlags: SOLDIER_VEHICLE,
          ubBodyType: Body.HUMVEE,
          bVehicleID: HUMMER_SLOT,
          iVehicleId: NO_VEHICLE,
        }),
      ],
      vehicles: [
        savedVehicle(HUMMER_SLOT, VehicleTypeId.HUMMER, [DRIVER_ID, PASSENGER_ID]),
        savedVehicle(HELICOPTER_SLOT, VehicleTypeId.HELICOPTER, [FLYING_ID]),
      ],
    });
  }

  it("puts a ground vehicle's driver and passenger in the sector at its tile with their seat, no occupant and no structure", () => {
    const sim = importedSim(seatedSave());
    const t = sim.state;
    const seated = [soldierOf(sim, DRIVER_ID), soldierOf(sim, PASSENGER_ID)];
    expect(seated.map((s) => [s.placed, s.gridNo, s.vehicleSeat, s.structure])).toEqual([
      [true, PARKED_AT, VehicleSeat.DRIVER, null],
      [true, PARKED_AT, VehicleSeat.PASSENGER, null],
    ]);
    expect(seated.every((s) => t.mercSlots.includes(s))).toBe(true);
    expect(whoIsThere(t, PARKED_AT, 0)).toBe(soldierOf(sim, OUR_HUMMER_ID));
  });

  it('keeps them off the grid when the saved changes of the sector lift everyone off it and put them back', () => {
    const sim = importedSim(seatedSave());
    loadSavedSectorChanges(sim, NO_SAVED_SECTOR_CHANGES);
    const t = sim.state;
    expect(whoIsThere(t, PARKED_AT, 0)).toBe(soldierOf(sim, OUR_HUMMER_ID));
    expect([soldierOf(sim, DRIVER_ID).structure, soldierOf(sim, PASSENGER_ID).structure]).toEqual([null, null]);
  });

  it("leaves the helicopter's passenger out of the tactical slots, in the sector with no tile, and the roster reads every seat from the soldier", () => {
    const save = seatedSave();
    const sim = importedSim(save);
    expect(sim.state.soldiers[FLYING_ID]).toBeUndefined();
    const roster = new Roster({ state: createRosterState(), content, combat: () => sim.state });
    addSavedMercsToRoster(roster, save, sim.state);
    const mercs = [DRIVER_ID, PASSENGER_ID, FLYING_ID].map((id) => roster.get(id));
    expect(mercs.map((m) => [m?.vehicleSeat, m?.isPassengerOrDriver, m?.offGridInSector, m?.statusFlags])).toEqual([
      [VehicleSeat.DRIVER, true, false, 0],
      [VehicleSeat.PASSENGER, true, false, 0],
      [VehicleSeat.PASSENGER, true, true, 0],
    ]);
  });
});
