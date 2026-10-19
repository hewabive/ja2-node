// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Utilities.cc CreateSGPPaletteFromCOLFile (an 8-byte header, then 256 RGB triples)

import { FormatError } from '../binary/errors.ts';

const HEADER_BYTES = 8;
const PALETTE_BYTES = 256 * 3;

export function parseColPalette(bytes: Uint8Array): Uint8Array {
  if (bytes.length < HEADER_BYTES + PALETTE_BYTES) throw new FormatError('COL palette too short');
  return bytes.slice(HEADER_BYTES, HEADER_BYTES + PALETTE_BYTES);
}
