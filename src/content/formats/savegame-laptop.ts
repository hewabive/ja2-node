// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Laptop.cc LoadLaptopInfoFromSavedGame, ExtractStoreInvetory; Laptop/LaptopSave.h LaptopSaveInfoStruct,
// @src LIFE_INSURANCE_PAYOUT, BobbyRayOrderStruct; Laptop/BobbyRMailOrder.cc NewWayOfLoadingBobbyRMailOrdersToSaveGameFile,
// @src NewBobbyRayOrderStruct; Laptop/History.cc OpenAndReadHistoryFile (record layout); Laptop/Files.cc OpenAndReadFilesFile;
// @src LoadSaveEMail.cc LoadEMailFromFile; SaveLoadGame.cc LoadSavedMercProfiles (voice ids, I.M.P. slot states),
// @src LoadGeneralInfo (g_merc_arrive_sector), LoadFileFromSavedGame.

import { FormatError } from '../binary/errors.ts';
import type { SaveGame, SaveSection } from './savegame.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { layoutOffsets } from './savegame-layout.ts';
import { GENERAL_INFO_LAYOUT } from './savegame-tactical.ts';

const BOOKMARKS = 20;
const NO_BOOKMARK = -1;
const CHARACTER_LIST_ENTRIES = 256;
const MAXITEMS = 351;
const STORE_INVENTORY_PADDING = 2;
const LAPTOP_INFO_BYTES = 7440;
const OLD_ORDER_BYTES = 84;
const LIFE_INSURANCE_PAYOUT_PADDING = 1;
const MAX_PURCHASE_AMOUNT = 10;
const SHIPMENT_HEADER_PADDING = 1;
const SHIPMENT_COUNT_PADDING = 3;
const SHIPMENT_FILLER = 7;
const PURCHASE_PADDING = 1;
const HISTORY_RECORD_BYTES = 12;
const FILE_RECORD_BYTES = 263;
const FILE_RECORD_SKIP = 261;
const EMAIL_RECORD_BYTES = 44;
const FIRST_VERSION_WITH_VOICE_IDS = 104;
const SEL_MAP_Z_BYTES = 4;
const BYTES_FROM_SEL_MAP_TO_MERC_ARRIVE = 8;

export interface SavedStoreSlot {
  readonly item: number;
  readonly onHand: number;
  readonly onOrder: number;
  readonly quality: number;
  readonly previouslyEligible: boolean;
}

export interface SavedLifeInsurancePayout {
  readonly active: boolean;
  readonly soldier: number;
  readonly profile: number;
  readonly payout: number;
}

export interface SavedLaptopInfo {
  readonly newGameLaptop: boolean;
  readonly bookmarks: readonly number[];
  readonly currentBalance: number;
  readonly impCompleted: boolean;
  readonly sentImpWarningAlready: boolean;
  readonly deadCharacters: readonly number[];
  readonly leftCharacters: readonly number[];
  readonly otherCharacters: readonly number[];
  readonly mercAccountStatus: number;
  readonly mercAccountNumber: number;
  readonly lastMercIndex: number;
  readonly bobbyRayInventory: readonly SavedStoreSlot[];
  readonly bobbyRayUsedInventory: readonly SavedStoreSlot[];
  readonly inventoryListLength: readonly [number, number];
  readonly lifeInsurancePayouts: readonly SavedLifeInsurancePayout[];
  readonly lifeInsurancePayoutsUsed: number;
  readonly bobbyRaySiteCanBeAccessed: boolean;
  readonly playerBeenToMercSiteStatus: number;
  readonly firstVisitSinceServerWentDown: number;
  readonly newMercsAvailableAtMercSite: boolean;
  readonly saidGenericOpeningInMercSite: boolean;
  readonly speckSaidFloMarriedCousinQuote: boolean;
  readonly hasAMercDiedAtMercSite: boolean;
  readonly voiceId: number;
  readonly bobbyRayUnderConstructionVisit: number;
  readonly mercSiteHasGoneDownYet: boolean;
  readonly speckCanSayPlayersLostQuote: number;
  readonly lastHiredMerc: { readonly profile: number; readonly arrival: number };
  readonly speckQuoteFlags: number;
  readonly flowerOrderNumber: number;
  readonly totalMoneyPaidToSpeck: number;
  readonly lastMercAvailableId: number;
}

export interface SavedShipmentLine {
  readonly item: number;
  readonly count: number;
  readonly quality: number;
  readonly slot: number;
  readonly used: boolean;
}

export interface SavedShipment {
  readonly active: boolean;
  readonly destination: number;
  readonly speed: number;
  readonly lines: readonly SavedShipmentLine[];
  readonly weight: number;
  readonly orderDay: number;
  readonly displayedOnShipmentsPage: boolean;
}

export interface SavedHistoryRecord {
  readonly code: number;
  readonly secondCode: number;
  readonly date: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SavedFileRecord {
  readonly code: number;
  readonly read: boolean;
}

export interface SavedEmail {
  readonly offset: number;
  readonly length: number;
  readonly sender: number;
  readonly date: number;
  readonly firstData: number;
  readonly secondData: number;
  readonly read: boolean;
}

export interface SavedLaptop {
  readonly info: SavedLaptopInfo;
  readonly shipments: readonly SavedShipment[];
  readonly history: readonly SavedHistoryRecord[];
  readonly files: readonly SavedFileRecord[];
  readonly emails: readonly SavedEmail[];
  readonly impSlotStates: readonly number[] | null;
  readonly voiceIds: readonly number[] | null;
  readonly mercArriveSector: { readonly x: number; readonly y: number };
}

function sectionBytes(bytes: Uint8Array, sections: readonly SaveSection[], name: string): Uint8Array {
  const s = sections.find((x) => x.name === name);
  if (!s) throw new FormatError(`savegame has no ${name} section`);
  return bytes.subarray(s.offset, s.offset + s.size);
}

function readStoreSlot(c: SaveCursor): SavedStoreSlot {
  const item = c.u16();
  const onHand = c.u8();
  const onOrder = c.u8();
  const quality = c.u8();
  const previouslyEligible = c.bool();
  c.skip(STORE_INVENTORY_PADDING);
  return { item, onHand, onOrder, quality, previouslyEligible };
}

function readPayout(c: SaveCursor): SavedLifeInsurancePayout {
  const active = c.bool();
  const soldier = c.u8();
  const profile = c.u8();
  c.skip(LIFE_INSURANCE_PAYOUT_PADDING);
  return { active, soldier, profile, payout: c.i32() };
}

function bookmarkList(raw: readonly number[]): number[] {
  const end = raw.indexOf(NO_BOOKMARK);
  return [...raw.slice(0, end < 0 ? raw.length : end)];
}

export function decodeLaptopInfo(section: Uint8Array): SavedLaptopInfo {
  const c = new SaveCursor(section);
  const newGameLaptop = c.bool();
  c.skip(BOOKMARKS + 3);
  const bookmarks = bookmarkList(Array.from({ length: BOOKMARKS }, () => c.i32()));
  const currentBalance = c.i32();
  const impCompleted = c.bool();
  const sentImpWarningAlready = c.bool();
  const deadCharacters = c.i16s(CHARACTER_LIST_ENTRIES);
  const leftCharacters = c.i16s(CHARACTER_LIST_ENTRIES);
  const otherCharacters = c.i16s(CHARACTER_LIST_ENTRIES);
  const mercAccountStatus = c.u8();
  c.skip(1);
  const mercAccountNumber = c.u32();
  const lastMercIndex = c.u8();
  c.skip(1);
  const newSlots = Array.from({ length: MAXITEMS }, () => readStoreSlot(c));
  const usedSlots = Array.from({ length: MAXITEMS }, () => readStoreSlot(c));
  c.skip(6);
  const oldOrderArraySize = c.u8();
  const oldOrdersUsed = c.u8();
  c.skip(6);
  const payoutArraySize = c.u8();
  const lifeInsurancePayoutsUsed = c.u8();
  const bobbyRaySiteCanBeAccessed = c.bool();
  const playerBeenToMercSiteStatus = c.u8();
  const firstVisitSinceServerWentDown = c.u8();
  const newMercsAvailableAtMercSite = c.bool();
  const saidGenericOpeningInMercSite = c.bool();
  const speckSaidFloMarriedCousinQuote = c.bool();
  const hasAMercDiedAtMercSite = c.bool();
  c.skip(11);
  const inventoryListLength: [number, number] = [c.u16(), c.u16()];
  const voiceId = c.i32();
  const bobbyRayUnderConstructionVisit = c.u8();
  const mercSiteHasGoneDownYet = c.bool();
  const speckCanSayPlayersLostQuote = c.u8();
  c.skip(1);
  c.skip(1);
  c.skip(3);
  const lastHiredMerc = { profile: c.i32(), arrival: c.u32() };
  c.skip(12);
  const speckQuoteFlags = c.u32();
  const flowerOrderNumber = c.u32();
  const totalMoneyPaidToSpeck = c.u32();
  const lastMercAvailableId = c.u8();
  c.skip(87);
  c.expectConsumed(0, LAPTOP_INFO_BYTES, 'LaptopSaveInfo');
  if (oldOrdersUsed !== 0) c.skip(oldOrderArraySize * OLD_ORDER_BYTES);
  const lifeInsurancePayouts = lifeInsurancePayoutsUsed !== 0 ? Array.from({ length: payoutArraySize }, () => readPayout(c)) : [];
  if (c.remaining !== 0) throw new FormatError(`laptop info has ${c.remaining} unparsed bytes`);
  return {
    newGameLaptop,
    bookmarks,
    currentBalance,
    impCompleted,
    sentImpWarningAlready,
    deadCharacters,
    leftCharacters,
    otherCharacters,
    mercAccountStatus,
    mercAccountNumber,
    lastMercIndex,
    bobbyRayInventory: newSlots.slice(0, inventoryListLength[0]),
    bobbyRayUsedInventory: usedSlots.slice(0, inventoryListLength[1]),
    inventoryListLength,
    lifeInsurancePayouts,
    lifeInsurancePayoutsUsed,
    bobbyRaySiteCanBeAccessed,
    playerBeenToMercSiteStatus,
    firstVisitSinceServerWentDown,
    newMercsAvailableAtMercSite,
    saidGenericOpeningInMercSite,
    speckSaidFloMarriedCousinQuote,
    hasAMercDiedAtMercSite,
    voiceId,
    bobbyRayUnderConstructionVisit,
    mercSiteHasGoneDownYet,
    speckCanSayPlayersLostQuote,
    lastHiredMerc,
    speckQuoteFlags,
    flowerOrderNumber,
    totalMoneyPaidToSpeck,
    lastMercAvailableId,
  };
}

function readPurchase(c: SaveCursor): SavedShipmentLine {
  const item = c.u16();
  const count = c.u8();
  const quality = c.i8();
  const slot = c.u16();
  const used = c.bool();
  c.skip(PURCHASE_PADDING);
  return { item, count, quality, slot, used };
}

function readShipment(c: SaveCursor): SavedShipment {
  const active = c.bool();
  const destination = c.u8();
  const speed = c.u8();
  c.skip(SHIPMENT_HEADER_PADDING);
  const purchases = Array.from({ length: MAX_PURCHASE_AMOUNT }, () => readPurchase(c));
  const lineCount = c.u8();
  c.skip(SHIPMENT_COUNT_PADDING);
  const weight = c.u32();
  const orderDay = c.u32();
  const displayedOnShipmentsPage = c.bool();
  c.skip(SHIPMENT_FILLER);
  return { active, destination, speed, lines: purchases.slice(0, lineCount), weight, orderDay, displayedOnShipmentsPage };
}

export function decodeShipments(section: Uint8Array): SavedShipment[] {
  const c = new SaveCursor(section);
  const count = c.i32();
  const shipments = Array.from({ length: Math.max(0, count) }, () => readShipment(c));
  if (c.remaining !== 0) throw new FormatError(`bobby ray shipments have ${c.remaining} unparsed bytes`);
  return shipments;
}

function sizedBlob(section: Uint8Array): Uint8Array {
  const c = new SaveCursor(section);
  return c.view(c.u32());
}

export function decodeHistoryFile(blob: Uint8Array): SavedHistoryRecord[] {
  const c = new SaveCursor(blob);
  const records: SavedHistoryRecord[] = [];
  for (let n = Math.trunc(blob.length / HISTORY_RECORD_BYTES); n > 0; n--) {
    const code = c.u8();
    const secondCode = c.u8();
    const date = c.u32();
    const x = c.i16();
    const y = c.i16();
    const z = c.i8();
    c.skip(1);
    records.push({ code, secondCode, date, x, y, z });
  }
  return records;
}

export function decodeFilesFile(blob: Uint8Array): SavedFileRecord[] {
  const c = new SaveCursor(blob);
  const records: SavedFileRecord[] = [];
  for (let n = Math.trunc(blob.length / FILE_RECORD_BYTES); n > 0; n--) {
    const code = c.u8();
    c.skip(FILE_RECORD_SKIP);
    records.push({ code, read: c.u8() !== 0 });
  }
  return records;
}

export function decodeEmails(section: Uint8Array): SavedEmail[] {
  const c = new SaveCursor(section);
  const emails: SavedEmail[] = [];
  for (let n = c.u32(); n > 0; n--) {
    c.skip(c.u32());
    const start = c.pos;
    const offset = c.u16();
    const length = c.u16();
    const sender = c.u8();
    c.skip(3);
    const date = c.u32();
    c.skip(4);
    const firstData = c.i32();
    const secondData = c.u32();
    c.skip(16);
    const read = c.bool();
    c.skip(3);
    c.expectConsumed(start, EMAIL_RECORD_BYTES, 'email record');
    emails.push({ offset, length, sender, date, firstData, secondData, read });
  }
  if (c.remaining !== 0) throw new FormatError(`email section has ${c.remaining} unparsed bytes`);
  return emails;
}

function profileTail(section: Uint8Array, count: number, version: number): { voiceIds: number[]; impSlotStates: number[] } | null {
  if (version < FIRST_VERSION_WITH_VOICE_IDS) return null;
  const tail = section.subarray(section.length - 2 * count);
  return { voiceIds: Array.from(tail.subarray(0, count)), impSlotStates: Array.from(tail.subarray(count)) };
}

function mercArriveSector(section: Uint8Array): { x: number; y: number } {
  const at = layoutOffsets(GENERAL_INFO_LAYOUT, false).get('sSelMapZ');
  if (at === undefined) throw new FormatError('general info: no field sSelMapZ');
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const x = at + SEL_MAP_Z_BYTES + BYTES_FROM_SEL_MAP_TO_MERC_ARRIVE;
  return { x: view.getInt16(x, true), y: view.getInt16(x + 2, true) };
}

export function readSavedLaptop(bytes: Uint8Array, save: SaveGame): SavedLaptop {
  const sections = save.sections;
  const tail = profileTail(sectionBytes(bytes, sections, 'merc profiles'), save.profiles.length, save.header.version);
  return {
    info: decodeLaptopInfo(sectionBytes(bytes, sections, 'laptop info')),
    shipments: decodeShipments(sectionBytes(bytes, sections, 'bobby ray shipments')),
    history: decodeHistoryFile(sizedBlob(sectionBytes(bytes, sections, 'history file'))),
    files: decodeFilesFile(sizedBlob(sectionBytes(bytes, sections, 'files file'))),
    emails: decodeEmails(sectionBytes(bytes, sections, 'email')),
    impSlotStates: tail?.impSlotStates ?? null,
    voiceIds: tail?.voiceIds ?? null,
    mercArriveSector: mercArriveSector(sectionBytes(bytes, sections, 'general info')),
  };
}
