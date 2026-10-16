// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame and the section loaders it calls (see docs/14-savegames.md)

import { FormatError } from '../binary/errors.ts';
import { decryptRecord as decryptWithOldKey } from './prof.ts';
import { SaveCursor } from './savegame-cursor.ts';
import {
  decryptSaveRecord,
  encryptionSetIndex,
  isValidSectorPosition,
  parseSaveHeader,
  SAVE_HEADER_BYTES,
  SAVE_HEADER_BYTES_STRAC_LINUX,
  type SaveEncryptionTable,
  type SaveGameHeader,
  type SectorPosition,
} from './savegame-header.ts';
import { field, type Layout, readLayout, skip } from './savegame-layout.ts';
import { decodeSavedProfile, profileChecksum, profileRecordBytes, type SavedMercProfile } from './savegame-profile.ts';
import { decodeSoldierRecord, type SavedSoldier, soldierChecksum, soldierRecordBytes } from './savegame-soldier.ts';
import {
  type GameClock,
  type GeneralInfo,
  type OppListInfo,
  readGameClock,
  readGeneralInfo,
  readOppList,
  readTacticalStatus,
  readTeamTurns,
  readWatchedLocations,
  type TacticalStatus,
  type TeamTurns,
  TOTAL_SOLDIERS,
  type WatchedLocations,
} from './savegame-tactical.ts';
import {
  decodeDoorStatusFile,
  decodeDoorTableFile,
  decodeWorldItemsFile,
  readSectorTempFiles,
  type SavedDoor,
  type SavedDoorStatus,
  type SavedWorldItem,
  type SectorTempFile,
} from './savegame-temp-files.ts';

export const MIN_SAVE_VERSION = 85;
export const MAX_SAVE_VERSION = 105;
const FIRST_VERSION_WITH_NEW_ENCRYPTION = 87;
const FIRST_VERSION_WITH_VOICE_IDS = 104;
const FIRST_VERSION_WITH_EXTENDED_PROFILES = 105;
const FIRST_VERSION_WITH_DESTROYED_LAIR = 82;
const FIRST_VERSION_WITH_GAME_STATES = 101;
const FIRST_VERSION_WITH_SQUAD_FIELD = 101;
const SQUAD_INFO_FORMAT_VERSION = 1;
const NUM_VANILLA_PROFILES = 170;
const NUM_PROFILES = 200;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const MAXITEMS = 351;
const STORE_INVENTORY_BYTES = 8;
const BOOKMARKS = 20;
const CHARACTER_LIST_ENTRIES = 256;
const BOBBY_RAY_ORDER_BYTES = 84;
const LIFE_INSURANCE_PAYOUT_BYTES = 8;
const MERC_PATH_NODE_BYTES = 20;
const KEY_RING_BYTES = 128;
const EMAIL_RECORD_BYTES = 44;
const MAP_WORLD_CELLS = 18 * 18;
const STRATEGIC_MAP_ELEMENT_BYTES = 41;
const SECTOR_INFO_COUNT = 256;
const SECTOR_INFO_BYTES = 116;
const SECTOR_INFO_TAIL_BYTES = SECTOR_INFO_BYTES - 4;
const MAP_SIDE = 16;
const UNDERGROUND_SECTOR_BYTES = 72;
const UNDERGROUND_SECTOR_TAIL_BYTES = UNDERGROUND_SECTOR_BYTES - 7;
const NUMBER_OF_SQUADS = 20;
const SQUAD_SLOTS = 6;
const SQUAD_RECORD_PADDING = 8;
const ENEMY_GROUP_BYTES = 29;
const WAYPOINT_BYTES = 8;
const GROUP_ID_MASK_BYTES = 32;
const MAX_QUESTS = 30;
const NUM_FACTS = 500;
const MAP_SCREEN_MESSAGES = 256;
const SCROLL_STRING_TAIL_BYTES = 28;
const NPC_QUOTE_RECORDS = 50;
const NPC_QUOTE_RECORD_BYTES = 32;
const NUM_CIVQUOTE_SECTORS = 20;
const NUM_KEYS = 64;
const KEY_RECORD_BYTES = 8;
const PREGENERATED_NUMBERS = 256;
const NUM_ARMS_DEALERS = 19;
const ARMS_DEALER_STATUS_BYTES = 20;
const NOTHING = 0;
const DEALER_SPECIAL_ITEM_BYTES = 28;
const NUM_MINES = 6;
const MINE_STATUS_BYTES = 44;
const NUM_TOWNS = 13;
const TOWN_LOYALTY_BYTES = 26;
const VEHICLE_RECORD_BYTES = 128;
const BULLET_RECORD_BYTES = 128;
const REAL_OBJECT_RECORD_BYTES = 256;
const AIR_RAID_BYTES = 132;
const MAX_BOMB_QUEUE = 40;
const EXPLOSION_QUEUE_ENTRY_BYTES = 12;
const EXPLOSION_RECORD_BYTES = 36;
const CREATURE_DIRECTIVE_BYTES = 13;
const DESTROYED_LAIR_BYTES = 4;
const STRATEGIC_STATUS_BYTES = 192;
const SAI_PADDING_BYTES = 97;
const SAVED_ARMY_COMPOSITIONS = 60;
const ARMY_COMPOSITION_BYTES = 20;
const SAVED_PATROL_GROUPS = 50;
const PATROL_GROUP_BYTES = 20;
const SAVED_GARRISON_GROUPS = 100;
const GARRISON_GROUP_BYTES = 14;
const ITEM_CURSOR_BYTES = 44;
const NUM_CIV_QUOTES = 50;
const NUM_MEANWHILES = 17;
const MEANWHILE_DEFINITION_BYTES = 8;
const SCHEDULE_RECORD_BYTES = 36;
const MAX_VEHICLES = 10;
const CONTRACT_RENEWAL_SLOTS = 20;
const CONTRACT_RENEWAL_NODE_BYTES = 4;
const NUM_LEAVE_LIST_SLOTS = 20;
const LEAVE_ITEM_BYTES = 40;
const BOBBY_RAY_SHIPMENT_BYTES = 104;

export const LAPTOP_INFO_LAYOUT: Layout = [
  field('gfNewGameLaptop', 'bool'),
  field('fVisitedBookmarkAlready', 'bool', BOOKMARKS),
  skip(3),
  field('iBookMarkList', 'i32', BOOKMARKS),
  field('iCurrentBalance', 'i32'),
  field('fIMPCompletedFlag', 'bool'),
  field('fSentImpWarningAlready', 'bool'),
  field('ubDeadCharactersList', 'i16', CHARACTER_LIST_ENTRIES),
  field('ubLeftCharactersList', 'i16', CHARACTER_LIST_ENTRIES),
  field('ubOtherCharactersList', 'i16', CHARACTER_LIST_ENTRIES),
  field('gubPlayersMercAccountStatus', 'u8'),
  skip(1),
  field('guiPlayersMercAccountNumber', 'u32'),
  field('gubLastMercIndex', 'u8'),
  skip(1),
  skip(MAXITEMS * STORE_INVENTORY_BYTES, 'BobbyRayInventory'),
  skip(MAXITEMS * STORE_INVENTORY_BYTES, 'BobbyRayUsedInventory'),
  skip(6),
  field('BobbyRayOrdersOnDeliveryArraySize', 'u8'),
  field('usNumberOfBobbyRayOrderUsed', 'u8'),
  skip(6),
  field('numLifeInsurancePayouts', 'u8'),
  field('ubNumberLifeInsurancePayoutUsed', 'u8'),
  field('fBobbyRSiteCanBeAccessed', 'bool'),
  field('ubPlayerBeenToMercSiteStatus', 'u8'),
  field('fFirstVisitSinceServerWentDown', 'bool'),
  field('fNewMercsAvailableAtMercSite', 'bool'),
  field('fSaidGenericOpeningInMercSite', 'bool'),
  field('fSpeckSaidFloMarriedCousinQuote', 'bool'),
  field('fHasAMercDiedAtMercSite', 'bool'),
  skip(11),
  field('usInventoryListLength', 'u16', 2),
  field('iVoiceId', 'i32'),
  field('ubHaveBeenToBobbyRaysAtLeastOnceWhileUnderConstruction', 'u8'),
  field('fMercSiteHasGoneDownYet', 'bool'),
  field('ubSpeckCanSayPlayersLostQuote', 'u8'),
  skip(1),
  field('fHaveDisplayedPopUpInLaptop', 'bool'),
  skip(3),
  field('iIdOfMerc', 'i32'),
  field('uiArrivalTime', 'u32'),
  field('iCurrentHistoryPage', 'i32'),
  field('iCurrentFinancesPage', 'i32'),
  field('iCurrentEmailPage', 'i32'),
  field('uiSpeckQuoteFlags', 'u32'),
  field('uiFlowerOrderNumber', 'u32'),
  field('uiTotalMoneyPaidToSpeck', 'u32'),
  field('ubLastMercAvailableId', 'u8'),
  skip(87),
];

const STRATEGIC_EVENT_LAYOUT: Layout = [
  skip(4),
  field('uiTimeStamp', 'u32'),
  field('uiParam', 'u32'),
  field('uiTimeOffset', 'u32'),
  field('ubEventType', 'u8'),
  field('ubCallbackID', 'u8'),
  field('ubFlags', 'u8'),
  skip(9),
];

const DEALER_ITEM_HEADER_LAYOUT: Layout = [
  field('ubTotalItems', 'u8'),
  field('ubPerfectItems', 'u8'),
  field('ubStrayAmmo', 'u8'),
  field('numSpecialItem', 'u8'),
  skip(4),
  field('uiOrderArrivalTime', 'u32'),
  field('ubQtyOnOrder', 'u8'),
  field('fPreviouslyEligible', 'bool'),
  skip(2),
];

const GROUP_LAYOUT: Layout = [
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

const STRATEGIC_AI_LAYOUT: Layout = [
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
  skip(SAVED_ARMY_COMPOSITIONS * ARMY_COMPOSITION_BYTES, 'gArmyComp'),
  skip(SAVED_PATROL_GROUPS * PATROL_GROUP_BYTES, 'gPatrolGroup'),
  skip(SAVED_GARRISON_GROUPS * GARRISON_GROUP_BYTES, 'gGarrisonGroup'),
];

export interface SaveSection {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

export interface WorldTime {
  readonly totalSeconds: number;
  readonly totalMinutes: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface StrategicEvent {
  readonly timeStamp: number;
  readonly param: number;
  readonly timeOffset: number;
  readonly eventType: number;
  readonly callbackId: number;
  readonly flags: number;
}

export interface LaptopInfo {
  readonly currentBalance: number;
  readonly impCompleted: boolean;
  readonly bobbyRayOrders: number;
  readonly lifeInsurancePayouts: number;
}

export interface SavedSoldierEntry {
  readonly soldier: SavedSoldier;
  readonly mercPath: readonly number[];
  readonly keyRing: readonly { readonly keyId: number; readonly count: number }[] | null;
}

export interface UndergroundSector {
  readonly sector: SectorPosition;
  readonly flags: number;
}

export interface StrategicGroup {
  readonly id: number;
  readonly player: boolean;
  readonly vehicle: boolean;
  readonly persistent: boolean;
  readonly size: number;
  readonly sector: SectorPosition;
  readonly betweenSectors: boolean;
  readonly playerProfiles: readonly number[];
  readonly waypoints: number;
}

export interface CurrentSectorState {
  readonly sector: SectorPosition;
  readonly worldItems: readonly SavedWorldItem[] | null;
  readonly doors: readonly SavedDoor[] | null;
  readonly doorStatus: readonly SavedDoorStatus[] | null;
}

export interface PreRandomTable {
  readonly index: number;
  readonly numbers: readonly number[];
}

export interface SaveGame {
  readonly header: SaveGameHeader;
  readonly stracLinuxFormat: boolean;
  readonly encryptionSet: number;
  readonly germanEncryption: boolean;
  readonly tactical: TacticalStatus;
  readonly clock: GameClock;
  readonly worldTime: WorldTime;
  readonly strategicEvents: readonly StrategicEvent[];
  readonly laptop: LaptopInfo;
  readonly profiles: readonly SavedMercProfile[];
  readonly soldiers: readonly SavedSoldierEntry[];
  readonly sectorFlags: readonly number[];
  readonly undergroundSectors: readonly UndergroundSector[];
  readonly squads: readonly (readonly number[])[];
  readonly squadMovementGroups: readonly number[];
  readonly groups: readonly StrategicGroup[];
  readonly tempFiles: readonly SectorTempFile[];
  readonly currentSector: CurrentSectorState;
  readonly quests: readonly number[];
  readonly facts: readonly number[];
  readonly oppList: OppListInfo;
  readonly preRandom: PreRandomTable;
  readonly generalInfo: GeneralInfo;
  readonly teamTurns: TeamTurns;
  readonly watchedLocations: WatchedLocations;
  readonly gameStates: string | null;
  readonly sections: readonly SaveSection[];
  readonly bytesConsumed: number;
}

interface Context {
  readonly c: SaveCursor;
  readonly version: number;
  readonly linux: boolean;
  readonly sections: SaveSection[];
}

interface EncryptionChoice {
  readonly key: Uint8Array | null;
  readonly set: number;
  readonly german: boolean;
}

function section<T>(ctx: Context, name: string, read: () => T): T {
  const offset = ctx.c.pos;
  const value = read();
  ctx.sections.push({ name, offset, size: ctx.c.pos - offset });
  return value;
}

function decryptWith(key: Uint8Array | null, encrypted: Uint8Array): Uint8Array {
  return key ? decryptSaveRecord(encrypted, key) : decryptWithOldKey(encrypted);
}

export function profilesInSave(version: number): number {
  return version < FIRST_VERSION_WITH_EXTENDED_PROFILES ? NUM_VANILLA_PROFILES : NUM_PROFILES;
}

function worldTimeOf(seconds: number): WorldTime {
  return {
    totalSeconds: seconds,
    totalMinutes: Math.trunc(seconds / SECONDS_PER_MINUTE),
    day: Math.trunc(seconds / SECONDS_PER_DAY),
    hour: Math.trunc((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR),
    minute: Math.trunc((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
  };
}

function readStrategicEvents(c: SaveCursor): StrategicEvent[] {
  const count = c.u32();
  return Array.from({ length: count }, () => {
    const r = readLayout(c, STRATEGIC_EVENT_LAYOUT, false, 'STRATEGICEVENT');
    return {
      timeStamp: r.num('uiTimeStamp'),
      param: r.num('uiParam'),
      timeOffset: r.num('uiTimeOffset'),
      eventType: r.num('ubEventType'),
      callbackId: r.num('ubCallbackID'),
      flags: r.num('ubFlags'),
    };
  });
}

function readLaptopInfo(c: SaveCursor): LaptopInfo {
  const r = readLayout(c, LAPTOP_INFO_LAYOUT, false, 'LaptopSaveInfo');
  const orders = r.num('usNumberOfBobbyRayOrderUsed') !== 0 ? r.num('BobbyRayOrdersOnDeliveryArraySize') : 0;
  c.skip(orders * BOBBY_RAY_ORDER_BYTES);
  const payouts = r.num('ubNumberLifeInsurancePayoutUsed') !== 0 ? r.num('numLifeInsurancePayouts') : 0;
  c.skip(payouts * LIFE_INSURANCE_PAYOUT_BYTES);
  return {
    currentBalance: r.num('iCurrentBalance'),
    impCompleted: r.bool('fIMPCompletedFlag'),
    bobbyRayOrders: orders,
    lifeInsurancePayouts: payouts,
  };
}

function readProfiles(ctx: Context, key: Uint8Array | null): SavedMercProfile[] {
  const count = profilesInSave(ctx.version);
  const size = profileRecordBytes(ctx.linux);
  const profiles: SavedMercProfile[] = [];
  for (let id = 0; id < count; id++) {
    const profile = decodeSavedProfile(id, decryptWith(key, ctx.c.view(size)), ctx.linux);
    if (profile.checksum !== profileChecksum(profile)) throw new FormatError(`merc profile ${id}: checksum mismatch`);
    profiles.push(profile);
  }
  if (ctx.version >= FIRST_VERSION_WITH_VOICE_IDS) ctx.c.skip(count * 2);
  return profiles;
}

function readMercPath(c: SaveCursor): number[] {
  const nodes = c.u32();
  return Array.from({ length: nodes }, () => {
    const sectorId = c.u32();
    c.skip(MERC_PATH_NODE_BYTES - 4);
    return sectorId;
  });
}

function readSoldiers(ctx: Context, key: Uint8Array | null): SavedSoldierEntry[] {
  const { c } = ctx;
  const entries: SavedSoldierEntry[] = [];
  for (let slot = 0; slot < TOTAL_SOLDIERS; slot++) {
    if (c.u8() === 0) continue;
    const soldier = decodeSoldierRecord(decryptWith(key, c.view(soldierRecordBytes(ctx.linux))), ctx.version, ctx.linux);
    if (soldier.checksum !== soldierChecksum(soldier)) throw new FormatError(`soldier slot ${slot}: checksum mismatch`);
    if (soldier.id !== slot) throw new FormatError(`soldier slot ${slot} holds ubID ${soldier.id}`);
    const mercPath = readMercPath(c);
    const keyRing = c.u8() !== 0 ? readKeyRing(c) : null;
    entries.push({ soldier, mercPath, keyRing });
  }
  return entries;
}

function readKeyRing(c: SaveCursor): { keyId: number; count: number }[] {
  return Array.from({ length: KEY_RING_BYTES / 2 }, () => ({ keyId: c.u8(), count: c.u8() }));
}

function skipSizedBlob(c: SaveCursor): void {
  c.skip(c.u32());
}

function skipEmails(c: SaveCursor): void {
  const count = c.u32();
  for (let i = 0; i < count; i++) {
    skipSizedBlob(c);
    c.skip(EMAIL_RECORD_BYTES);
  }
}

function readSectorFlags(c: SaveCursor): number[] {
  c.skip(MAP_WORLD_CELLS * STRATEGIC_MAP_ELEMENT_BYTES);
  const flags = Array.from({ length: SECTOR_INFO_COUNT }, () => {
    const f = c.u32();
    c.skip(SECTOR_INFO_TAIL_BYTES);
    return f;
  });
  c.skip(MAP_WORLD_CELLS);
  c.skip(1);
  return flags;
}

function readUndergroundSectors(c: SaveCursor): UndergroundSector[] {
  const count = c.u32();
  return Array.from({ length: count }, () => {
    const flags = c.u32();
    const sector = { x: c.u8(), y: c.u8(), z: c.u8() };
    c.skip(UNDERGROUND_SECTOR_TAIL_BYTES);
    return { sector, flags };
  });
}

function readSquads(c: SaveCursor, version: number): { squads: number[][]; movementGroups: number[] } {
  const squads: number[][] = Array.from({ length: NUMBER_OF_SQUADS }, () => []);
  for (let i = 0; i < NUMBER_OF_SQUADS * SQUAD_SLOTS; i++) {
    const id = c.i16();
    const formatVersion = c.u8();
    const recordedSquad = c.i8();
    c.skip(SQUAD_RECORD_PADDING);
    if (id < 0) continue;
    const ownSquadField = version >= FIRST_VERSION_WITH_SQUAD_FIELD && formatVersion === SQUAD_INFO_FORMAT_VERSION;
    squads[ownSquadField ? recordedSquad : Math.trunc(i / SQUAD_SLOTS)]?.push(id);
  }
  return { squads, movementGroups: c.i8s(NUMBER_OF_SQUADS) };
}

function readGroups(c: SaveCursor): StrategicGroup[] {
  const count = c.u32();
  const groups: StrategicGroup[] = [];
  for (let i = 0; i < count; i++) {
    const r = readLayout(c, GROUP_LAYOUT, false, 'GROUP');
    const player = r.bool('fPlayer');
    const size = r.num('ubGroupSize');
    const id = r.num('ubGroupID');
    const vehicle = r.bool('fVehicle');
    const persistent = r.bool('fPersistant');
    const betweenSectors = r.bool('fBetweenSectors');
    const sector = { x: r.num('ubSectorX'), y: r.num('ubSectorY'), z: r.num('ubSectorZ') };
    const playerProfiles: number[] = [];
    if (player && size > 0) playerProfiles.push(...c.u32s(c.u32()));
    if (!player) c.skip(ENEMY_GROUP_BYTES);
    const waypoints = c.u32();
    c.skip(waypoints * WAYPOINT_BYTES);
    groups.push({ id, player, vehicle, persistent, size, sector, betweenSectors, playerProfiles, waypoints });
  }
  c.skip(GROUP_ID_MASK_BYTES);
  return groups;
}

function readMapTempFiles(c: SaveCursor, sectorFlags: readonly number[], underground: readonly UndergroundSector[]): SectorTempFile[] {
  const files: SectorTempFile[] = [];
  for (let y = 1; y <= MAP_SIDE; y++) {
    for (let x = 1; x <= MAP_SIDE; x++) {
      files.push(...readSectorTempFiles(c, { x, y, z: 0 }, sectorFlags[(y - 1) * MAP_SIDE + x - 1] ?? 0));
    }
  }
  for (const u of underground) files.push(...readSectorTempFiles(c, u.sector, u.flags));
  return files;
}

function skipMapScreenMessages(c: SaveCursor): void {
  c.skip(3);
  for (let i = 0; i < MAP_SCREEN_MESSAGES; i++) {
    const size = c.u32();
    if (size === 0) continue;
    c.skip(size + SCROLL_STRING_TAIL_BYTES);
  }
}

function skipNpcQuoteArrays(c: SaveCursor, count: number): void {
  for (let i = 0; i < count; i++) {
    if (c.u8() !== 0) c.skip(NPC_QUOTE_RECORDS * NPC_QUOTE_RECORD_BYTES);
  }
}

function readPreRandom(c: SaveCursor): PreRandomTable {
  return { index: c.u32(), numbers: c.u32s(PREGENERATED_NUMBERS) };
}

function skipArmsDealers(c: SaveCursor): void {
  c.skip(NUM_ARMS_DEALERS * ARMS_DEALER_STATUS_BYTES);
  let specialItems = 0;
  for (let dealer = 0; dealer < NUM_ARMS_DEALERS; dealer++) {
    for (let item = 0; item < MAXITEMS; item++) {
      const count = readLayout(c, DEALER_ITEM_HEADER_LAYOUT, false, 'DEALER_ITEM_HEADER').num('numSpecialItem');
      if (item !== NOTHING) specialItems += count;
    }
  }
  c.skip(specialItems * DEALER_SPECIAL_ITEM_BYTES);
}

function skipVehicles(c: SaveCursor): void {
  const count = c.u8();
  for (let i = 0; i < count; i++) {
    if (!c.bool()) continue;
    c.skip(VEHICLE_RECORD_BYTES);
    readMercPath(c);
  }
}

function skipCountedRecords(c: SaveCursor, recordBytes: number): void {
  c.skip(c.u32() * recordBytes);
}

function skipExplosions(c: SaveCursor): void {
  c.skip(4 + MAX_BOMB_QUEUE * EXPLOSION_QUEUE_ENTRY_BYTES);
  skipCountedRecords(c, EXPLOSION_RECORD_BYTES);
}

function skipStrategicAi(c: SaveCursor): void {
  const r = readLayout(c, STRATEGIC_AI_LAYOUT, false, 'strategic AI');
  c.skip(r.num('iPatrolArraySize'));
  c.skip(r.num('iGarrisonArraySize'));
}

function skipLeaveItemList(c: SaveCursor): void {
  for (let i = 0; i < NUM_LEAVE_LIST_SLOTS; i++) {
    if (!c.bool()) continue;
    c.skip(c.u32() * LEAVE_ITEM_BYTES);
  }
  c.skip(NUM_LEAVE_LIST_SLOTS * 4);
}

function readGameStates(c: SaveCursor): string {
  return String.fromCharCode(...c.view(c.u32()));
}

function sameSector(a: SectorPosition, b: SectorPosition): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function currentSectorState(sector: SectorPosition, files: readonly SectorTempFile[]): CurrentSectorState {
  const file = (kind: SectorTempFile['kind']) => files.find((f) => f.kind === kind && sameSector(f.sector, sector))?.bytes;
  const items = file('items');
  const doors = file('doorTable');
  const status = file('doorStatus');
  return {
    sector,
    worldItems: items ? decodeWorldItemsFile(items) : null,
    doors: doors ? decodeDoorTableFile(doors) : null,
    doorStatus: status ? decodeDoorStatusFile(status) : null,
  };
}

function chooseEncryption(firstProfile: Uint8Array, header: SaveGameHeader, linux: boolean, table: SaveEncryptionTable): EncryptionChoice {
  if (header.version < FIRST_VERSION_WITH_NEW_ENCRYPTION) return { key: null, set: -1, german: false };
  if (firstProfile.length < profileRecordBytes(linux)) throw new FormatError('savegame ends before the merc profiles');
  for (const german of [false, true]) {
    const set = encryptionSetIndex(header, table.baseSets, german);
    const key = table.sets[set];
    if (!key) throw new FormatError(`encryption set ${set} is outside the table`);
    const profile = decodeSavedProfile(0, decryptSaveRecord(firstProfile, key), linux);
    if (profile.checksum === profileChecksum(profile)) return { key, set, german };
  }
  throw new FormatError('no encryption set yields a valid merc profile checksum');
}

export function parseSaveGame(bytes: Uint8Array, encryption: SaveEncryptionTable): SaveGame {
  const { header, stracLinuxFormat: linux } = parseSaveHeader(bytes);
  const version = header.version;
  if (version < MIN_SAVE_VERSION || version > MAX_SAVE_VERSION) {
    throw new FormatError(`unsupported savegame version ${version} (supported ${MIN_SAVE_VERSION}..${MAX_SAVE_VERSION})`);
  }
  const headerBytes = linux ? SAVE_HEADER_BYTES_STRAC_LINUX : SAVE_HEADER_BYTES;
  const ctx: Context = {
    c: new SaveCursor(bytes, headerBytes),
    version,
    linux,
    sections: [{ name: 'header', offset: 0, size: headerBytes }],
  };
  const { c } = ctx;
  const tactical = section(ctx, 'tactical status', () => readTacticalStatus(c, linux));
  const clock = section(ctx, 'game clock', () => readGameClock(c));
  const strategicEvents = section(ctx, 'strategic events', () => readStrategicEvents(c));
  const laptop = section(ctx, 'laptop info', () => readLaptopInfo(c));
  const { key, set, german } = chooseEncryption(bytes.subarray(c.pos, c.pos + profileRecordBytes(linux)), header, linux, encryption);
  const profiles = section(ctx, 'merc profiles', () => readProfiles(ctx, key));
  const soldiers = section(ctx, 'soldiers', () => readSoldiers(ctx, key));
  section(ctx, 'finances file', () => skipSizedBlob(c));
  section(ctx, 'history file', () => skipSizedBlob(c));
  section(ctx, 'files file', () => skipSizedBlob(c));
  section(ctx, 'email', () => skipEmails(c));
  const sectorFlags = section(ctx, 'strategic info', () => readSectorFlags(c));
  const undergroundSectors = section(ctx, 'underground sectors', () => readUndergroundSectors(c));
  const { squads, movementGroups } = section(ctx, 'squads', () => readSquads(c, version));
  const groups = section(ctx, 'strategic movement groups', () => readGroups(c));
  const tempFiles = section(ctx, 'map temp files', () => readMapTempFiles(c, sectorFlags, undergroundSectors));
  const { quests, facts } = section(ctx, 'quests', () => ({ quests: c.u8s(MAX_QUESTS), facts: c.u8s(NUM_FACTS) }));
  const oppList = section(ctx, 'opplist', () => readOppList(c));
  section(ctx, 'map screen messages', () => skipMapScreenMessages(c));
  section(ctx, 'npc info', () => skipNpcQuoteArrays(c, profilesInSave(version) + NUM_CIVQUOTE_SECTORS));
  section(ctx, 'key table', () => c.skip(NUM_KEYS * KEY_RECORD_BYTES));
  section(ctx, 'temp npc quotes', () => skipSizedBlob(c));
  const preRandom = section(ctx, 'prerandom', () => readPreRandom(c));
  section(ctx, 'arms dealers', () => skipArmsDealers(c));
  const generalInfo = section(ctx, 'general info', () => readGeneralInfo(c));
  section(ctx, 'mine status', () => c.skip(NUM_MINES * MINE_STATUS_BYTES));
  section(ctx, 'town loyalty', () => c.skip(NUM_TOWNS * TOWN_LOYALTY_BYTES));
  section(ctx, 'vehicles', () => skipVehicles(c));
  section(ctx, 'bullets', () => skipCountedRecords(c, BULLET_RECORD_BYTES));
  section(ctx, 'physics objects', () => skipCountedRecords(c, REAL_OBJECT_RECORD_BYTES));
  section(ctx, 'air raid (unused)', () => c.skip(AIR_RAID_BYTES));
  const teamTurns = section(ctx, 'team turns', () => readTeamTurns(c));
  section(ctx, 'explosions', () => skipExplosions(c));
  section(ctx, 'creature directives', () =>
    c.skip(CREATURE_DIRECTIVE_BYTES + (version >= FIRST_VERSION_WITH_DESTROYED_LAIR ? DESTROYED_LAIR_BYTES : 0)),
  );
  section(ctx, 'strategic status', () => c.skip(STRATEGIC_STATUS_BYTES));
  section(ctx, 'strategic ai', () => skipStrategicAi(c));
  const watchedLocations = section(ctx, 'watched locations', () => readWatchedLocations(c));
  section(ctx, 'item cursor', () => c.skip(ITEM_CURSOR_BYTES));
  section(ctx, 'civ quotes', () => c.skip(NUM_CIV_QUOTES * 2));
  section(ctx, 'backup npc info', () => skipNpcQuoteArrays(c, profilesInSave(version)));
  section(ctx, 'meanwhile definitions', () => c.skip(NUM_MEANWHILES * MEANWHILE_DEFINITION_BYTES));
  section(ctx, 'schedules', () => c.skip(c.u8() * SCHEDULE_RECORD_BYTES));
  section(ctx, 'vehicle movement groups', () => c.skip(MAX_VEHICLES));
  section(ctx, 'contract renewals', () => c.skip(CONTRACT_RENEWAL_SLOTS * CONTRACT_RENEWAL_NODE_BYTES + 1));
  section(ctx, 'leave item list', () => skipLeaveItemList(c));
  section(ctx, 'bobby ray shipments', () => c.skip(c.i32() * BOBBY_RAY_SHIPMENT_BYTES));
  const gameStates = version >= FIRST_VERSION_WITH_GAME_STATES ? section(ctx, 'game states', () => readGameStates(c)) : null;
  if (c.remaining !== 0) throw new FormatError(`savegame has ${c.remaining} unparsed bytes at ${c.pos}`);
  const worldSector = tactical.worldSector;
  const currentSector = currentSectorState(isValidSectorPosition(worldSector) ? worldSector : header.sector, tempFiles);
  return {
    header,
    stracLinuxFormat: linux,
    encryptionSet: set,
    germanEncryption: german,
    tactical,
    clock,
    worldTime: worldTimeOf(clock.gameClock),
    strategicEvents,
    laptop,
    profiles,
    soldiers,
    sectorFlags,
    undergroundSectors,
    squads,
    squadMovementGroups: movementGroups,
    groups,
    tempFiles,
    currentSector,
    quests,
    facts,
    oppList,
    preRandom,
    generalInfo,
    teamTurns,
    watchedLocations,
    gameStates,
    sections: ctx.sections,
    bytesConsumed: c.pos,
  };
}
