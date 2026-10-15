// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src rust/stracciatella/src/file_formats/stci/etrle.rs

const TRANSPARENT_INDEX = 0;
const END_OF_ROW = 0x00;
const TRANSPARENT_RUN_FLAG = 0x80;
const RUN_LENGTH_MASK = 0x7f;
const MAX_RUN_LENGTH = 127;

export interface EtrleDecodeResult {
  readonly pixels: Uint8Array;
  readonly anomalies: number;
}

export function etrleDecode(src: Uint8Array, width: number, height: number): EtrleDecodeResult {
  const pixelCount = width * height;
  const pixels = new Uint8Array(pixelCount);
  if (pixelCount === 0) {
    const hasPayload = src.some((b) => b !== END_OF_ROW);
    return { pixels, anomalies: hasPayload ? 1 : 0 };
  }
  let anomalies = 0;
  let cursor = 0;
  let pos = 0;
  while (pos < src.length) {
    const control = src[pos++] as number;
    if (control === END_OF_ROW) {
      const column = cursor % width;
      if (column !== 0) {
        anomalies++;
        cursor += width - column;
      }
      continue;
    }
    const runLength = control & RUN_LENGTH_MASK;
    if (control & TRANSPARENT_RUN_FLAG) {
      cursor += runLength;
    } else {
      const copied = Math.max(0, Math.min(runLength, pixelCount - cursor, src.length - pos));
      pixels.set(src.subarray(pos, pos + copied), cursor);
      cursor += runLength;
      pos += runLength;
    }
  }
  if (cursor !== pixelCount) anomalies++;
  return { pixels, anomalies };
}

export function etrleEncode(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * width, (y + 1) * width);
    let x = 0;
    while (x < width) {
      const transparent = row[x] === TRANSPARENT_INDEX;
      let runLength = 0;
      while (x + runLength < width && runLength < MAX_RUN_LENGTH && (row[x + runLength] === TRANSPARENT_INDEX) === transparent) runLength++;
      if (transparent) {
        out.push(TRANSPARENT_RUN_FLAG | runLength);
      } else {
        out.push(runLength);
        out.push(...row.subarray(x, x + runLength));
      }
      x += runLength;
    }
    out.push(END_OF_ROW);
  }
  return Uint8Array.from(out);
}
