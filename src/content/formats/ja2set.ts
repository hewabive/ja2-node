// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDat.cc InitEngineTilesets, WorldDef.cc GetAdjustedTilesetResource

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';

export const TILESET_DATABASE_PATH = 'binarydata/ja2set.dat';
export const DEFAULT_TILESET_ID = 0;
const NAME_BYTES = 32;
const FILE_NAME_BYTES = 32;

export interface TilesetEntry {
  readonly id: number;
  readonly name: string;
  readonly ambientId: number;
  readonly surfaceFiles: readonly string[];
}

export interface TilesetDatabase {
  readonly tilesets: readonly TilesetEntry[];
  readonly tileTypeCount: number;
}

export function parseTilesetDatabase(bytes: Uint8Array): TilesetDatabase {
  const r = new BinaryReader(bytes);
  const tilesetCount = r.u8();
  const tileTypeCount = r.u32();
  if (tilesetCount === 0) throw new FormatError('tileset database contains no tilesets');
  const tilesets: TilesetEntry[] = [];
  for (let id = 0; id < tilesetCount; id++) {
    const name = r.fixedString(NAME_BYTES);
    const ambientId = r.u8();
    const surfaceFiles: string[] = [];
    for (let t = 0; t < tileTypeCount; t++) surfaceFiles.push(r.fixedString(FILE_NAME_BYTES));
    tilesets.push({ id, name, ambientId, surfaceFiles });
  }
  return { tilesets, tileTypeCount };
}

export interface TileSurfaceSource {
  readonly tilesetId: number;
  readonly path: string;
}

export function tileSurfaceSource(db: TilesetDatabase, tilesetId: number, tileType: number): TileSurfaceSource | null {
  const own = db.tilesets[tilesetId];
  if (!own) throw new RangeError(`no tileset ${tilesetId}`);
  const fileName = own.surfaceFiles[tileType] || db.tilesets[DEFAULT_TILESET_ID]?.surfaceFiles[tileType];
  if (!fileName) return null;
  const sourceId = own.surfaceFiles[tileType] ? tilesetId : DEFAULT_TILESET_ID;
  return { tilesetId: sourceId, path: `tilesets/${sourceId}/${fileName}`.toLowerCase() };
}

export function writeTilesetDatabase(db: TilesetDatabase): Uint8Array {
  const w = new BinaryWriter().u8(db.tilesets.length).u32(db.tileTypeCount);
  for (const t of db.tilesets) {
    w.fixedString(NAME_BYTES, t.name).u8(t.ambientId);
    for (let i = 0; i < db.tileTypeCount; i++) w.fixedString(FILE_NAME_BYTES, t.surfaceFiles[i] ?? '');
  }
  return w.toBytes();
}
