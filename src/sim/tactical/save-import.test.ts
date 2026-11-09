import { beforeAll, describe, expect, it } from 'vitest';
import { stubProfiles } from '../../../tests/support/contracts.ts';
import { itemId, runExplosivesUntilIdle } from '../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { SlotKind, slotArgument, slotKind, timelineSlot } from '../../content/anim/timelines.ts';
import type { ObjectRecord } from '../../content/formats/object.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { SavedSoldierEntry, SavedVehicle, SaveGame } from '../../content/formats/savegame.ts';
import {
  NO_SAVED_EXPLOSIONS,
  type SavedBullet,
  type SavedExplosionTable,
  type SavedItemCursor,
  type SavedRealObject,
} from '../../content/formats/savegame-effects.ts';
import { layoutOffsets } from '../../content/formats/savegame-layout.ts';
import type { SavedMercProfile } from '../../content/formats/savegame-profile.ts';
import { decodeSoldierRecord, SOLDIER_LAYOUT, SOLDIER_RECORD_BYTES } from '../../content/formats/savegame-soldier.ts';
import type { SavedCorpse, SavedSmokeEffect, SavedWorldItem } from '../../content/formats/savegame-temp-files.ts';
import { SmokeEffectId } from '../../content/items/explosions.ts';
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
import { anim, animName } from './anim-states.ts';
import { computedAnimationDelay, states } from './animation.ts';
import { handleExplosionQueue } from './bombs/bomb-queue.ts';
import type { TacticalContent } from './content.ts';
import { Direction } from './directions.ts';
import { smokeEffectOnTile } from './explosions/smoke.ts';
import { InvSlot } from './inventory.ts';
import {
  LightSpriteFlags,
  lightSetBaseLevel,
  lightTrueLevel,
  NORMAL_LIGHTLEVEL_DAY,
  NORMAL_LIGHTLEVEL_NIGHT,
} from './lighting/lighting.ts';
import { hasPendingAction } from './pending-action.ts';
import { RevealedFlags, revealedRooms } from './perception/fov.ts';
import { handleCrowLeave } from './rotting-corpses.ts';
import {
  type AroundAnimationRestart,
  createWorldlessSavedSoldiers,
  importCampaignWideState,
  importSave,
  loadSavedSectorChanges,
  NO_SAVED_SECTOR_CHANGES,
  RESTART_ON_OWN_DRAWS,
  type SavedSoldiers,
} from './save-import.ts';
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

beforeAll(async () => {
  content = await loadTestContent();
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
const SOLDIER_ENGAGEDINACTION = 0x00000800;
const MERC_GIVEITEM = 6;
const SOLDIER_DEAD = 0x00000080;
const SOLDIER_MISC_XRAYED = 0x04;
const DOOR_HAS_TIN_CAN = 0x10;

const NO_ITEM_CURSOR: SavedItemCursor = { object: objectRecord(0), holderId: NOBODY, sourceSlot: -1, active: false };

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
  readonly explosionTable?: SavedExplosionTable;
  readonly bullets?: readonly SavedBullet[];
  readonly realObjects?: readonly SavedRealObject[];
  readonly itemCursor?: SavedItemCursor;
  readonly envLightValue?: number;
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
  explosionTable = NO_SAVED_EXPLOSIONS,
  bullets = [],
  realObjects = [],
  itemCursor = NO_ITEM_CURSOR,
  envLightValue = NORMAL_LIGHTLEVEL_DAY,
}: SyntheticSave): SaveGame {
  return {
    generalInfo: { baseJA2Clock: 0, selectedSoldier: NOBODY, explosionQueueActive: false },
    tactical: {
      worldSector: SECTOR,
      civGroupHostile: [],
      flags: 0,
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
    clock: { envLightValue },
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
    explosionTable,
    bullets,
    realObjects,
    itemCursor,
    preRandom: { index: 0, numbers: Array.from({ length: 256 }, () => 0) },
  } as unknown as SaveGame;
}

function importedSim(save: SaveGame, blocked: readonly number[] = [], mapFields: Readonly<Record<string, unknown>> = {}): TacticalSim {
  return importedSave(save, blocked, mapFields).sim;
}

function importedSave(
  save: SaveGame,
  blocked: readonly number[] = [],
  mapFields: Readonly<Record<string, unknown>> = {},
  aroundRestart: AroundAnimationRestart = RESTART_ON_OWN_DRAWS,
): { readonly sim: TacticalSim; readonly soldiers: SavedSoldiers } {
  const base = syntheticWorld(testDoorCosts(), (structures) => {
    for (const g of blocked) structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
  });
  const world = {
    ...base,
    map: syntheticMap({ info: { centerGridNo: CENTRE }, ...mapFields }),
    mapPath: 'synthetic',
  } as unknown as TacticalWorld;
  const sim = new TacticalSim(world, content, 1);
  return { sim, soldiers: importSave(sim, save, aroundRestart).soldiers };
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

function objectRecord(item: number, status = 100): ObjectRecord {
  return {
    item,
    count: item === 0 ? 0 : 1,
    status: [status, 0, 0, 0, 0, 0, 0, 0],
    gunStatus: status,
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
  };
}

function savedWorldItem(item: number, at: number, flags: number): SavedWorldItem {
  return {
    index: 0,
    exists: true,
    gridNo: at,
    level: 0,
    object: objectRecord(item),
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

  it('keeps a walker saved between two tiles on his saved tile with his destination on the next: setting a position while loading does not move a walker on to his destination (Soldier_Control.cc:1891)', () => {
    const at = gridNo(80, 82);
    const next = gridNo(81, 82);
    const walking = { usAnimState: states(content.animations).WALKING, sDestination: next, sFinalDestination: gridNo(84, 82) };
    const walker = soldierOf(importedSim(syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, at, walking)] })), MERC_ID);
    expect([walker.gridNo, walker.destination, walker.placed]).toEqual([at, next, true]);
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

  it('restores the fence hop continuing a move and the wait for a tile at their stored byte values, not as flags, and the counter lock of the hop (fContinueMoveAfterStanceChange, fDelayedMovement, SOLDIER_LOCKPENDINGACTIONCOUNTER)', () => {
    const fenceHopContinuation = 2;
    const waitForTempBlockedTile = 100;
    const SOLDIER_LOCKPENDINGACTIONCOUNTER = 0x00200000;
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), {
          uiStatusFlags: SOLDIER_LOCKPENDINGACTIONCOUNTER,
          fContinueMoveAfterStanceChange: fenceHopContinuation,
          fDelayedMovement: waitForTempBlockedTile,
        }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82)),
      ],
    });
    const sim = importedSim(save);
    const merc = soldierOf(sim, MERC_ID);
    expect([merc.continueMoveAfterStanceChange, merc.delayedMovement]).toEqual([fenceHopContinuation, waitForTempBlockedTile]);
    expect([merc.pendingActionCounterLocked, soldierOf(sim, MERC_ID + 1).pendingActionCounterLocked]).toEqual([true, false]);
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
      ...NO_SAVED_SECTOR_CHANGES,
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

  it('keeps the giver and the target of a give saved under way engaged in action: placing the giver drops his pending give without freeing either, so the target stays out of the AI (SOLDIER_ENGAGEDINACTION; Soldier_Add.cc:871, AIMain.cc:91)', () => {
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), {
          uiStatusFlags: SOLDIER_ENGAGEDINACTION,
          ubPendingAction: MERC_GIVEITEM,
          uiPendingActionData4: CIVILIAN_ID,
        }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82)),
        savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(80, 85), { uiStatusFlags: SOLDIER_ENGAGEDINACTION }),
      ],
    });
    const sim = importedSim(save);
    const engaged = [MERC_ID, MERC_ID + 1, CIVILIAN_ID].map((id) => soldierOf(sim, id).engagedInAction);
    expect(engaged).toEqual([true, false, true]);
    expect(hasPendingAction(soldierOf(sim, MERC_ID))).toBe(false);
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
    loadSavedSectorChanges(sim, { ...NO_SAVED_SECTOR_CHANGES, revealed });
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

describe('the smoke and light effects of the loaded sector (SmokeEffects.cc LoadSmokeEffectsFromMapTempFile, LightEffects.cc LoadLightEffectsFromMapTempFile)', () => {
  const CLOUD = gridNo(80, 84);
  const OTHER_CLOUD = gridNo(100, 84);
  const SAVED_SECONDS = 4321;

  function savedSmoke(sim: TacticalSim, at: number, ownerId: number): SavedSmokeEffect {
    const item = itemId(sim.state, 'TEARGAS_GRENADE');
    return {
      gridNo: at,
      duration: 6,
      radius: 2,
      flags: 0,
      age: 1,
      allocated: true,
      type: SmokeEffectId.TEARGAS,
      item,
      ownerId,
      lastUpdate: SAVED_SECONDS,
    };
  }

  it('restores the clouds in their slots, each with its saved owner id, and spreads them before anybody stands on the map: nobody takes gas damage, and a soldier entering a gas tile without a mask is gassed (SetSoldierGridNo)', () => {
    const sim = importedSim(syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, CLOUD)] }));
    const t = sim.state;
    const merc = soldierOf(sim, MERC_ID);
    const breath = merc.breath;
    const owned = savedSmoke(sim, CLOUD, MERC_ID);
    loadSavedSectorChanges(sim, {
      ...NO_SAVED_SECTOR_CHANGES,
      smoke: [owned, { ...owned, allocated: false }, savedSmoke(sim, OTHER_CLOUD, NOBODY)],
    });
    const [first, free, ownerless] = t.explosives.smokeClouds;
    expect([first?.ownerId, free, ownerless?.ownerId]).toEqual([MERC_ID, null, NOBODY]);
    expect(first).toMatchObject({ gridNo: CLOUD, radius: 2, age: 1, duration: 6, lastUpdate: SAVED_SECONDS });
    expect([smokeEffectOnTile(t, CLOUD, 0), smokeEffectOnTile(t, OTHER_CLOUD, 0)]).toEqual([SmokeEffectId.TEARGAS, SmokeEffectId.TEARGAS]);
    expect([merc.gassed, merc.breath, whoIsThere(t, CLOUD, 0)]).toEqual([true, breath, merc]);
  });

  it("lights each saved light effect's sprite, an unallocated record keeping its slot free", () => {
    const sim = importedSim(syntheticSave({}));
    const t = sim.state;
    lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_NIGHT);
    const light = { gridNo: CLOUD, duration: 6, radius: 6, age: 2, allocated: true, type: 0, lastUpdate: SAVED_SECONDS };
    loadSavedSectorChanges(sim, { ...NO_SAVED_SECTOR_CHANGES, lights: [{ ...light, allocated: false }, light] });
    const [free, lit] = t.explosives.lights;
    expect([free, lit?.sprite?.template.name, lit?.age, lit?.lastUpdate]).toEqual([null, 'Light6', 2, SAVED_SECONDS]);
    expect(lightTrueLevel(t, CLOUD, 0)).toBeLessThan(NORMAL_LIGHTLEVEL_NIGHT);
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

describe('the restart of every saved animation (CreateSoldierCommon, Soldier_Control.cc:615; EVENT_InitNewSoldierAnim, :897)', () => {
  const RANDOM_ANIM_CHECK = 491;
  const END_OF_ANIMATION = 499;
  const GO_BACK = 496;
  const DICE = 100;
  const NO_IDLE_ANIMATION_ROLL = 99;
  const ANIM_CROUCH = 3;
  const MERC_AT = gridNo(80, 82);

  function codeOfOpcode(state: number, opcode: number): number {
    for (let pc = 0; ; pc++) {
      const slot = timelineSlot(state, pc);
      if (slotKind(content.timeline, slot) === SlotKind.OP && slotArgument(content.timeline, slot) === opcode) return pc;
      if (slotKind(content.timeline, slot) === SlotKind.EMPTY) throw new Error(`no code ${opcode} in state ${state}`);
    }
  }

  function scriptedDraws(rolls: number[], draws: number[]): AroundAnimationRestart {
    return (t, restart) => {
      const rng = t.rng as unknown as { int(n: number): number };
      rng.int = (n) => {
        draws.push(n);
        return rolls.shift() ?? 0;
      };
      try {
        restart();
      } finally {
        delete (rng as { int?: unknown }).int;
      }
    };
  }

  function holding(entry: SavedSoldierEntry, item: number): SavedSoldierEntry {
    const inventory = entry.soldier.inventory.map((o, slot) =>
      slot === InvSlot.HAND ? { ...o, item, count: 1, status: o.status.map((_, k) => (k === 0 ? 100 : 0)) } : o,
    );
    return { ...entry, soldier: { ...entry.soldier, inventory } };
  }

  it('runs the script on from the saved code to the next frame, works the frame delay out again and starts its timer anew', () => {
    const save = syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, MERC_AT, { usAniCode: 3 })] });
    const sim = importedSim(save);
    const merc = soldierOf(sim, MERC_ID);
    const standing = states(content.animations).STANDING;
    expect([merc.state, merc.pc, merc.frameSlot]).toEqual([standing, 4, timelineSlot(standing, 3)]);
    expect([merc.aniDelay, merc.nextFrameAt]).toEqual([computedAnimationDelay(sim.state, merc), sim.state.clockMs + merc.aniDelay]);
  });

  it('counts the idle check of a breathing soldier saved right before it, and rolls Random(100) at its threshold (Soldier_Ani.cc:1384)', () => {
    const standing = states(content.animations).STANDING;
    const atCheck = codeOfOpcode(standing, RANDOM_ANIM_CHECK);
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, MERC_AT, { usAniCode: atCheck, uiTimeOfLastRandomAction: 1 }),
        savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(84, 82), { usAniCode: atCheck, uiTimeOfLastRandomAction: 2 }),
      ],
    });
    const draws: number[] = [];
    const { sim } = importedSave(save, [], {}, scriptedDraws([NO_IDLE_ANIMATION_ROLL], draws));
    const counted = [MERC_ID, CIVILIAN_ID].map((id) => soldierOf(sim, id));
    expect(draws).toEqual([DICE]);
    expect(counted.map((s) => [s.timeOfLastRandomAction, s.state, s.pc])).toEqual([
      [2, standing, 1],
      [0, standing, 1],
    ]);
  });

  it('holds the saved pending animation through the restart, whose own state changes take the loading branch too: a soldier saved at the end of kneeling down with a walk pending goes straight into the walk, with no stance change (Soldier_Control.cc:897)', () => {
    const st = states(content.animations);
    const kneelDown = anim(content, 'KNEEL_DOWN');
    const save = syntheticSave({
      soldiers: [
        savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(84, 82), {
          usAnimState: kneelDown,
          usAniCode: codeOfOpcode(kneelDown, END_OF_ANIMATION),
          ubDesiredHeight: ANIM_CROUCH,
          usPendingAnimation: st.WALKING,
        }),
      ],
    });
    const walker = soldierOf(importedSim(save), CIVILIAN_ID);
    expect([walker.state, walker.oldState, walker.pendingAnimation]).toEqual([st.WALKING, kneelDown, NO_PENDING_ANIMATION]);
  });

  it('lays a soldier saved at the end of a death twitch down in his stance: the go-back of code 496 would start the twitch the restart made his previous animation again and again (deviation "Twitch going back to itself")', () => {
    const twitch = anim(content, 'GENERIC_HIT_DEATHTWITCHB');
    const save = syntheticSave({
      soldiers: [
        savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(84, 82), {
          usAnimState: twitch,
          usAniCode: codeOfOpcode(twitch, GO_BACK),
          service_partner: NOBODY,
        }),
      ],
    });
    expect(animName(content, soldierOf(importedSim(save), CIVILIAN_ID).state)).toBe('PRONE');
  });

  it('charges a soldier saved readying his rifle in combat the points to ready it again, unless he was not to be charged, which the restart clears (Soldier_Control.cc:1407)', () => {
    const rifle = content.items.byName.get('M14')?.index ?? 0;
    const readyTime = content.items.byIndex.get(rifle)?.weapon?.readyTime ?? 0;
    const ready = { usAnimState: anim(content, 'READY_RIFLE_STAND'), bActionPoints: 20 };
    const save = syntheticSave({
      soldiers: [
        holding(savedSoldier(MERC_ID, Team.OUR, MERC_AT, ready), rifle),
        holding(savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82), { ...ready, fDontChargeReadyAPs: 1 }), rifle),
      ],
      tactical: { inCombat: true },
    });
    const sim = importedSim(save);
    const [charged, spared] = [MERC_ID, MERC_ID + 1].map((id) => soldierOf(sim, id));
    expect(readyTime).toBeGreaterThan(0);
    expect([charged?.actionPoints, spared?.actionPoints, spared?.dontChargeReadyAPs]).toEqual([20 - readyTime, 20, false]);
  });

  it('drops the last target of a soldier saved in a state that aims at nothing, and keeps the one of a soldier readying his rifle (Soldier_Control.cc:1360)', () => {
    const target = gridNo(90, 90);
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, MERC_AT, { sLastTarget: target }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82), { sLastTarget: target, usAnimState: anim(content, 'READY_RIFLE_STAND') }),
      ],
    });
    const sim = importedSim(save);
    expect([MERC_ID, MERC_ID + 1].map((id) => soldierOf(sim, id).lastTarget)).toEqual([NOWHERE, target]);
  });

  it('restarts the soldiers of no map too: our merc off the map counts his idle check, and so does a soldier of another team the load drops, each drawing on the main stream in id order', () => {
    const standing = states(content.animations).STANDING;
    const atCheck = codeOfOpcode(standing, RANDOM_ANIM_CHECK);
    const elsewhere = { usAniCode: atCheck, uiTimeOfLastRandomAction: 2, sSectorX: SECTOR.x + 1 };
    const save = syntheticSave({
      soldiers: [savedSoldier(MERC_ID, Team.OUR, MERC_AT, elsewhere), savedSoldier(CIVILIAN_ID, Team.CIV, gridNo(84, 82), elsewhere)],
    });
    const draws: number[] = [];
    const { sim, soldiers } = importedSave(save, [], {}, scriptedDraws([NO_IDLE_ANIMATION_ROLL, NO_IDLE_ANIMATION_ROLL], draws));
    expect(draws).toEqual([DICE, DICE]);
    expect([sim.state.soldiers[MERC_ID], sim.state.soldiers[CIVILIAN_ID]]).toEqual([undefined, undefined]);
    expect(soldiers.get(MERC_ID)?.timeOfLastRandomAction).toBe(0);
  });
});

describe('the soldiers of a save with no world (deviation "Animations on load without a world")', () => {
  it('stands a soldier saved climbing or hopping a fence up at code 0, as CreateSoldierCommon does with no world loaded, and runs no script (Soldier_Control.cc:598-615)', () => {
    const standing = states(content.animations).STANDING;
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), { usAnimState: anim(content, 'HOPFENCE'), usAniCode: 5 }),
        savedSoldier(MERC_ID + 1, Team.OUR, gridNo(82, 82), { usAniCode: 12, uiTimeOfLastRandomAction: 2 }),
      ],
    });
    const soldiers = createWorldlessSavedSoldiers(save, content);
    const facts = (id: number) => {
      const s = soldiers.get(id);
      return [s?.state, s?.pc, s?.timeOfLastRandomAction];
    };
    expect([facts(MERC_ID), facts(MERC_ID + 1)]).toEqual([
      [standing, 0, 0],
      [standing, 12, 2],
    ]);
  });
});

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
    const { sim, soldiers } = importedSave(save);
    const roster = new Roster({ state: createRosterState(), content, combat: () => sim.state });
    addSavedMercsToRoster(roster, save, soldiers);
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
    const { sim, soldiers } = importedSave(save);
    const state = createRosterState();
    const roster = new Roster({ state, content, combat: () => sim.state });
    addSavedMercsToRoster(roster, save, soldiers);
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

  function seatedSave(extra: SoldierFields = {}): SaveGame {
    return syntheticSave({
      soldiers: [
        savedSoldier(DRIVER_ID, Team.OUR, PARKED_AT, { ...extra, uiStatusFlags: SOLDIER_DRIVER, iVehicleId: HUMMER_SLOT }),
        savedSoldier(PASSENGER_ID, Team.OUR, PARKED_AT, { ...extra, uiStatusFlags: SOLDIER_PASSENGER, iVehicleId: HUMMER_SLOT }),
        savedSoldier(FLYING_ID, Team.OUR, gridNo(90, 90), { ...extra, uiStatusFlags: SOLDIER_PASSENGER, iVehicleId: HELICOPTER_SLOT }),
        savedSoldier(OUR_HUMMER_ID, Team.OUR, PARKED_AT, {
          ...extra,
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

  it("leaves the saved pending action with the seated mercs, as the load stops before it places them (Soldier_Add.cc:707-708), and drops the vehicle's own", () => {
    const MERC_PICKUPITEM = 2;
    const sim = importedSim(seatedSave({ ubPendingAction: MERC_PICKUPITEM }));
    const kept = [DRIVER_ID, PASSENGER_ID, FLYING_ID, OUR_HUMMER_ID].map((id) => soldierOf(sim, id).savedPendingAction?.action ?? null);
    expect(kept).toEqual([MERC_PICKUPITEM, MERC_PICKUPITEM, MERC_PICKUPITEM, null]);
  });

  it('keeps them off the grid when the saved changes of the sector lift everyone off it and put them back', () => {
    const sim = importedSim(seatedSave());
    loadSavedSectorChanges(sim, NO_SAVED_SECTOR_CHANGES);
    const t = sim.state;
    expect(whoIsThere(t, PARKED_AT, 0)).toBe(soldierOf(sim, OUR_HUMMER_ID));
    expect([soldierOf(sim, DRIVER_ID).structure, soldierOf(sim, PASSENGER_ID).structure]).toEqual([null, null]);
  });

  it("puts the helicopter's passenger in his merc slot, in id order, with no tile, and the roster reads every seat from the soldier (Soldier_Add.cc InternalAddSoldierToSector)", () => {
    const save = seatedSave();
    const { sim, soldiers } = importedSave(save);
    const t = sim.state;
    const flying = soldierOf(sim, FLYING_ID);
    expect([flying.placed, flying.offMap, flying.gridNo, flying.structure]).toEqual([false, true, NOWHERE, null]);
    expect(t.mercSlots.map((s) => s.id)).toEqual([DRIVER_ID, PASSENGER_ID, FLYING_ID, OUR_HUMMER_ID]);
    expect(whoIsThere(t, gridNo(90, 90), 0)).toBeNull();
    const roster = new Roster({ state: createRosterState(), content, combat: () => t });
    addSavedMercsToRoster(roster, save, soldiers);
    const mercs = [DRIVER_ID, PASSENGER_ID, FLYING_ID].map((id) => roster.get(id));
    expect(mercs.map((m) => [m?.vehicleSeat, m?.isPassengerOrDriver, m?.inSector, m?.statusFlags])).toEqual([
      [VehicleSeat.DRIVER, true, true, 0],
      [VehicleSeat.PASSENGER, true, true, 0],
      [VehicleSeat.PASSENGER, true, true, 0],
    ]);
    expect(roster.get(FLYING_ID)?.soldier).toBe(flying);
    expect(roster.inTacticalSector(FLYING_ID)).toBe(true);
  });
});

describe('the pending action a save holds (Soldier_Add.cc:871, Soldier_Control.cc:1670-1697)', () => {
  const MERC_PICKUPITEM = 2;
  const ELSEWHERE = { sSectorX: SECTOR.x + 1, bInSector: 0 };
  const AWAY_ID = MERC_ID + 1;
  const LATER_TARGET_ID = MERC_ID + 2;
  const EARLIER_TARGET_ID = MERC_ID - 1;

  function sideStepping(target: number): Readonly<Record<string, number>> {
    return {
      usAnimState: anim(content, 'SIDE_STEP'),
      ubPendingAction: MERC_GIVEITEM,
      ubPendingActionAnimCount: 1,
      uiPendingActionData4: target,
    };
  }

  it('keeps it for a merc the load leaves in another sector, his animation counted once more at the restart, and drops it for one it places on the map', () => {
    const pickup = { ubPendingAction: MERC_PICKUPITEM, uiPendingActionData4: CIVILIAN_ID };
    const save = syntheticSave({
      soldiers: [
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), pickup),
        savedSoldier(AWAY_ID, Team.OUR, SAVED_NOWHERE, { ...pickup, ...ELSEWHERE }),
      ],
    });
    const { sim, soldiers } = importedSave(save);
    const away = soldiers.get(AWAY_ID);
    expect([soldierOf(sim, MERC_ID).savedPendingAction, away?.savedPendingAction]).toEqual([
      null,
      { action: MERC_PICKUPITEM, giveTarget: CIVILIAN_ID, animCount: 1 },
    ]);
    expect(away && hasPendingAction(away)).toBe(true);
  });

  it('lets the restart drop it from a soldier saved in a moving animation it does not reset, with a count above 0, freeing the target of his give only if the load made that target before him: a later one is made from his save, engaged again', () => {
    const engaged = { uiStatusFlags: SOLDIER_ENGAGEDINACTION };
    const save = syntheticSave({
      soldiers: [
        savedSoldier(EARLIER_TARGET_ID, Team.OUR, gridNo(80, 84), engaged),
        savedSoldier(MERC_ID, Team.OUR, gridNo(80, 82), sideStepping(EARLIER_TARGET_ID)),
        savedSoldier(AWAY_ID, Team.OUR, gridNo(82, 82), sideStepping(LATER_TARGET_ID)),
        savedSoldier(LATER_TARGET_ID, Team.OUR, gridNo(82, 84), engaged),
      ],
    });
    const { sim, soldiers } = importedSave(save);
    const givers = [MERC_ID, AWAY_ID].map((id) => soldiers.get(id)?.savedPendingAction);
    const targets = [EARLIER_TARGET_ID, LATER_TARGET_ID].map((id) => soldierOf(sim, id).engagedInAction);
    expect([givers, targets]).toEqual([
      [null, null],
      [false, true],
    ]);
  });
});

describe('a merc in transit whose arrival sector is the loaded one (UpdateMercInSector, StrategicMap.cc:1023)', () => {
  const IN_TRANSIT = 24;
  const WALKER_ID = 0;
  const ARRIVING_ID = 1;
  const WALKER_AT = gridNo(80, 82);

  it('is no soldier of the loaded map: the load returns before his merc slot, so he gets no tile, not even NOWHERE', () => {
    const save = syntheticSave({
      soldiers: [
        savedSoldier(WALKER_ID, Team.OUR, WALKER_AT),
        savedSoldier(ARRIVING_ID, Team.OUR, SAVED_NOWHERE, { bInSector: 0, bAssignment: IN_TRANSIT }),
      ],
    });
    const t = importedSim(save).state;
    expect(t.mercSlots.map((s) => s.id)).toEqual([WALKER_ID]);
    expect(t.soldiers[ARRIVING_ID]).toBeUndefined();
  });
});

describe('a merc still in the helicopter in a save made in mid-drop (deviation "Helicopter drop in a native save")', () => {
  const INSERTION_CODE_CHOPPER = 6;
  const DROPPED_ID = 0;
  const SEATED_IDS = [1, 2];
  const DROPPED_AT = gridNo(80, 82);

  function midDropSave(): SaveGame {
    return syntheticSave({
      soldiers: [
        savedSoldier(DROPPED_ID, Team.OUR, DROPPED_AT),
        ...SEATED_IDS.map((id) =>
          savedSoldier(id, Team.OUR, SAVED_NOWHERE, { bInSector: 0, ubStrategicInsertionCode: INSERTION_CODE_CHOPPER }),
        ),
      ],
    });
  }

  it('is no soldier of the loaded map: he is seated in the helicopter again, in id order, as the load puts the chopper mercs back into the seats (UpdateMercInSector, StrategicMap.cc:1160)', () => {
    const sim = importedSim(midDropSave());
    const t = sim.state;
    expect(t.mercSlots.map((s) => s.id)).toEqual([DROPPED_ID]);
    expect(SEATED_IDS.map((id) => t.soldiers[id])).toEqual([undefined, undefined]);
    expect([t.helicopterDrop.seats, t.helicopterDrop.running]).toEqual([SEATED_IDS, false]);
  });
});

describe('the bomb queue and the explosions in flight of a save (Explosion_Control.cc LoadExplosionTableFromSavedGameFile)', () => {
  const MINE_AT = [gridNo(70, 80), gridNo(72, 80), gridNo(74, 80)] as const;
  const BLAST_1 = 1;
  const ROOF = 1;
  const ROOF_LEVEL_HEIGHT = 50;
  const SAVED_FRAME = 1;
  const DISALLOW_SIGHT = 0x1000;
  const CHECK_SIGHT_AT_END_OF_ATTACK = 0x2000;
  const PRESSURE = 3;
  const DUE = 0;
  const LATER = 1500;

  function itemIndexOf(name: string): number {
    const def = content.items.byName.get(name);
    if (!def) throw new Error(`unknown item ${name}`);
    return def.index;
  }

  function savedMine(at: number, exists = true): SavedWorldItem {
    const mine = savedWorldItem(itemIndexOf('MINE'), at, WorldItemFlags.ARMED_BOMB);
    return { ...mine, exists, object: { ...mine.object, gunAmmoType: PRESSURE, gunShotsLeft: itemIndexOf('MINE') } };
  }

  function queued(worldBombIndex: number, exists = true, timestamp = DUE): SavedExplosionTable['queue'][number] {
    return { worldBombIndex, timestamp, exists };
  }

  function explosionAt(at: number, level = 0): SavedExplosionTable['explosions'][number] {
    const { x, y } = cellCentre(at);
    return { ownerId: MERC_ID, animationId: BLAST_1, item: itemIndexOf('MINE'), x, y, z: 0, gridNo: at, level, frame: SAVED_FRAME };
  }

  function runningQueueSave(worldItems: readonly SavedWorldItem[], queue: SavedExplosionTable['queue']): SaveGame {
    const save = syntheticSave({
      soldiers: [savedSoldier(MERC_ID, Team.OUR, CENTRE)],
      worldItems,
      tactical: { flags: DISALLOW_SIGHT },
      explosionTable: { queue, explosions: [] },
    });
    return { ...save, generalInfo: { ...save.generalInfo, explosionQueueActive: true } };
  }

  function explosionGrids(sim: TacticalSim): number[] {
    return sim.state.explosives.aniTiles.flatMap((a) => (a.kind === 'explosion' ? [a.gridNo] : []));
  }

  function bombGrids(sim: TacticalSim): number[] {
    return sim.state.worldBombs.flatMap((b) => (b.exists ? [b.item.gridNo] : []));
  }

  it('sets off the bomb the rebuilt list holds at a saved index, another one than was queued: the load lists the bombs again in item order with no gaps (LoadAndAddWorldItemsFromTempFile)', () => {
    const items = [savedMine(MINE_AT[0], false), savedMine(MINE_AT[1]), savedMine(MINE_AT[2])];
    const sim = importedSim(runningQueueSave(items, [queued(0, false), queued(1)]));
    const t = sim.state;
    expect(t.explosionQueue.entries).toEqual([
      { bomb: 0, timestamp: DUE, exists: false },
      { bomb: 1, timestamp: DUE, exists: true },
    ]);
    expect(bombGrids(sim)).toEqual([MINE_AT[1], MINE_AT[2]]);
    handleExplosionQueue(t);
    expect([explosionGrids(sim), bombGrids(sim)]).toEqual([[MINE_AT[2]], [MINE_AT[1]]]);
  });

  it('runs a queue saved running, sight off, and ends it at its last bomb without waiting for the blasts: who set it off is not saved (gPersonToSetOffExplosions)', () => {
    const items = [savedMine(MINE_AT[0]), savedMine(MINE_AT[1])];
    const sim = importedSim(runningQueueSave(items, [queued(0), queued(1, true, LATER)]));
    const t = sim.state;
    expect([t.explosionQueue.active, t.explosionQueue.person, t.perception.disallowSight]).toEqual([true, null, true]);
    handleExplosionQueue(t);
    expect([explosionGrids(sim), t.explosionQueue.active]).toEqual([[MINE_AT[0]], true]);
    t.clockMs += LATER;
    handleExplosionQueue(t);
    expect(explosionGrids(sim).sort()).toEqual([MINE_AT[0], MINE_AT[1]]);
    expect([t.turn.attackBusyCount, t.explosionQueue.active, t.perception.disallowSight]).toEqual([2, false, false]);
  });

  it('starts a saved explosion again at its frame with its owner, its raised height on a roof and a light by night', () => {
    const at = MINE_AT[1];
    const save = syntheticSave({
      soldiers: [savedSoldier(MERC_ID, Team.OUR, CENTRE)],
      tactical: { flags: DISALLOW_SIGHT | CHECK_SIGHT_AT_END_OF_ATTACK },
      explosionTable: { queue: [], explosions: [explosionAt(at, ROOF)] },
      envLightValue: NORMAL_LIGHTLEVEL_NIGHT,
    });
    const sim = importedSim(save);
    const t = sim.state;
    const [blast] = t.explosives.aniTiles;
    if (blast?.kind !== 'explosion') throw new Error('no explosion was loaded');
    expect([blast.gridNo, blast.frame, blast.owner?.id, blast.z, blast.lastUpdate]).toEqual([
      at,
      SAVED_FRAME,
      MERC_ID,
      ROOF_LEVEL_HEIGHT,
      t.clockMs,
    ]);
    expect(blast.light).not.toBeNull();
    expect([t.perception.disallowSight, t.turn.checkSightAtEndOfAttack]).toEqual([true, true]);
    runExplosivesUntilIdle(sim);
    expect([t.turn.attackBusyCount, t.perception.disallowSight, t.turn.checkSightAtEndOfAttack]).toEqual([0, false, false]);
  });

  it('lights no explosion loaded by day', () => {
    const sim = importedSim(syntheticSave({ explosionTable: { queue: [], explosions: [explosionAt(MINE_AT[1])] } }));
    const [blast] = sim.state.explosives.aniTiles;
    expect(blast?.kind === 'explosion' && blast.light).toBeNull();
  });

  it('zeroes the saved busy count, in combat and in real time, explosions in flight or not (SaveLoadGame.cc:1100, :1179)', () => {
    const blast = { queue: [], explosions: [explosionAt(MINE_AT[1])] };
    const combat = importedSim(syntheticSave({ tactical: { inCombat: true, attackBusyCount: 2 } }));
    const realTime = importedSim(syntheticSave({ tactical: { inCombat: false, attackBusyCount: 1 }, explosionTable: blast }));
    expect([combat.state.turn.attackBusyCount, realTime.state.turn.attackBusyCount]).toEqual([0, 0]);
  });
});

describe('the bullets, thrown objects and item cursor of a save (Bullets.cc LoadBulletStructureFromSavedGameFile, Physics.cc LoadPhysicsTableFromSavedGameFile, Interface_Items.cc LoadItemCursorFromSavedGame)', () => {
  const FIX = 1 << 20;
  const ROW = 80;
  const FIRER_AT = gridNo(74, ROW);
  const BULLET_COLUMN = 76;
  const TARGET_ID = 20;
  const CHEST_HEIGHT = 100;
  const CUBE_UNITS = 64;
  const KNIFE = 0x0002;
  const SAVED_KNIFE_STATUS = 40;
  const KNIFE_STATUS_IN_HAND = 77;
  const MAX_TICKS = 2000;
  const ARM_ITEM = 1;
  const TARGET_MERC_CATCH = 2;
  const CATCHER_ID = 4;
  const HIGH_UP = 600;
  const SAVED_TILES_MOVED = 3;
  const KEY_RING_POSITION_PAST_THE_SLOTS = 20;
  const STOPPED = 0x0010;
  const SETTLING_TICKS = 200;
  const NO_SOURCE_SLOT = -1;

  function itemIndexOf(name: string): number {
    const def = content.items.byName.get(name);
    if (!def) throw new Error(`unknown item ${name}`);
    return def.index;
  }

  function holding(entry: SavedSoldierEntry, slot: number, record: ObjectRecord): SavedSoldierEntry {
    const inventory = entry.soldier.inventory.map((o, k) => (k === slot ? record : o));
    return { ...entry, soldier: { ...entry.soldier, inventory } };
  }

  function bulletEastAlongTheRow(fields: Partial<SavedBullet> = {}): SavedBullet {
    const x = BULLET_COLUMN * 10 + 5;
    const y = ROW * 10 + 5;
    return {
      firerId: MERC_ID,
      targetId: TARGET_ID,
      startCubesAbove: 1,
      endCubesAbove: 1,
      gridNo: gridNo(BULLET_COLUMN, ROW),
      lastStructureHit: 0,
      x: x * FIX,
      y: y * FIX,
      z: CHEST_HEIGHT * FIX,
      incX: FIX,
      incY: 0,
      incZ: 0,
      horizAngle: 0,
      tileX: BULLET_COLUMN,
      tileY: ROW,
      losX: (x % 10) >> 1,
      losY: (y % 10) >> 1,
      checkForRoof: false,
      cubesZ: Math.trunc(CHEST_HEIGHT / CUBE_UNITS),
      loop: 20,
      toDelete: false,
      located: false,
      real: true,
      aimed: true,
      tilesPerUpdate: 1,
      msPerUpdate: 5,
      targetGrid: CENTRE,
      hitBy: 10,
      impact: 30,
      impactReduction: 0,
      range: 300,
      distanceLimit: 60,
      flags: 0,
      itemStatus: 0,
      ...fields,
    };
  }

  function duelSave(extra: Partial<SyntheticSave> = {}): SaveGame {
    return syntheticSave({
      soldiers: [savedSoldier(MERC_ID, Team.OUR, FIRER_AT), savedSoldier(TARGET_ID, Team.ENEMY, CENTRE)],
      ...extra,
    });
  }

  function stepUntil(sim: TacticalSim, done: () => boolean): void {
    for (let tick = 0; tick < MAX_TICKS && !done(); tick++) sim.step();
    expect(done()).toBe(true);
  }

  it('flies a saved bullet on at the first update, its last update 0, and hits the target it names by id', () => {
    const sim = importedSim(duelSave({ bullets: [bulletEastAlongTheRow()] }));
    const t = sim.state;
    const [bullet] = t.bullets;
    expect([bullet?.firer.id, bullet?.target?.id, bullet?.lastUpdate]).toEqual([MERC_ID, TARGET_ID, 0]);
    stepUntil(sim, () => t.bullets.length === 0);
    expect(soldierOf(sim, TARGET_ID).life).toBeLessThan(50);
  });

  it('gives a loaded thrown knife the status of what its thrower holds now, not its own: HandleBulletSpecialFlags reads the hand again', () => {
    const knife = bulletEastAlongTheRow({ flags: KNIFE, itemStatus: SAVED_KNIFE_STATUS });
    const inHand = objectRecord(itemIndexOf('THROWING_KNIFE'), KNIFE_STATUS_IN_HAND);
    const thrower = holding(savedSoldier(MERC_ID, Team.OUR, FIRER_AT), InvSlot.HAND, inHand);
    const armed = importedSim(syntheticSave({ soldiers: [thrower, savedSoldier(TARGET_ID, Team.ENEMY, CENTRE)], bullets: [knife] }));
    const emptyHanded = importedSim(duelSave({ bullets: [knife] }));
    expect([armed.state.bullets[0]?.itemStatus, emptyHanded.state.bullets[0]?.itemStatus]).toEqual([KNIFE_STATUS_IN_HAND, 0]);
  });

  it('keeps a bullet saved stopped in its slot for good, as no miss animation comes back to remove it, and lets the sim stand idle', () => {
    const sim = importedSim(duelSave({ bullets: [bulletEastAlongTheRow({ flags: STOPPED })] }));
    for (let tick = 0; tick < SETTLING_TICKS; tick++) sim.step();
    expect([sim.state.bullets.length, sim.isIdle()]).toEqual([1, true]);
  });

  function savedObject(item: number, at: number, fields: Partial<SavedRealObject> = {}): SavedRealObject {
    const { x, y } = cellCentre(at);
    const still = { x: 0, y: 0, z: 0 };
    return {
      alive: true,
      applyFriction: false,
      visible: true,
      inWater: false,
      testObject: 0,
      testEndedWithCollision: false,
      testPositionNotSet: false,
      testZTarget: 0,
      appliedMu: 0,
      position: { x, y, z: 0 },
      testTargetPosition: still,
      oldPosition: { x, y, z: 0 },
      velocity: still,
      oldVelocity: still,
      initialForce: still,
      force: still,
      collisionNormal: still,
      collisionVelocity: still,
      collisionElasticity: 0,
      gridNo: at,
      consecutiveCollisions: 0,
      consecutiveZeroVelocityCollisions: 0,
      oldCollisionCode: 1,
      lifeLength: 10,
      lifeSpan: 9,
      object: objectRecord(item),
      firstTimeMoved: false,
      firstGridNo: FIRER_AT,
      ownerId: MERC_ID,
      action: ARM_ITEM,
      targetId: NOBODY,
      dropItem: true,
      numTilesMoved: SAVED_TILES_MOVED,
      catchGood: false,
      attemptedCatch: false,
      catchAnimOn: false,
      catchCheckDone: false,
      endedWithCollisionPositionSet: false,
      endedWithCollisionPosition: still,
      haveHitGround: true,
      lastTargetTakenDamage: NOBODY,
      ...fields,
    };
  }

  it('lets a grenade saved in flight go off at the end of its life, its owner by id', () => {
    const at = gridNo(78, ROW);
    const sim = importedSim(duelSave({ realObjects: [savedObject(itemIndexOf('HAND_GRENADE'), at)] }));
    const t = sim.state;
    expect(t.explosives.objects.map((o) => [o?.owner?.id, o?.gridNo, o?.levelNode])).toEqual([[MERC_ID, at, false]]);
    stepUntil(sim, () => t.explosives.aniTiles.some((a) => a.kind === 'explosion'));
    const blast = t.explosives.aniTiles.find((a) => a.kind === 'explosion');
    expect([blast?.kind === 'explosion' && blast.owner?.id, blast?.gridNo, t.explosives.objects]).toEqual([MERC_ID, at, []]);
  });

  it('looks at the catch again on the tile an object was saved on, measured from there: the load leaves it no level node, which PhysicsMoveObject takes for an object not drawn yet (Physics.cc:1097)', () => {
    const at = gridNo(78, ROW);
    const catcher = savedSoldier(CATCHER_ID, Team.OUR, gridNo(79, ROW));
    const pass = savedObject(itemIndexOf('CANTEEN'), at, {
      action: TARGET_MERC_CATCH,
      targetId: CATCHER_ID,
      attemptedCatch: true,
      position: { ...cellCentre(at), z: HIGH_UP },
      oldCollisionCode: 0,
      lifeLength: -1,
      haveHitGround: false,
    });
    const sim = importedSim(syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, FIRER_AT), catcher], realObjects: [pass] }));
    const [o] = sim.state.explosives.objects;
    sim.step();
    expect([o?.gridNo, o?.catchCheckDone]).toEqual([at, true]);
  });

  function cursorOf(record: ObjectRecord, sourceSlot: number): SavedItemCursor {
    return { object: record, holderId: MERC_ID, sourceSlot, active: true };
  }

  function holderSave(cursor: SavedItemCursor, holder = savedSoldier(MERC_ID, Team.OUR, CENTRE)): TacticalSim {
    return importedSim(syntheticSave({ soldiers: [holder], itemCursor: cursor }));
  }

  const itemsAt = (sim: TacticalSim, at: number) => sim.state.worldItems.filter((w) => w.gridNo === at).map((w) => w.object.item);
  const carried = (s: Soldier) => s.inv.map((o) => o.item).filter((item) => item !== 0);

  it('puts a saved cursor item back into its source slot, as CancelItemPointer does', () => {
    const canteen = itemIndexOf('CANTEEN');
    const sim = holderSave(cursorOf(objectRecord(canteen), InvSlot.SMALLPOCK3));
    expect([soldierOf(sim, MERC_ID).inv[InvSlot.SMALLPOCK3]?.item, itemsAt(sim, CENTRE)]).toEqual([canteen, []]);
  });

  it('auto-places what the source slot swaps out, and leaves an inactive cursor alone', () => {
    const [canteen, glock] = [itemIndexOf('CANTEEN'), itemIndexOf('GLOCK_17')];
    const holder = holding(savedSoldier(MERC_ID, Team.OUR, CENTRE), InvSlot.BIGPOCK1, objectRecord(glock));
    const swapped = soldierOf(holderSave(cursorOf(objectRecord(canteen), InvSlot.BIGPOCK1), holder), MERC_ID);
    expect([swapped.inv[InvSlot.BIGPOCK1]?.item, swapped.inv[InvSlot.HAND]?.item]).toEqual([canteen, glock]);
    const idle = soldierOf(holderSave({ ...cursorOf(objectRecord(canteen), InvSlot.SMALLPOCK3), active: false }), MERC_ID);
    expect(carried(idle)).toEqual([]);
  });

  it('drops a cursor item with no source slot on its holder tile, free pockets or not', () => {
    const canteen = itemIndexOf('CANTEEN');
    const sim = holderSave(cursorOf(objectRecord(canteen), NO_SOURCE_SLOT));
    expect([itemsAt(sim, CENTRE), carried(soldierOf(sim, MERC_ID))]).toEqual([[canteen], []]);
  });

  it('auto-places a cursor item from a key ring position past the inventory slots, and drops one no pocket takes', () => {
    const [canteen, glock] = [itemIndexOf('CANTEEN'), itemIndexOf('GLOCK_17')];
    const fromTheRing = soldierOf(holderSave(cursorOf(objectRecord(canteen), KEY_RING_POSITION_PAST_THE_SLOTS)), MERC_ID);
    expect(fromTheRing.inv[InvSlot.SMALLPOCK1]?.item).toBe(canteen);
    let full = savedSoldier(MERC_ID, Team.OUR, CENTRE);
    for (let slot: number = InvSlot.HAND; slot <= InvSlot.SMALLPOCK8; slot++) full = holding(full, slot, objectRecord(glock));
    const dropped = holderSave(cursorOf(objectRecord(canteen), InvSlot.SMALLPOCK3), full);
    expect(itemsAt(dropped, CENTRE)).toEqual([glock]);
  });
});
