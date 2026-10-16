// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LoadSaveSoldierCreate.cc ExtractSoldierCreateFromFile, InjectSoldierCreateIntoFile (Windows layout).
// @src See docs/06 §7.1.

import { FormatError } from '../binary/errors.ts';
import { decodeObject, OBJECT_RECORD_BYTES, type ObjectRecord } from './object.ts';

export const DETAILED_PLACEMENT_BYTES = 1040;
const INVENTORY_SLOTS = 19;
const PALETTE_BYTES = 30;
const PATROL_POINTS = 10;
const NAME_CHARS = 10;

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
  readonly hasKeys: boolean;
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

export function parseDetailedPlacement(raw: Uint8Array): DetailedPlacement {
  if (raw.length < DETAILED_PLACEMENT_BYTES) throw new FormatError(`detailed placement must be ${DETAILED_PLACEMENT_BYTES} bytes`);
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const i8 = (o: number) => v.getInt8(o);
  let name = '';
  for (let i = 0; i < NAME_CHARS; i++) {
    const c = v.getUint16(888 + i * 2, true);
    if (c === 0) break;
    name += String.fromCharCode(c);
  }
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
    name,
    soldierClass: raw[908] ?? 0,
    onRoof: raw[909] !== 0,
    civilianGroup: raw[917] ?? 0,
    scheduleId: raw[919] ?? 0,
    hasKeys: raw[922] !== 0,
  };
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
  raw[919] = spec.scheduleId ?? 0;
  return raw;
}
