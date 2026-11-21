// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightAddTile, LightSubtractTile (every struct node of a tile a light step
// @src reaches takes the step's light, never a FIRSTCLIFFHANG node).

import type { TileElement } from '../../content/world/tile-database.ts';
import { type TileTables, typeIndex } from '../../content/world/tile-tables.ts';
import { ShadeChannel, shadeKey } from './instances.ts';

export function structureShadeChannels(tiles: readonly TileElement[], tables: TileTables): Uint8Array {
  const cliffHang = typeIndex(tables, 'FIRSTCLIFFHANG');
  return Uint8Array.from(tiles, (te) => (te?.type === cliffHang ? ShadeChannel.NATURAL : ShadeChannel.STRUCT));
}

export function structureShadeChannel(shades: Uint8Array, tile: number): ShadeChannel {
  return (shades[tile] ?? ShadeChannel.STRUCT) as ShadeChannel;
}

export function structureShadeKey(shades: Uint8Array, tile: number, g: number): number {
  return shadeKey(structureShadeChannel(shades, tile), g);
}
