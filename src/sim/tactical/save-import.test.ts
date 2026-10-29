import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, loadTestTimelines, testDoorCosts } from '../../../tests/support/tactical.ts';
import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import type { SavedSoldierEntry, SaveGame } from '../../content/formats/savegame.ts';
import { layoutOffsets } from '../../content/formats/savegame-layout.ts';
import { decodeSoldierRecord, SOLDIER_LAYOUT, SOLDIER_RECORD_BYTES } from '../../content/formats/savegame-soldier.ts';
import { gridNo, WORLD_MAX } from '../../content/world/grid.ts';
import { syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { importSave } from './save-import.ts';
import { NO_PENDING_ANIMATION, NO_PENDING_DIRECTION, NOWHERE, type Soldier, Team, TOTAL_SOLDIERS } from './soldier.ts';
import { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;
let presentation: PresentationTimeline;

beforeAll(async () => {
  content = await loadTestContent();
  presentation = (await loadTestTimelines()).presentation;
});

const SAVE_VERSION = 99;
const SECTOR = { x: 13, y: 4, z: 0 };
const CENTRE = gridNo(80, 80);
const CIVILIAN_ID = 120;
const MAX_TEAMS = 6;
const SAVED_NOWHERE = WORLD_MAX + 1;
const NOBODY = TOTAL_SOLDIERS;

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
  readonly soldiers: readonly SavedSoldierEntry[];
  readonly lastKnownOppLocBytes?: Uint8Array;
}

function syntheticSave({ soldiers, lastKnownOppLocBytes = new Uint8Array(TOTAL_SOLDIERS * TOTAL_SOLDIERS) }: SyntheticSave): SaveGame {
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
    currentSector: { worldItems: null, corpses: null, mapModifications: null, doorStatus: null, doors: null },
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

function importedSim(save: SaveGame): TacticalSim {
  const base = syntheticWorld(testDoorCosts());
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
});
