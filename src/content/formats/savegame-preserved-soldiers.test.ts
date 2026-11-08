import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { sectorId } from '../strategic/sector-ids.ts';
import { calcSoldierCreateCheckSum, DETAILED_PLACEMENT_BYTES, writeProfileDetailedPlacement } from './placement.ts';
import { decodePreservedSoldiersFile } from './savegame-preserved-soldiers.ts';

const C13 = { x: 13, y: 3, z: 0 };
const NAME_OFFSET = 888;
const NAME_CHARS = 10;
const LINUX_NAME_WIDENING = NAME_CHARS * 2;
const CIV_TEAM = 4;
const NO_PROFILE = 200;
const TIMESTAMP = 2995;

function civilian(insertionGridNo: number, life: number, name: string): Uint8Array {
  const raw = writeProfileDetailedPlacement({
    profile: NO_PROFILE,
    direction: 2,
    insertionGridNo,
    team: CIV_TEAM,
    attitude: 0,
    orders: 0,
    soldierClass: 0,
    civilianGroup: 3,
  });
  const v = new DataView(raw.buffer);
  v.setInt16(6, C13.x, true);
  v.setInt16(8, C13.y, true);
  v.setInt8(15, 4);
  for (let k = 18; k < 32; k++) v.setInt8(k, 30);
  v.setInt8(18, life + 5);
  v.setInt8(19, life);
  for (let i = 0; i < name.length; i++) v.setUint16(NAME_OFFSET + i * 2, name.charCodeAt(i), true);
  return raw;
}

function linuxLayout(windows: Uint8Array): Uint8Array {
  const name = new DataView(windows.buffer, windows.byteOffset + NAME_OFFSET, NAME_CHARS * 2);
  const wide = new BinaryWriter();
  for (let i = 0; i < NAME_CHARS; i++) wide.u32(name.getUint16(i * 2, true));
  const tail = windows.subarray(NAME_OFFSET + NAME_CHARS * 2);
  return Uint8Array.from([...windows.subarray(0, NAME_OFFSET), ...wide.toBytes(), ...tail]);
}

interface FileOptions {
  readonly sector?: { readonly x: number; readonly y: number; readonly z: number };
  readonly checksums?: readonly number[];
  readonly sectorIdByte?: number;
  readonly linux?: boolean;
  readonly trailing?: number;
}

function preservedFile(records: readonly Uint8Array[], options: FileOptions = {}): Uint8Array {
  const sector = options.sector ?? C13;
  const w = new BinaryWriter().i16(sector.y).u8(2).u8(0).u8(116).u8(1).u8(0).i16(sector.x).i32(records.length).u32(TIMESTAMP).u8(sector.z);
  records.forEach((windows, i) => {
    const raw = options.linux ? linuxLayout(windows) : windows;
    w.bytes(raw).u16(options.checksums?.[i] ?? calcSoldierCreateCheckSum(windows));
  });
  if (records.length > 0) w.u8(options.sectorIdByte ?? sectorId(sector));
  w.zeros(options.trailing ?? 0);
  return w.toBytes();
}

describe('the preserved soldiers temp file', () => {
  it('computes the anti-hack checksum of a placement as a u16 of its weighted fields (LoadSaveSoldierCreate.cc:12)', () => {
    const raw = new Uint8Array(DETAILED_PLACEMENT_BYTES);
    const v = new DataView(raw.buffer);
    v.setInt8(19, 30);
    v.setInt8(18, 40);
    v.setInt16(6, 13, true);
    v.setInt8(14, CIV_TEAM);
    v.setInt8(10, 2);
    v.setInt16(12, 12345, true);
    expect(calcSoldierCreateCheckSum(raw)).toBe(13031);
    const marksman = new Uint8Array(DETAILED_PLACEMENT_BYTES);
    new DataView(marksman.buffer).setInt8(23, 100);
    expect(calcSoldierCreateCheckSum(marksman)).toBe(64663);
  });

  it('reads the links, the save minute and every record of a file a sector exit wrote', () => {
    const file = decodePreservedSoldiersFile(preservedFile([civilian(13673, 38, 'CIVILIAN'), civilian(13029, 33, 'CIVILIAN')]), C13, false);
    expect(file.links).toEqual([
      { nodeId: 0, soldierId: 116 },
      { nodeId: 1, soldierId: 0 },
    ]);
    expect(file.timestamp).toBe(TIMESTAMP);
    expect(file.records.map((r) => [r.team, r.insertionGridNo, r.stats.life, r.stats.lifeMax, r.name, r.civilianGroup])).toEqual([
      [CIV_TEAM, 13673, 38, 43, 'CIVILIAN', 3],
      [CIV_TEAM, 13029, 33, 38, 'CIVILIAN', 3],
    ]);
  });

  it("takes a record in Stracciatella's Linux layout, its name four bytes a character, when the Windows checksum fails (LoadSaveSoldierCreate.cc:126)", () => {
    const windows = civilian(13673, 38, 'Pacos');
    const file = decodePreservedSoldiersFile(preservedFile([windows], { linux: true }), C13, false);
    expect(linuxLayout(windows)).toHaveLength(DETAILED_PLACEMENT_BYTES + LINUX_NAME_WIDENING);
    expect(file.records.map((r) => [r.name, r.civilianGroup, r.stats.life, r.insertionGridNo])).toEqual([['Pacos', 3, 38, 13673]]);
  });

  it('refuses a record whose checksum holds in neither layout, which the entry throws on (Enemy_Soldier_Save.cc:391)', () => {
    const raw = civilian(13673, 38, 'CIVILIAN');
    const bytes = preservedFile([raw], { checksums: [calcSoldierCreateCheckSum(raw) + 1], trailing: LINUX_NAME_WIDENING });
    expect(() => decodePreservedSoldiersFile(bytes, C13, false)).toThrow(FormatError);
  });

  it('reads only the links of a file written while saving, whose slot count is 0 and which ends before any sector id', () => {
    const file = decodePreservedSoldiersFile(preservedFile([]), C13, true);
    expect([file.links.length, file.records]).toEqual([2, []]);
  });

  it('checks the sector id after the records of an enemy file only: the civilian load reads it unchecked (Enemy_Soldier_Save.cc:255, :424)', () => {
    const bytes = preservedFile([civilian(13673, 38, 'CIVILIAN')], { sectorIdByte: 0 });
    expect(decodePreservedSoldiersFile(bytes, C13, false).records).toHaveLength(1);
    expect(() => decodePreservedSoldiersFile(bytes, C13, true)).toThrow(FormatError);
  });

  it('refuses a file whose sector is not the one it is filed under', () => {
    expect(() => decodePreservedSoldiersFile(preservedFile([], { sector: { ...C13, z: 1 } }), C13, false)).toThrow(FormatError);
  });
});
