// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LoadSaveSoldierCreate.cc ExtractSoldierCreateFromFile, InjectSoldierCreateIntoFile (Windows layout;
// @src the Linux layout's UTF-32 name and CalcSoldierCreateCheckSum, 2026-11-08).

import { u16 } from '../../core/int.ts';
import { FormatError } from '../binary/errors.ts';
import { decodeObject, OBJECT_RECORD_BYTES, type ObjectRecord } from './object.ts';

export const DETAILED_PLACEMENT_BYTES = 1040;
const DETAILED_PLACEMENT_BYTES_STRAC_LINUX = 1060;
const INVENTORY_SLOTS = 19;
const PALETTE_BYTES = 30;
const PATROL_POINTS = 10;
const NAME_CHARS = 10;
const NAME_OFFSET = 888;
const UTF16_BYTES = 2;
const UTF32_BYTES = 4;
const MAX_CODE_POINT = 0x10ffff;
const REPLACEMENT_CHARACTER = 0xfffd;
const SECTOR_X_OFFSET = 6;
const ON_ROOF_AFTER_NAME = 1;
const CIVILIAN_GROUP_AFTER_NAME = 9;
const SCHEDULE_ID_AFTER_NAME = 11;
const HAS_KEYS_AFTER_NAME = 14;

export interface DetailedStats {
  readonly lifeMax: number;
  readonly life: number;
  readonly agility: number;
  readonly dexterity: number;
  readonly experience: number;
  readonly marksmanship: number;
  readonly medical: number;
  readonly mechanical: number;
  readonly explosives: number;
  readonly leadership: number;
  readonly strength: number;
  readonly wisdom: number;
  readonly morale: number;
  readonly aiMorale: number;
}

export interface DetailedPlacement {
  readonly isStatic: boolean;
  readonly profile: number;
  readonly direction: number;
  readonly insertionGridNo: number;
  readonly team: number;
  readonly bodyType: number;
  readonly attitude: number;
  readonly orders: number;
  readonly stats: DetailedStats;
  readonly inventory: readonly ObjectRecord[];
  readonly palettes: { readonly hair: string; readonly pants: string; readonly vest: string; readonly skin: string };
  readonly patrolGrid: readonly number[];
  readonly patrolCount: number;
  readonly visible: boolean;
  readonly name: string;
  readonly soldierClass: number;
  readonly onRoof: boolean;
  readonly civilianGroup: number;
  readonly scheduleId: number;
  readonly hasKeys: number;
}

function ascii(bytes: Uint8Array, offset: number): string {
  let s = '';
  for (let i = 0; i < PALETTE_BYTES; i++) {
    const c = bytes[offset + i] ?? 0;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function nameCharBytes(stracLinux: boolean): number {
  return stracLinux ? UTF32_BYTES : UTF16_BYTES;
}

function afterName(stracLinux: boolean): number {
  return NAME_OFFSET + NAME_CHARS * nameCharBytes(stracLinux);
}

export function detailedPlacementBytes(stracLinux: boolean): number {
  return stracLinux ? DETAILED_PLACEMENT_BYTES_STRAC_LINUX : DETAILED_PLACEMENT_BYTES;
}

function placementName(v: DataView, stracLinux: boolean): string {
  const charBytes = nameCharBytes(stracLinux);
  const codes: number[] = [];
  for (let i = 0; i < NAME_CHARS; i++) {
    const at = NAME_OFFSET + i * charBytes;
    const c = stracLinux ? v.getUint32(at, true) : v.getUint16(at, true);
    if (c === 0) break;
    codes.push(c);
  }
  return stracLinux
    ? String.fromCodePoint(...codes.map((c) => (c > MAX_CODE_POINT ? REPLACEMENT_CHARACTER : c)))
    : String.fromCharCode(...codes);
}

export function parseDetailedPlacement(raw: Uint8Array, stracLinux = false): DetailedPlacement {
  const size = detailedPlacementBytes(stracLinux);
  if (raw.length < size) throw new FormatError(`detailed placement must be ${size} bytes`);
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const i8 = (o: number) => v.getInt8(o);
  const tail = afterName(stracLinux);
  return {
    isStatic: raw[0] !== 0,
    profile: raw[1] ?? 0,
    direction: i8(10),
    insertionGridNo: v.getInt16(12, true),
    team: i8(14),
    bodyType: i8(15),
    attitude: i8(16),
    orders: i8(17),
    stats: {
      lifeMax: i8(18),
      life: i8(19),
      agility: i8(20),
      dexterity: i8(21),
      experience: i8(22),
      marksmanship: i8(23),
      medical: i8(24),
      mechanical: i8(25),
      explosives: i8(26),
      leadership: i8(27),
      strength: i8(28),
      wisdom: i8(29),
      morale: i8(30),
      aiMorale: i8(31),
    },
    inventory: Array.from({ length: INVENTORY_SLOTS }, (_, k) => decodeObject(raw, 32 + k * OBJECT_RECORD_BYTES)),
    palettes: { hair: ascii(raw, 716), pants: ascii(raw, 746), vest: ascii(raw, 776), skin: ascii(raw, 806) },
    patrolGrid: Array.from({ length: PATROL_POINTS }, (_, k) => v.getInt16(866 + k * 2, true)),
    patrolCount: i8(886),
    visible: raw[887] !== 0,
    name: placementName(v, stracLinux),
    soldierClass: raw[tail] ?? 0,
    onRoof: raw[tail + ON_ROOF_AFTER_NAME] !== 0,
    civilianGroup: raw[tail + CIVILIAN_GROUP_AFTER_NAME] ?? 0,
    scheduleId: raw[tail + SCHEDULE_ID_AFTER_NAME] ?? 0,
    hasKeys: raw[tail + HAS_KEYS_AFTER_NAME] ?? 0,
  };
}

export function calcSoldierCreateCheckSum(raw: Uint8Array, stracLinux = false): number {
  const p = parseDetailedPlacement(raw, stracLinux);
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const s = p.stats;
  const sectorX = v.getInt16(SECTOR_X_OFFSET, true);
  const onRoof = raw[afterName(stracLinux) + ON_ROOF_AFTER_NAME] ?? 0;
  return u16(
    s.life * 7 +
      s.lifeMax * 8 -
      s.agility * 2 +
      s.dexterity * 1 +
      s.experience * 5 -
      s.marksmanship * 9 +
      s.medical * 10 +
      s.mechanical * 3 +
      s.explosives * 4 +
      s.leadership * 5 +
      s.strength * 7 +
      s.wisdom * 11 +
      s.morale * 7 +
      s.aiMorale * 3 -
      p.bodyType * 7 +
      4 * 6 +
      sectorX * 7 -
      p.soldierClass * 4 +
      p.team * 7 +
      p.direction * 5 +
      onRoof * 17 +
      p.insertionGridNo * 1 +
      3,
  );
}

const UNSET_STAT = -1;
const FIRST_STAT_OFFSET = 18;
const STAT_BYTES = 14;

export interface ProfilePlacementSpec {
  readonly profile: number;
  readonly direction: number;
  readonly insertionGridNo: number;
  readonly team: number;
  readonly attitude: number;
  readonly orders: number;
  readonly soldierClass: number;
  readonly scheduleId?: number;
  readonly civilianGroup?: number;
}

export function writeProfileDetailedPlacement(spec: ProfilePlacementSpec): Uint8Array {
  const raw = new Uint8Array(DETAILED_PLACEMENT_BYTES);
  const v = new DataView(raw.buffer);
  raw[0] = 1;
  raw[1] = spec.profile;
  v.setInt8(10, spec.direction);
  v.setInt16(12, spec.insertionGridNo, true);
  v.setInt8(14, spec.team);
  v.setInt8(15, UNSET_STAT);
  v.setInt8(16, spec.attitude);
  v.setInt8(17, spec.orders);
  for (let k = 0; k < STAT_BYTES; k++) v.setInt8(FIRST_STAT_OFFSET + k, UNSET_STAT);
  for (let k = 0; k < PATROL_POINTS; k++) v.setInt16(866 + k * 2, spec.insertionGridNo, true);
  raw[908] = spec.soldierClass;
  raw[917] = spec.civilianGroup ?? 0;
  raw[919] = spec.scheduleId ?? 0;
  return raw;
}
