// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightAddTile, LightSubtractTile (the struct nodes a light step reaches: an
// @src oriented block by its base structure's wall orientation, a node without structure data whose type lies between
// @src FIRSTWALLDECAL and EIGTHWALLDECAL as a wall decal, never a FIRSTCLIFFHANG node); Structure.cc
// @src InternalAddStructureToWorld (a node's structure data is its base structure).

import type { StructureDef } from '../../content/formats/jsd.ts';
import { has, instanceFlags, instanceWallOrientation, ORIENT_LEFT, ORIENT_RIGHT, StructureFlags } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { type TileTables, typeIndex } from '../../content/world/tile-tables.ts';
import { ShadeChannel, shadeKey } from './instances.ts';

const ORIENTED_BLOCK = StructureFlags.WALLSTUFF | StructureFlags.ANYDOOR;

interface StructureTypes {
  readonly cliffHang: number;
  readonly firstDecal: number;
  readonly lastDecal: number;
}

function wallChannel(orientation: number): ShadeChannel {
  const left = (orientation & ORIENT_LEFT) !== 0;
  const right = (orientation & ORIENT_RIGHT) !== 0;
  if (left && right) return ShadeChannel.CORNER_WALL;
  if (left) return ShadeChannel.LEFT_WALL;
  if (right) return ShadeChannel.RIGHT_WALL;
  return ShadeChannel.BARE_WALL;
}

function structureDataChannel(def: StructureDef): ShadeChannel {
  const base = def.tiles[0];
  if (!base) return ShadeChannel.LAND;
  const flags = instanceFlags(def, base);
  return has(flags, ORIENTED_BLOCK) ? wallChannel(instanceWallOrientation(def, flags)) : ShadeChannel.LAND;
}

function channelOfNode(te: TileElement | undefined, types: StructureTypes): ShadeChannel {
  if (!te) return ShadeChannel.LAND;
  if (te.type === types.cliffHang) return ShadeChannel.NATURAL;
  if (te.structure) return structureDataChannel(te.structure);
  return te.type >= types.firstDecal && te.type <= types.lastDecal ? ShadeChannel.DECAL : ShadeChannel.LAND;
}

export function structureShadeChannels(tiles: readonly TileElement[], tables: TileTables): Uint8Array {
  const types: StructureTypes = {
    cliffHang: typeIndex(tables, 'FIRSTCLIFFHANG'),
    firstDecal: typeIndex(tables, 'FIRSTWALLDECAL'),
    lastDecal: typeIndex(tables, 'EIGTHWALLDECAL'),
  };
  return Uint8Array.from(tiles, (te) => channelOfNode(te, types));
}

export function structureShadeChannel(shades: Uint8Array, tile: number): ShadeChannel {
  return (shades[tile] ?? ShadeChannel.LAND) as ShadeChannel;
}

export function structureShadeKey(shades: Uint8Array, tile: number, g: number): number {
  return shadeKey(structureShadeChannel(shades, tile), g);
}
