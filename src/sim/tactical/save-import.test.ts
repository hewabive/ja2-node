import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, loadTestTimelines, testDoorCosts } from '../../../tests/support/tactical.ts';
import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import type { SavedSoldierEntry, SaveGame } from '../../content/formats/savegame.ts';
import { layoutOffsets } from '../../content/formats/savegame-layout.ts';
import { decodeSoldierRecord, SOLDIER_LAYOUT, SOLDIER_RECORD_BYTES } from '../../content/formats/savegame-soldier.ts';
import type { SavedCorpse, SavedWorldItem } from '../../content/formats/savegame-temp-files.ts';
import { gridNo, WORLD_MAX } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { Direction } from './directions.ts';
import { importSave } from './save-import.ts';
import { cellCentre, NO_PENDING_ANIMATION, NO_PENDING_DIRECTION, NOWHERE, type Soldier, Team, TOTAL_SOLDIERS } from './soldier.ts';
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

function savedSoldier(id: number, team: number, at: number, extra: SoldierFields = {}): SavedSoldierEntry {
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
  return { soldier: decodeSoldierRecord(record, SAVE_VERSION, false), mercPath: [], keyRing: null };
}

interface SyntheticSave {
  readonly soldiers?: readonly SavedSoldierEntry[];
  readonly lastKnownOppLocBytes?: Uint8Array;
  readonly worldItems?: readonly SavedWorldItem[];
  readonly corpses?: readonly SavedCorpse[];
}

function syntheticSave({
  soldiers = [],
  lastKnownOppLocBytes = new Uint8Array(TOTAL_SOLDIERS * TOTAL_SOLDIERS),
  worldItems,
  corpses,
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
    },
    keyTable: [],
    profiles: [],
    worldTime: { hour: 12 },
    clock: { envLightValue: 3 },
    currentSector: { worldItems: worldItems ?? null, corpses: corpses ?? null, mapModifications: null, doorStatus: null, doors: null },
    soldiers,
    schedules: [],
    oppList: {
      publicOpplist: [],
      seenOpponents: [],
      lastKnownOppLocBytes,
      publicLastKnownOppLocBytes: new Uint8Array(MAX_TEAMS * TOTAL_SOLDIERS),
      publicNoiseVolume: [],
      publicNoiseGridNoBytes: new Uint8Array(MAX_TEAMS),
    },
    watchedLocations: { gridNo: [], level: [], points: [], reset: [] },
    teamTurns: { outOfTurnOrder: [], hiddenInterrupt: false, lastInterruptedGuy: NOBODY, whoThrewRock: NOBODY },
    preRandom: { index: 0, numbers: Array.from({ length: 256 }, () => 0) },
  } as unknown as SaveGame;
}

function importedSim(save: SaveGame, blocked: readonly number[] = []): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), (structures) => {
    for (const g of blocked) structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
  });
  const world = {
    ...base,
    map: { doors: [], placements: [], info: { centerGridNo: CENTRE } },
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

  it('puts a soldier saved mid-step at the centre of his saved tile, as setting his position on load does (Soldier_Add.cc AddSoldierToSectorGridNo)', () => {
    const at = gridNo(80, 82);
    const centre = cellCentre(at);
    const save = syntheticSave({ soldiers: [savedSoldier(MERC_ID, Team.OUR, at, { dXPos: centre.x + 3, dYPos: centre.y - 2 })] });
    const merc = soldierOf(importedSim(save), MERC_ID);
    expect([merc.gridNo, merc.x, merc.y]).toEqual([at, centre.x, centre.y]);
  });
});
