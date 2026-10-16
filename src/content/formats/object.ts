// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Item_Types.h OBJECTTYPE (36 bytes, shared by map items and detailed placements)

export const OBJECT_RECORD_BYTES = 36;
const KEY_ID_OFFSET = 10;

export interface ObjectRecord {
  readonly item: number;
  readonly count: number;
  readonly status: readonly number[];
  readonly gunStatus: number;
  readonly gunAmmoType: number;
  readonly gunShotsLeft: number;
  readonly gunAmmoItem: number;
  readonly gunAmmoStatus: number;
  readonly money: number;
  readonly attachments: readonly { readonly item: number; readonly status: number }[];
  readonly flags: number;
  readonly trap: number;
  readonly imprintId: number;
  readonly keyId: number;
}

export function decodeObject(bytes: Uint8Array, offset: number): ObjectRecord {
  const v = new DataView(bytes.buffer, bytes.byteOffset + offset, OBJECT_RECORD_BYTES);
  return {
    item: v.getUint16(0, true),
    count: v.getUint8(2),
    status: Array.from({ length: 8 }, (_, k) => v.getInt8(4 + k)),
    gunStatus: v.getInt8(4),
    gunAmmoType: v.getUint8(5),
    gunShotsLeft: v.getUint8(6),
    gunAmmoItem: v.getUint16(8, true),
    gunAmmoStatus: v.getInt8(10),
    money: v.getUint32(8, true),
    attachments: Array.from({ length: 4 }, (_, k) => ({ item: v.getUint16(16 + k * 2, true), status: v.getInt8(24 + k) })),
    flags: v.getUint8(28),
    trap: v.getInt8(30),
    imprintId: v.getUint8(31),
    keyId: v.getUint8(KEY_ID_OFFSET),
  };
}
