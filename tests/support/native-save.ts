import { BinaryWriter } from '../../src/content/binary/writer.ts';

export const SYNTHETIC_SAVE_VERSION = 99;
export const SYNTHETIC_SAVE_SECTOR = { x: 13, y: 4, z: 0 } as const;
export const SYNTHETIC_SAVE_DESCRIPTION = 'Synthetic';
export const SYNTHETIC_SAVE_BALANCE = 4321;

export function writeWideString(w: BinaryWriter, s: string, chars: number, linux: boolean): void {
  for (let i = 0; i < chars; i++) {
    const c = s.charCodeAt(i) || 0;
    if (linux) w.u32(i < s.length ? c : 0);
    else w.u16(i < s.length ? c : 0);
  }
}

export function writeSyntheticSaveHeader(w: BinaryWriter, linux: boolean, balance: number, description = SYNTHETIC_SAVE_DESCRIPTION): void {
  const s = SYNTHETIC_SAVE_SECTOR;
  w.u32(SYNTHETIC_SAVE_VERSION).fixedString(16, 'Build 04.12.02');
  writeWideString(w, description, 128, linux);
  w.zeros(4).u32(2).u8(3).u8(4).i16(s.x).i16(s.y).u8(s.z).u8(1).i32(balance).u32(5).u8(0).u8(1).u8(12);
  w.u8(0).u8(1).u8(2).u8(0).u8(0).zeros(7).zeros(1).u32(14).zeros(112);
}

export function syntheticSaveHeaderBytes(description = SYNTHETIC_SAVE_DESCRIPTION, balance = SYNTHETIC_SAVE_BALANCE): Uint8Array {
  const w = new BinaryWriter();
  writeSyntheticSaveHeader(w, false, balance, description);
  return w.toBytes();
}
