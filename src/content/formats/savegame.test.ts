import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SAVE_SECTOR, SYNTHETIC_SAVE_VERSION, writeSyntheticSaveHeader } from '../../../tests/support/native-save.ts';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { FormatError } from '../binary/errors.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { PROFILE_RECORD_BYTES } from './prof.ts';
import { LAPTOP_INFO_LAYOUT, loadedWorldSector, parseSaveGame } from './savegame.ts';
import {
  encryptionSetIndex,
  encryptSaveRecord,
  parseSaveEncryptionTable,
  parseSaveHeader,
  SAVE_HEADER_BYTES,
  SAVE_HEADER_BYTES_STRAC_LINUX,
  type SaveGameHeader,
} from './savegame-header.ts';
import { type Layout, layoutBytes, layoutOffsets } from './savegame-layout.ts';
import { decodeSavedProfile, PROFILE_RECORD_BYTES_STRAC_LINUX, profileChecksum } from './savegame-profile.ts';
import {
  decodeSoldierRecord,
  SOLDIER_LAYOUT,
  SOLDIER_RECORD_BYTES,
  SOLDIER_RECORD_BYTES_STRAC_LINUX,
  soldierChecksum,
} from './savegame-soldier.ts';
import { GENERAL_INFO_LAYOUT, INCOMBAT, TACTICAL_STATUS_LAYOUT, TEAM_TURNS_LAYOUT, TOTAL_SOLDIERS } from './savegame-tactical.ts';
import { decodeWorldItemsFile, WORLD_ITEM_BYTES } from './savegame-temp-files.ts';

const encryption = parseSaveEncryptionTable(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/save-encryption.json'), 'utf8')),
);
const VERSION = SYNTHETIC_SAVE_VERSION;
const SECTOR = SYNTHETIC_SAVE_SECTOR;
const SECTOR_INDEX = (SECTOR.y - 1) * 16 + SECTOR.x - 1;
const ITEM_FLAG = 0x10000000;
const DOOR_TABLE_FLAG = 0x80000000;
const DOOR_STATUS_FLAG = 0x02000000;
const SOLDIER_SLOT = 3;
const PROFILE = 7;
const OVERFLOWING_BALANCE = 500_000_000;
const WORLD_SECONDS = 2 * 86400 + 3 * 3600 + 4 * 60 + 5;

type FieldValue = number | string;

function fill(layout: Layout, linux: boolean, values: Readonly<Record<string, FieldValue>>): Uint8Array {
  const bytes = new Uint8Array(layoutBytes(layout, linux));
  const v = new DataView(bytes.buffer);
  const offsets = layoutOffsets(layout, linux);
  for (const [name, value] of Object.entries(values)) {
    const entry = layout.find((e) => e.name === name);
    const at = offsets.get(name);
    if (!entry || at === undefined) throw new Error(`no field ${name}`);
    if (entry.kind === 'text') {
      for (const [i, ch] of [...String(value)].entries()) {
        if (!entry.wide) v.setUint8(at + i, ch.charCodeAt(0));
        else if (linux) v.setUint32(at + i * 4, ch.charCodeAt(0), true);
        else v.setUint16(at + i * 2, ch.charCodeAt(0), true);
      }
      continue;
    }
    if (entry.kind !== 'scalar') throw new Error(`cannot fill ${name}`);
    const n = Number(value);
    if (entry.type === 'u8' || entry.type === 'bool') v.setUint8(at, n);
    else if (entry.type === 'i8') v.setInt8(at, n);
    else if (entry.type === 'u16') v.setUint16(at, n, true);
    else if (entry.type === 'i16') v.setInt16(at, n, true);
    else if (entry.type === 'u32') v.setUint32(at, n, true);
    else if (entry.type === 'i32') v.setInt32(at, n, true);
    else v.setFloat32(at, n, true);
  }
  return bytes;
}

function writeHeader(w: BinaryWriter, linux: boolean, balance: number): void {
  writeSyntheticSaveHeader(w, linux, balance);
}

function headerOf(linux: boolean, balance: number): SaveGameHeader {
  const w = new BinaryWriter();
  writeHeader(w, linux, balance);
  return parseSaveHeader(w.toBytes()).header;
}

function profileRecord(id: number, linux: boolean): Uint8Array {
  const plain = new Uint8Array(PROFILE_RECORD_BYTES);
  const v = new DataView(plain.buffer);
  const nickname = id === PROFILE ? 'Tester' : '';
  for (const [i, ch] of [...nickname].entries()) v.setUint16(60 + i * 2, ch.charCodeAt(0), true);
  v.setInt8(334, 70 + (id % 10));
  v.setInt8(297, 80);
  v.setInt8(405, 60);
  v.setInt8(352, 3);
  v.setUint16(310, id === PROFILE ? 12 : 0, true);
  v.setUint16(416, id === PROFILE ? 5 : 0, true);
  v.setUint8(377, id === PROFILE ? 1 : 0);
  v.setUint32(696, profileChecksum(decodeSavedProfile(id, plain, false)), true);
  if (!linux) return plain;
  const out = new Uint8Array(PROFILE_RECORD_BYTES_STRAC_LINUX);
  const o = new DataView(out.buffer);
  for (let i = 0; i < 40; i++) o.setUint32(i * 4, v.getUint16(i * 2, true), true);
  out.set(plain.subarray(80), 160);
  return out;
}

function soldierRecord(linux: boolean): Uint8Array {
  const plain = fill(SOLDIER_LAYOUT, linux, {
    ubID: SOLDIER_SLOT,
    ubBodyType: 1,
    bActionPoints: 18,
    bInitialActionPoints: 24,
    name: 'Tester',
    bActive: 1,
    bTeam: 0,
    bInSector: 1,
    dXPos: 675,
    dYPos: 805,
    sGridNo: 12867,
    bDirection: 2,
    usAnimState: 27,
    bLife: 55,
    bLifeMax: 80,
    bBreath: 66,
    bAgility: 60,
    bExpLevel: 3,
    bLevel: 1,
    ubProfile: PROFILE,
    bAlertStatus: 3,
    bOrders: 1,
    bAttitude: 2,
    sSectorX: SECTOR.x,
    sSectorY: SECTOR.y,
    HeadPal: 'BROWNHEAD',
  });
  const v = new DataView(plain.buffer);
  const inv = layoutOffsets(SOLDIER_LAYOUT, linux).get('inv') ?? 0;
  v.setUint16(inv + 5 * 36, 5, true);
  v.setUint8(inv + 5 * 36 + 2, 1);
  v.setInt8(inv + 5 * 36 + 4, 90);
  v.setInt8((layoutOffsets(SOLDIER_LAYOUT, linux).get('bOppList') ?? 0) + 23, 1);
  const checksum = soldierChecksum(decodeSoldierRecord(plain, VERSION, linux));
  v.setUint32(layoutOffsets(SOLDIER_LAYOUT, linux).get('checksum') ?? 0, checksum, true);
  return plain;
}

function worldItemsFile(): Uint8Array {
  const bytes = new Uint8Array(4 + WORLD_ITEM_BYTES);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 1, true);
  v.setUint8(4, 1);
  v.setInt16(6, 12693, true);
  v.setUint16(12, 219, true);
  v.setUint8(14, 1);
  v.setInt8(16, 100);
  v.setUint16(48, 1, true);
  v.setInt8(51, 1);
  return bytes;
}

interface BuildOptions {
  readonly linux?: boolean;
  readonly trailing?: number;
  readonly corruptSoldier?: boolean;
  readonly german?: boolean;
  readonly balance?: number;
}

function buildSave({
  linux = false,
  trailing = 0,
  corruptSoldier = false,
  german = false,
  balance = 1234,
}: BuildOptions = {}): Uint8Array<ArrayBuffer> {
  const header = headerOf(linux, balance);
  const key = encryption.sets[encryptionSetIndex(header, encryption.baseSets, german)] ?? new Uint8Array(49);
  const w = new BinaryWriter(1 << 20);
  writeHeader(w, linux, balance);
  w.bytes(
    fill(TACTICAL_STATUS_LAYOUT, linux, {
      uiFlags: INCOMBAT,
      'Team0.bLastID': 19,
      'Team0.bHuman': 1,
      'Team1.bFirstID': 20,
      'Team1.bLastID': 51,
      'Team1.bSide': 1,
      ubCurrentTeam: 1,
      fInterruptOccurred: 1,
    }),
  );
  w.i16(SECTOR.x).i16(SECTOR.y).u8(SECTOR.z);
  w.i32(1).u8(1).u8(0).u8(0).u8(0).u32(WORLD_SECONDS).u32(1).u8(12).u32(3).u32(2).u8(12).u32(WORLD_SECONDS);
  w.u8(0).u8(0).u8(0).u8(0).u32(WORLD_SECONDS).u32(0).zeros(20);
  w.u32(1)
    .zeros(4)
    .u32(WORLD_SECONDS + 60)
    .u32(9)
    .u32(60)
    .u8(4)
    .u8(51)
    .u8(0)
    .zeros(9);
  w.bytes(fill(LAPTOP_INFO_LAYOUT, false, { iCurrentBalance: 1234 }));
  for (let id = 0; id < 170; id++) w.bytes(encryptSaveRecord(profileRecord(id, linux), key));
  for (let slot = 0; slot < TOTAL_SOLDIERS; slot++) {
    if (slot !== SOLDIER_SLOT) {
      w.u8(0);
      continue;
    }
    const record = soldierRecord(linux);
    if (corruptSoldier) record[layoutOffsets(SOLDIER_LAYOUT, linux).get('bLife') ?? 0] = 1;
    w.u8(1).bytes(encryptSaveRecord(record, key));
    w.u32(1).u32(SECTOR_INDEX).zeros(16);
    w.u8(0);
  }
  w.u32(0).u32(0).u32(0);
  w.u32(0);
  w.zeros(324 * 41);
  for (let i = 0; i < 256; i++) w.u32(i === SECTOR_INDEX ? ITEM_FLAG | DOOR_TABLE_FLAG | DOOR_STATUS_FLAG : 0).zeros(112);
  w.zeros(324).u8(0);
  w.u32(0);
  for (let i = 0; i < 120; i++)
    w.i16(i === 0 ? SOLDIER_SLOT : -1)
      .u8(0)
      .u8(0)
      .zeros(8);
  w.zeros(20);
  w.u32(1)
    .u8(0)
    .u8(1)
    .u8(0)
    .u8(1)
    .u8(30)
    .u8(1)
    .u8(SECTOR.x)
    .u8(SECTOR.y)
    .u8(0)
    .zeros(84 - 9);
  w.u32(1).u32(PROFILE).u32(0).zeros(32);
  const items = worldItemsFile();
  w.u32(items.length).bytes(items);
  w.u32(15).u8(1).i16(12858).u8(1).u8(0).u8(0).u8(14).u8(0).u8(0).u8(0).zeros(5);
  w.u32(5).u8(1).i16(17677).u8(4).u8(0);
  w.zeros(30 + 500);
  w.zeros(6 * 156 + 3 * 156 * 156 + 2 * 6 * 156 + 12);
  w.zeros(3);
  for (let i = 0; i < 256; i++) w.u32(0);
  w.zeros(170 + 20);
  w.zeros(64 * 8);
  w.u32(0);
  w.u32(42);
  for (let i = 0; i < 256; i++) w.u32(i * 7);
  w.zeros(19 * 20 + 19 * 351 * 16);
  w.bytes(fill(GENERAL_INFO_LAYOUT, false, { sel: SOLDIER_SLOT, gsRenderCenterX: 455, fSciFi: 1, ubDifficultyLevel: 2 }));
  w.zeros(6 * 44 + 13 * 26);
  w.u8(0).u32(0).u32(0).zeros(132);
  w.zeros(1).u8(SOLDIER_SLOT).zeros(146).u8(1).zeros(3).u8(156).zeros(2).u8(1).u8(SOLDIER_SLOT).zeros(17);
  w.zeros(4 + 40 * 12).u32(0);
  w.zeros(17 + 192);
  w.zeros(4)
    .i32(2)
    .i32(1)
    .zeros(35 + 97 + 1200 + 1000 + 1400 + 1 + 2);
  w.zeros(156 * 3 * 5 + 44 + 100 + 170 + 136);
  w.u8(0)
    .zeros(10 + 81 + 20 + 80)
    .i32(0);
  w.zeros(trailing);
  return w.toBytes();
}

describe('savegame record layouts', () => {
  it('match the on-disk sizes of the original structures', () => {
    expect([SOLDIER_RECORD_BYTES, SOLDIER_RECORD_BYTES_STRAC_LINUX]).toEqual([2328, 2352]);
    expect([layoutBytes(TACTICAL_STATUS_LAYOUT, false), layoutBytes(TACTICAL_STATUS_LAYOUT, true)]).toEqual([316, 360]);
    expect(layoutBytes(LAPTOP_INFO_LAYOUT, false)).toBe(7440);
    expect(layoutBytes(GENERAL_INFO_LAYOUT, false)).toBe(1024);
    expect(layoutBytes(TEAM_TURNS_LAYOUT, false)).toBe(174);
  });
});

describe('the loaded world of a native save (SaveLoadGame.cc LoadSavedGame)', () => {
  it('is the saved world sector only when the header says a world was loaded and the sector is one', () => {
    const noSector = { x: 0, y: 0, z: -1 };
    expect(loadedWorldSector({ header: { worldLoaded: false }, tactical: { worldSector: noSector } })).toBeNull();
    expect(loadedWorldSector({ header: { worldLoaded: false }, tactical: { worldSector: SECTOR } })).toBeNull();
    expect(loadedWorldSector({ header: { worldLoaded: true }, tactical: { worldSector: noSector } })).toBeNull();
    expect(loadedWorldSector({ header: { worldLoaded: true }, tactical: { worldSector: SECTOR } })).toEqual(SECTOR);
  });
});

describe('parseSaveGame on a synthetic save', () => {
  for (const linux of [false, true]) {
    it(`reads every section of a ${linux ? 'Strac Linux' : 'Windows'} layout save to the end`, () => {
      const bytes = buildSave({ linux });
      const save = parseSaveGame(bytes, encryption);
      expect(save.stracLinuxFormat).toBe(linux);
      expect(save.bytesConsumed).toBe(bytes.length);
      expect(save.sections[0]).toEqual({ name: 'header', offset: 0, size: linux ? SAVE_HEADER_BYTES_STRAC_LINUX : SAVE_HEADER_BYTES });
      expect(save.header).toMatchObject({
        version: VERSION,
        description: 'Synthetic',
        day: 2,
        hour: 3,
        minute: 4,
        sector: SECTOR,
        currentBalance: 1234,
      });
      expect(save.tactical).toMatchObject({ inCombat: true, currentTeam: 1, interruptOccurred: true, worldSector: SECTOR });
      expect(save.tactical.teams[1]).toMatchObject({ firstId: 20, lastId: 51, side: 1 });
      expect(save.worldTime).toMatchObject({ totalSeconds: WORLD_SECONDS, day: 2, hour: 3, minute: 4 });
      expect(save.laptop.currentBalance).toBe(1234);
      expect(save.profiles).toHaveLength(170);
      expect(save.profiles[PROFILE]).toMatchObject({ nickname: 'Tester', kills: 12, life: 77, lifeMax: 80 });
      expect(save.soldiers).toHaveLength(1);
      const entry = save.soldiers[0];
      expect(entry?.mercPath).toEqual([SECTOR_INDEX]);
      expect(entry?.keyRing).toBeNull();
      expect(entry?.soldier).toMatchObject({
        id: SOLDIER_SLOT,
        name: 'Tester',
        profile: PROFILE,
        gridNo: 12867,
        level: 1,
        direction: 2,
        animState: 27,
        actionPoints: 18,
        xPos: 675,
        yPos: 805,
        inSector: true,
        stats: { life: 55, lifeMax: 80, breath: 66, agility: 60, expLevel: 3 },
        ai: { alertStatus: 3, orders: 1, attitude: 2 },
        palettes: { head: 'BROWNHEAD' },
      });
      expect(entry?.soldier.inventory[5]).toMatchObject({ item: 5, count: 1, gunStatus: 90 });
      expect(entry?.soldier.oppList[23]).toBe(1);
      expect(save.squads[0]).toEqual([SOLDIER_SLOT]);
      expect(save.groups).toEqual([expect.objectContaining({ id: 30, player: true, size: 1, playerProfiles: [PROFILE] })]);
      expect(save.currentSector.worldItems).toEqual([expect.objectContaining({ exists: true, gridNo: 12693, flags: 1, visible: 1 })]);
      expect(save.currentSector.worldItems?.[0]?.object).toMatchObject({ item: 219, count: 1 });
      expect(save.currentSector.doors).toEqual([expect.objectContaining({ gridNo: 12858, locked: true, lockId: 14 })]);
      expect(save.currentSector.doorStatus).toEqual([{ gridNo: 17677, flags: 4 }]);
      expect(save.preRandom.index).toBe(42);
      expect(save.preRandom.numbers[255]).toBe(255 * 7);
      expect(save.generalInfo).toMatchObject({
        selectedSoldier: SOLDIER_SLOT,
        renderCenterX: 455,
        gameOptions: { sciFi: true, difficulty: 2 },
      });
      expect(save.teamTurns).toEqual({
        outOfTurnOrder: [SOLDIER_SLOT],
        whoThrewRock: 156,
        hiddenInterrupt: true,
        lastInterruptedGuy: SOLDIER_SLOT,
      });
      expect(save.gameStates).toBeNull();
    });
  }

  it('falls back to the German encryption set when the profile checksum demands it', () => {
    const plain = parseSaveGame(buildSave({ balance: OVERFLOWING_BALANCE }), encryption);
    const german = parseSaveGame(buildSave({ balance: OVERFLOWING_BALANCE, german: true }), encryption);
    expect(plain.germanEncryption).toBe(false);
    expect(german.germanEncryption).toBe(true);
    expect(german.encryptionSet).not.toBe(plain.encryptionSet);
    expect(german.soldiers[0]?.soldier.name).toBe('Tester');
  });

  it('rejects trailing bytes, truncation and a broken soldier checksum', () => {
    expect(() => parseSaveGame(buildSave({ trailing: 1 }), encryption)).toThrow(/unparsed/);
    expect(() => parseSaveGame(buildSave().subarray(0, 300000), encryption)).toThrow(FormatError);
    expect(() => parseSaveGame(buildSave({ corruptSoldier: true }), encryption)).toThrow(/checksum/);
  });

  it('decodes an empty item temp file and rejects a short one', () => {
    expect(decodeWorldItemsFile(new Uint8Array([0, 0, 0, 0]))).toEqual([]);
    expect(() => decodeWorldItemsFile(new Uint8Array([1, 0, 0, 0]))).toThrow(FormatError);
  });
});

const dataDir = ORIGINAL_DATA_DIR;
const savesDir = join(dirname(dataDir), 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!ORIGINAL_DATA_DIR)('native savegames next to the original data', () => {
  it('finds saves', () => {
    expect(saveFiles.length).toBeGreaterThan(0);
  });

  for (const file of saveFiles) {
    it(`parses ${file} to the end with plausible values`, () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const save = parseSaveGame(bytes, encryption);
      expect(save.bytesConsumed).toBe(bytes.length);
      expect(save.tactical.worldSector).toEqual(save.header.sector);
      expect([save.worldTime.day, save.worldTime.hour, save.worldTime.minute]).toEqual([
        save.header.day,
        save.header.hour,
        save.header.minute,
      ]);
      expect(save.laptop.currentBalance).toBe(save.header.currentBalance);
      expect(save.preRandom.index).toBeGreaterThanOrEqual(0);
      expect(save.preRandom.index).toBeLessThan(256);
      expect(save.preRandom.numbers).toHaveLength(256);
      expect(save.profiles).toHaveLength(170);
      const mercs = save.soldiers.map((e) => e.soldier).filter((s) => s.team === 0);
      expect(mercs).toHaveLength(save.header.mercsOnPlayerTeam);
      for (const s of save.soldiers.map((e) => e.soldier)) {
        const team = save.tactical.teams[s.team];
        expect(s.id).toBeGreaterThanOrEqual(team?.firstId ?? -1);
        expect(s.id).toBeLessThanOrEqual(team?.lastId ?? -1);
      }
      for (const s of mercs) {
        expect(s.profile).toBeLessThan(170);
        expect(s.name).toBe(save.profiles[s.profile]?.nickname);
        expect(s.gridNo).toBeGreaterThanOrEqual(0);
        expect(s.gridNo).toBeLessThan(25600);
        expect(s.sector).toEqual(save.header.sector);
        expect(s.stats.life).toBeGreaterThan(0);
        expect(s.stats.life).toBeLessThanOrEqual(s.stats.lifeMax);
      }
      expect(save.currentSector.worldItems).not.toBeNull();
      for (const item of save.currentSector.worldItems ?? []) if (item.exists) expect(item.gridNo).toBeLessThan(25600);
    });
  }
});
