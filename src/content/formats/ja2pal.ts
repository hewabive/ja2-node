// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc LoadPaletteData

import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';

export const SOLDIER_PALETTES_PATH = 'binarydata/ja2pal.dat';
const ID_BYTES = 30;

export interface PaletteSubRange {
  readonly start: number;
  readonly end: number;
  readonly replacementCount: number;
}

export interface PaletteReplacement {
  readonly subRange: number;
  readonly id: string;
  readonly rgb: Uint8Array;
}

export interface SoldierPalettes {
  readonly subRanges: readonly PaletteSubRange[];
  readonly replacements: readonly PaletteReplacement[];
}

export function parseSoldierPalettes(bytes: Uint8Array): SoldierPalettes {
  const r = new BinaryReader(bytes);
  const rangeCount = r.u32();
  const counts = Array.from({ length: rangeCount }, () => r.u8());
  const subRanges = counts.map((replacementCount) => ({ start: r.u8(), end: r.u8(), replacementCount }));
  const replacementCount = r.u32();
  const replacements: PaletteReplacement[] = [];
  for (let i = 0; i < replacementCount; i++) {
    const subRange = r.u8();
    const id = r.fixedString(ID_BYTES);
    const size = r.u8();
    replacements.push({ subRange, id, rgb: r.bytesView(size * 3).slice() });
  }
  return { subRanges, replacements };
}

export function writeSoldierPalettes(p: SoldierPalettes): Uint8Array {
  const w = new BinaryWriter().u32(p.subRanges.length);
  for (const s of p.subRanges) w.u8(s.replacementCount);
  for (const s of p.subRanges) w.u8(s.start).u8(s.end);
  w.u32(p.replacements.length);
  for (const rep of p.replacements)
    w.u8(rep.subRange)
      .fixedString(ID_BYTES, rep.id)
      .u8(rep.rgb.length / 3)
      .bytes(rep.rgb);
  return w.toBytes();
}
