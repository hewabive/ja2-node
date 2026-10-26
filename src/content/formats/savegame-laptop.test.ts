import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { parseSaveGame } from './savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from './savegame-header.ts';
import { decodeEmails, decodeFilesFile, decodeHistoryFile, decodeLaptopInfo, decodeShipments, readSavedLaptop } from './savegame-laptop.ts';

const BOOKMARKS = 20;
const LIST_ENTRIES = 256;
const MAXITEMS = 351;
const LAPTOP_INFO_BYTES = 7440;
const OLD_ORDER_BYTES = 84;
const MAX_PURCHASES = 10;
const FILE_RECORD_BYTES = 263;
const HISTORY_CODES = 78;
const PERSONNEL_LIST = 256;

interface InfoSetup {
  readonly payouts?: readonly { active: boolean; soldier: number; profile: number; payout: number }[];
  readonly oldOrders?: number;
}

function laptopInfo(setup: InfoSetup = {}): Uint8Array {
  const w = new BinaryWriter();
  w.u8(1).zeros(BOOKMARKS).zeros(3);
  for (let i = 0; i < BOOKMARKS; i++) w.i32([0, 3, 1][i] ?? -1);
  w.i32(12345).u8(1).u8(0);
  for (let i = 0; i < LIST_ENTRIES; i++) w.i16(i === 0 ? 7 : -1);
  for (let i = 0; i < LIST_ENTRIES; i++) w.i16(-1);
  for (let i = 0; i < LIST_ENTRIES; i++) w.i16(i === 1 ? 9 : -1);
  w.u8(4).zeros(1).u32(4242).u8(6).zeros(1);
  for (let i = 0; i < MAXITEMS; i++) {
    if (i < 2)
      w.u16(100 + i)
        .u8(5)
        .u8(i)
        .u8(100)
        .u8(1)
        .zeros(2);
    else w.zeros(8);
  }
  for (let i = 0; i < MAXITEMS; i++) {
    if (i === 0) w.u16(200).u8(1).u8(0).u8(55).u8(0).zeros(2);
    else w.zeros(8);
  }
  const payouts = setup.payouts ?? [];
  w.zeros(6)
    .u8(setup.oldOrders ?? 0)
    .u8(setup.oldOrders ? 1 : 0)
    .zeros(6)
    .u8(payouts.length)
    .u8(payouts.filter((p) => p.active).length);
  w.u8(1).u8(2).u8(2).u8(0).u8(1).u8(0).u8(1).zeros(11);
  w.u16(2).u16(1).i32(3).u8(1).u8(1).u8(1).zeros(1).u8(0).zeros(3).i32(5).u32(1890);
  w.i32(1).i32(1).i32(1).u32(2).u32(17).u32(5000).u8(1).zeros(87);
  w.zeros((setup.oldOrders ?? 0) * OLD_ORDER_BYTES);
  for (const p of payouts)
    w.u8(p.active ? 1 : 0)
      .u8(p.soldier)
      .u8(p.profile)
      .zeros(1)
      .i32(p.payout);
  return w.toBytes();
}

describe('the laptop section of a savegame', () => {
  it('reads every logic field of LaptopSaveInfo and cuts the store lists to their lengths', () => {
    const bytes = laptopInfo();
    expect(bytes.length).toBe(LAPTOP_INFO_BYTES);
    const info = decodeLaptopInfo(bytes);
    expect(info).toMatchObject({
      newGameLaptop: true,
      bookmarks: [0, 3, 1],
      currentBalance: 12345,
      impCompleted: true,
      sentImpWarningAlready: false,
      mercAccountStatus: 4,
      mercAccountNumber: 4242,
      lastMercIndex: 6,
      inventoryListLength: [2, 1],
      bobbyRaySiteCanBeAccessed: true,
      playerBeenToMercSiteStatus: 2,
      firstVisitSinceServerWentDown: 2,
      newMercsAvailableAtMercSite: false,
      saidGenericOpeningInMercSite: true,
      hasAMercDiedAtMercSite: true,
      voiceId: 3,
      bobbyRayUnderConstructionVisit: 1,
      mercSiteHasGoneDownYet: true,
      speckCanSayPlayersLostQuote: 1,
      lastHiredMerc: { profile: 5, arrival: 1890 },
      speckQuoteFlags: 2,
      flowerOrderNumber: 17,
      totalMoneyPaidToSpeck: 5000,
      lastMercAvailableId: 1,
      lifeInsurancePayouts: [],
    });
    expect(info.deadCharacters).toHaveLength(PERSONNEL_LIST);
    expect(info.deadCharacters[0]).toBe(7);
    expect(info.otherCharacters.slice(0, 2)).toEqual([-1, 9]);
    expect(info.bobbyRayInventory).toEqual([
      { item: 100, onHand: 5, onOrder: 0, quality: 100, previouslyEligible: true },
      { item: 101, onHand: 5, onOrder: 1, quality: 100, previouslyEligible: true },
    ]);
    expect(info.bobbyRayUsedInventory).toEqual([{ item: 200, onHand: 1, onOrder: 0, quality: 55, previouslyEligible: false }]);
  });

  it('skips the old order array and reads the insurance payouts after the struct', () => {
    const payouts = [
      { active: true, soldier: 3, profile: 12, payout: 4900 },
      { active: false, soldier: 0, profile: 0, payout: 0 },
    ];
    const info = decodeLaptopInfo(laptopInfo({ oldOrders: 2, payouts }));
    expect(info.lifeInsurancePayouts).toEqual(payouts);
    expect(info.lifeInsurancePayoutsUsed).toBe(1);
  });

  it('reads the Bobby Ray shipments with their used lines only', () => {
    const w = new BinaryWriter().i32(1);
    w.u8(1).u8(2).u8(0).zeros(1);
    for (let i = 0; i < MAX_PURCHASES; i++) {
      if (i === 0) w.u16(30).u8(2).u8(100).u16(4).u8(0).zeros(1);
      else if (i === 1) w.u16(31).u8(1).u8(60).u16(0).u8(1).zeros(1);
      else w.zeros(8);
    }
    w.u8(2).zeros(3).u32(35).u32(4).u8(1).zeros(7);
    expect(decodeShipments(w.toBytes())).toEqual([
      {
        active: true,
        destination: 2,
        speed: 0,
        lines: [
          { item: 30, count: 2, quality: 100, slot: 4, used: false },
          { item: 31, count: 1, quality: 60, slot: 0, used: true },
        ],
        weight: 35,
        orderDay: 4,
        displayedOnShipmentsPage: true,
      },
    ]);
  });

  it('reads history, files and email records in file order', () => {
    const history = new BinaryWriter()
      .u8(1)
      .u8(3)
      .u32(1500)
      .i16(-1)
      .i16(-1)
      .u8(0)
      .zeros(1)
      .u8(22)
      .u8(4)
      .u32(9000)
      .i16(13)
      .i16(2)
      .u8(0)
      .zeros(1);
    expect(decodeHistoryFile(history.toBytes())).toEqual([
      { code: 1, secondCode: 3, date: 1500, x: -1, y: -1, z: 0 },
      { code: 22, secondCode: 4, date: 9000, x: 13, y: 2, z: 0 },
    ]);
    const files = new BinaryWriter()
      .u8(0)
      .zeros(FILE_RECORD_BYTES - 2)
      .u8(1);
    expect(decodeFilesFile(files.toBytes())).toEqual([{ code: 0, read: true }]);
    const mail = new BinaryWriter().u32(1).u32(0).u16(19).u16(5).u8(4).zeros(3).u32(1500).zeros(4).i32(-7).u32(42).zeros(16).u8(1).zeros(3);
    expect(decodeEmails(mail.toBytes())).toEqual([
      { offset: 19, length: 5, sender: 4, date: 1500, firstData: -7, secondData: 42, read: true },
    ]);
  });
});

const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!ORIGINAL_DATA_DIR)('the laptop sections of the native savegames', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  for (const file of saveFiles) {
    it(`decodes ${file}`, async () => {
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(await data.vfs.read(SAVE_ENCRYPTION_PATH))));
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const save = parseSaveGame(bytes, table);
      const laptop = readSavedLaptop(bytes, save);
      const info = laptop.info;
      expect(info.currentBalance).toBe(save.laptop.currentBalance);
      expect(info.bobbyRayInventory).toHaveLength(info.inventoryListLength[0]);
      expect(info.bobbyRayUsedInventory).toHaveLength(info.inventoryListLength[1]);
      expect(info.bobbyRayInventory.every((s) => s.item > 0 && s.item < MAXITEMS)).toBe(true);
      expect(info.mercAccountStatus).toBeLessThanOrEqual(4);
      expect(info.bookmarks.every((b) => b >= 0 && b <= 6)).toBe(true);
      expect(new Set(info.bookmarks).size).toBe(info.bookmarks.length);
      expect(info.lifeInsurancePayouts.length).toBe(save.laptop.lifeInsurancePayouts);
      expect(laptop.emails.length).toBeGreaterThan(0);
      expect(laptop.history.length).toBeGreaterThan(0);
      expect(laptop.history.every((h) => h.code < HISTORY_CODES && h.date <= save.worldTime.totalMinutes)).toBe(true);
      expect(laptop.emails.every((m) => m.date <= save.worldTime.totalMinutes && m.length > 0)).toBe(true);
      expect(laptop.files.length).toBeGreaterThan(0);
      for (const s of laptop.shipments) {
        expect(s.lines.length).toBeLessThanOrEqual(MAX_PURCHASES);
        expect(s.orderDay).toBeLessThanOrEqual(save.worldTime.day);
      }
      expect(laptop.impSlotStates === null || laptop.impSlotStates.length === save.profiles.length).toBe(true);
      expect(laptop.mercArriveSector.x).toBeGreaterThanOrEqual(1);
      expect(laptop.mercArriveSector.y).toBeGreaterThanOrEqual(1);
    });
  }
});
