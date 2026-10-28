// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc LoadStrategicAI; Strategic_AI.h ARMY_COMPOSITION, PATROL_GROUP, GARRISON_GROUP;
// @src Strategic/Strategic_Status.h STRATEGIC_STATUS, Strategic_Status.cc LoadStrategicStatusFromSaveGameFile;
// @src SaveLoadGame.cc LoadGeneralInfo (meanwhile flags).

import { FormatError } from '../binary/errors.ts';
import type { SaveGame } from './savegame.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { field, type Layout, layoutOffsets, readLayout, skip } from './savegame-layout.ts';
import { GENERAL_INFO_LAYOUT } from './savegame-tactical.ts';

const SAVED_ARMY_COMPOSITIONS = 60;
const SAVED_PATROL_GROUPS = 50;
const SAVED_GARRISON_GROUPS = 100;
const SAI_PADDING_BYTES = 97;
const PATROL_POINTS = 4;
const STRUCT_PADDING_BYTES = 10;
const ARMY_GUN_LEVELS = 11;
const MAX_WEAPONS = 70;
const STATUS_PADDING_BYTES = 70;
const NUM_WAYS_ENEMIES_KILLED = 3;
const NUM_ENEMY_RANKS = 3;
const SEL_MAP_Z_BYTES = 4;
const BYTES_FROM_SEL_MAP_TO_MEANWHILE_FLAGS = 24;
const BYTES_FROM_SEL_MAP_TO_CREATURE_MEANWHILE = 12;
const FIRST_VERSION_WITH_32_BIT_MEANWHILE_FLAGS = 71;

const SAI_HEADER_LAYOUT: Layout = [
  skip(3),
  field('gfExtraElites', 'bool'),
  field('iGarrisonArraySize', 'i32'),
  field('iPatrolArraySize', 'i32'),
  field('giReinforcementPool', 'i32'),
  field('giForcePercentage', 'i32'),
  field('giArmyAlertness', 'i32'),
  field('giArmyAlertnessDecay', 'i32'),
  field('gfQueenAIAwake', 'bool'),
  field('giReinforcementPoints', 'i32'),
  field('giRequestPoints', 'i32'),
  field('gubNumAwareBattles', 'u8'),
  field('ubSAIVersion', 'u8'),
  field('gubQueenPriorityPhase', 'u8'),
  field('gfFirstBattleMeanwhileScenePending', 'bool'),
  field('gfMassFortificationOrdered', 'bool'),
  field('gubMinEnemyGroupSize', 'u8'),
  field('gubHoursGracePeriod', 'u8'),
  field('gusPlayerBattleVictories', 'u16'),
  field('gfUseAlternateQueenPosition', 'bool'),
  skip(SAI_PADDING_BYTES),
];

const ARMY_COMPOSITION_LAYOUT: Layout = [
  field('iReadability', 'i32'),
  field('bPriority', 'i8'),
  field('bElitePercentage', 'i8'),
  field('bTroopPercentage', 'i8'),
  field('bAdminPercentage', 'i8'),
  field('bDesiredPopulation', 'i8'),
  field('bStartPopulation', 'i8'),
  skip(STRUCT_PADDING_BYTES),
];

const PATROL_GROUP_LAYOUT: Layout = [
  field('bSize', 'i8'),
  field('bPriority', 'i8'),
  field('ubSectorID', 'u8', PATROL_POINTS),
  field('bFillPermittedAfterDayMod100', 'i8'),
  field('ubGroupID', 'u8'),
  field('bWeight', 'i8'),
  field('ubPendingGroupID', 'u8'),
  skip(STRUCT_PADDING_BYTES),
];

const GARRISON_GROUP_LAYOUT: Layout = [
  field('ubSectorID', 'u8'),
  field('ubComposition', 'u8'),
  field('bWeight', 'i8'),
  field('ubPendingGroupID', 'u8'),
  skip(STRUCT_PADDING_BYTES),
];

const STRATEGIC_STATUS_LAYOUT: Layout = [
  field('uiFlags', 'u32'),
  field('ubNumCapturedForRescue', 'u8'),
  field('ubHighestProgress', 'u8'),
  skip(ARMY_GUN_LEVELS, 'notUsedGunIndeces'),
  field('fWeaponDroppedAlready', 'u8', MAX_WEAPONS),
  field('ubMercDeaths', 'u8'),
  field('uiManDaysPlayed', 'u32'),
  field('ubBadReputation', 'u8'),
  skip(1),
  field('usEnricoEmailFlags', 'u16'),
  field('ubInsuranceInvestigationsCnt', 'u8'),
  field('ubUnhiredMercDeaths', 'u8'),
  field('usPlayerKills', 'u16'),
  field('usEnemiesKilled', 'u16', NUM_WAYS_ENEMIES_KILLED * NUM_ENEMY_RANKS),
  field('usLastDayOfPlayerActivity', 'u16'),
  field('ubNumNewSectorsVisitedToday', 'u8'),
  field('ubNumberOfDaysOfInactivity', 'u8'),
  skip(STATUS_PADDING_BYTES),
];

export interface SavedArmyComposition {
  readonly id: number;
  readonly priority: number;
  readonly elitePct: number;
  readonly troopPct: number;
  readonly adminPct: number;
  readonly desired: number;
  readonly start: number;
}

export interface SavedPatrolGroup {
  readonly size: number;
  readonly priority: number;
  readonly points: readonly number[];
  readonly fillDayMod100: number;
  readonly group: number;
  readonly weight: number;
  readonly pendingGroup: number;
}

export interface SavedGarrisonGroup {
  readonly sector: number;
  readonly composition: number;
  readonly weight: number;
  readonly pendingGroup: number;
}

export interface SavedStrategicAi {
  readonly extraElites: boolean;
  readonly reinforcementPool: number;
  readonly forcePercentage: number;
  readonly alertness: number;
  readonly alertnessDecay: number;
  readonly awake: boolean;
  readonly reinforcementPoints: number;
  readonly requestPoints: number;
  readonly awareBattles: number;
  readonly saiVersion: number;
  readonly priorityPhase: number;
  readonly firstBattleMeanwhilePending: boolean;
  readonly massFortificationOrdered: boolean;
  readonly minGroupSize: number;
  readonly graceHours: number;
  readonly playerBattleVictories: number;
  readonly useAlternateQueenPosition: boolean;
  readonly compositions: readonly SavedArmyComposition[];
  readonly patrols: readonly SavedPatrolGroup[];
  readonly garrisons: readonly SavedGarrisonGroup[];
  readonly garrisonDenied: readonly number[];
}

export interface SavedStrategicStatus {
  readonly flags: number;
  readonly numCapturedForRescue: number;
  readonly highestProgress: number;
  readonly mercDeaths: number;
  readonly manDaysPlayed: number;
  readonly badReputation: number;
  readonly enricoEmailFlags: number;
  readonly insuranceInvestigations: number;
  readonly unhiredMercDeaths: number;
  readonly playerKills: number;
  readonly enemiesKilled: readonly (readonly number[])[];
  readonly lastDayOfPlayerActivity: number;
  readonly newSectorsVisitedToday: number;
  readonly daysOfInactivity: number;
  readonly weaponDroppedAlready: readonly number[];
}

export interface SavedStrategicAiSections {
  readonly ai: SavedStrategicAi;
  readonly status: SavedStrategicStatus;
  readonly meanwhileFlags: number;
  readonly firstBattleSector: number;
  readonly creatureMeanwhileScenePlayed: boolean;
  readonly droppedWeaponsState: readonly number[] | null;
}

function sectionCursor(bytes: Uint8Array, save: SaveGame, name: string): SaveCursor {
  const s = save.sections.find((x) => x.name === name);
  if (!s) throw new FormatError(`savegame has no ${name} section`);
  return new SaveCursor(bytes.subarray(s.offset, s.offset + s.size));
}

function readList<T>(c: SaveCursor, layout: Layout, count: number, what: string, map: (r: ReturnType<typeof readLayout>) => T): T[] {
  return Array.from({ length: count }, (_, i) => map(readLayout(c, layout, false, `${what}[${i}]`)));
}

export function readStrategicAi(c: SaveCursor): SavedStrategicAi {
  const h = readLayout(c, SAI_HEADER_LAYOUT, false, 'strategic AI');
  const garrisonCount = h.num('iGarrisonArraySize');
  const patrolCount = h.num('iPatrolArraySize');
  if (garrisonCount < 0 || garrisonCount > SAVED_GARRISON_GROUPS || patrolCount < 0 || patrolCount > SAVED_PATROL_GROUPS)
    throw new FormatError(`strategic AI: ${garrisonCount} garrisons, ${patrolCount} patrols`);
  const compositions = readList(c, ARMY_COMPOSITION_LAYOUT, SAVED_ARMY_COMPOSITIONS, 'army composition', (r) => ({
    id: r.num('iReadability'),
    priority: r.num('bPriority'),
    elitePct: r.num('bElitePercentage'),
    troopPct: r.num('bTroopPercentage'),
    adminPct: r.num('bAdminPercentage'),
    desired: r.num('bDesiredPopulation'),
    start: r.num('bStartPopulation'),
  }));
  const patrols = readList(c, PATROL_GROUP_LAYOUT, SAVED_PATROL_GROUPS, 'patrol group', (r) => ({
    size: r.num('bSize'),
    priority: r.num('bPriority'),
    points: [...r.nums('ubSectorID')],
    fillDayMod100: r.num('bFillPermittedAfterDayMod100'),
    group: r.num('ubGroupID'),
    weight: r.num('bWeight'),
    pendingGroup: r.num('ubPendingGroupID'),
  })).slice(0, patrolCount);
  const garrisons = readList(c, GARRISON_GROUP_LAYOUT, SAVED_GARRISON_GROUPS, 'garrison group', (r) => ({
    sector: r.num('ubSectorID'),
    composition: r.num('ubComposition'),
    weight: r.num('bWeight'),
    pendingGroup: r.num('ubPendingGroupID'),
  })).slice(0, garrisonCount);
  c.skip(patrolCount);
  const garrisonDenied = c.u8s(garrisonCount);
  return {
    extraElites: h.bool('gfExtraElites'),
    reinforcementPool: h.num('giReinforcementPool'),
    forcePercentage: h.num('giForcePercentage'),
    alertness: h.num('giArmyAlertness'),
    alertnessDecay: h.num('giArmyAlertnessDecay'),
    awake: h.bool('gfQueenAIAwake'),
    reinforcementPoints: h.num('giReinforcementPoints'),
    requestPoints: h.num('giRequestPoints'),
    awareBattles: h.num('gubNumAwareBattles'),
    saiVersion: h.num('ubSAIVersion'),
    priorityPhase: h.num('gubQueenPriorityPhase'),
    firstBattleMeanwhilePending: h.bool('gfFirstBattleMeanwhileScenePending'),
    massFortificationOrdered: h.bool('gfMassFortificationOrdered'),
    minGroupSize: h.num('gubMinEnemyGroupSize'),
    graceHours: h.num('gubHoursGracePeriod'),
    playerBattleVictories: h.num('gusPlayerBattleVictories'),
    useAlternateQueenPosition: h.bool('gfUseAlternateQueenPosition'),
    compositions,
    patrols,
    garrisons,
    garrisonDenied,
  };
}

export function readStrategicStatus(c: SaveCursor): SavedStrategicStatus {
  const r = readLayout(c, STRATEGIC_STATUS_LAYOUT, false, 'strategic status');
  const killed = r.nums('usEnemiesKilled');
  return {
    flags: r.num('uiFlags'),
    numCapturedForRescue: r.num('ubNumCapturedForRescue'),
    highestProgress: r.num('ubHighestProgress'),
    mercDeaths: r.num('ubMercDeaths'),
    manDaysPlayed: r.num('uiManDaysPlayed'),
    badReputation: r.num('ubBadReputation'),
    enricoEmailFlags: r.num('usEnricoEmailFlags'),
    insuranceInvestigations: r.num('ubInsuranceInvestigationsCnt'),
    unhiredMercDeaths: r.num('ubUnhiredMercDeaths'),
    playerKills: r.num('usPlayerKills'),
    enemiesKilled: Array.from({ length: NUM_WAYS_ENEMIES_KILLED }, (_, way) =>
      killed.slice(way * NUM_ENEMY_RANKS, (way + 1) * NUM_ENEMY_RANKS),
    ),
    lastDayOfPlayerActivity: r.num('usLastDayOfPlayerActivity'),
    newSectorsVisitedToday: r.num('ubNumNewSectorsVisitedToday'),
    daysOfInactivity: r.num('ubNumberOfDaysOfInactivity'),
    weaponDroppedAlready: r.nums('fWeaponDroppedAlready'),
  };
}

interface GeneralInfoExtras {
  readonly meanwhileFlags: number;
  readonly firstBattleSector: number;
  readonly creatureMeanwhileScenePlayed: boolean;
}

function readGeneralInfoExtras(bytes: Uint8Array, save: SaveGame): GeneralInfoExtras {
  const c = sectionCursor(bytes, save, 'general info');
  const offsets = layoutOffsets(GENERAL_INFO_LAYOUT, false);
  const at = (name: string) => {
    const o = offsets.get(name);
    if (o === undefined) throw new FormatError(`general info: no field ${name}`);
    return o;
  };
  const view = new DataView(c.bytes.buffer, c.bytes.byteOffset, c.bytes.byteLength);
  const flagsAt = at('sSelMapZ') + SEL_MAP_Z_BYTES + BYTES_FROM_SEL_MAP_TO_MEANWHILE_FLAGS;
  const meanwhileFlags =
    save.header.version < FIRST_VERSION_WITH_32_BIT_MEANWHILE_FLAGS
      ? view.getUint16(at('old_meanwhile_flags'), true)
      : view.getUint32(flagsAt, true);
  const creatureAt = at('sSelMapZ') + SEL_MAP_Z_BYTES + BYTES_FROM_SEL_MAP_TO_CREATURE_MEANWHILE;
  return {
    meanwhileFlags,
    firstBattleSector: view.getInt16(at('sWorldSectorLocationOfFirstBattle'), true),
    creatureMeanwhileScenePlayed: view.getUint8(creatureAt) !== 0,
  };
}

export function readStrategicAiSections(bytes: Uint8Array, save: SaveGame): SavedStrategicAiSections {
  const aiCursor = sectionCursor(bytes, save, 'strategic ai');
  const ai = readStrategicAi(aiCursor);
  aiCursor.expectConsumed(0, aiCursor.bytes.length, 'strategic AI');
  const statusCursor = sectionCursor(bytes, save, 'strategic status');
  const status = readStrategicStatus(statusCursor);
  return { ai, status, droppedWeaponsState: droppedWeaponsFromGameStates(save.gameStates), ...readGeneralInfoExtras(bytes, save) };
}

const DROPPED_WEAPONS_KEY = 'StrategicStatus::alreadyDroppedWeapons';

function droppedWeaponsFromGameStates(gameStates: string | null): number[] | null {
  if (!gameStates) return null;
  try {
    const parsed = JSON.parse(gameStates) as Record<string, unknown>;
    const value = parsed[DROPPED_WEAPONS_KEY];
    return Array.isArray(value) ? value.map(Number) : null;
  } catch {
    return null;
  }
}
