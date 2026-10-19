import { parseTilesetDatabase, TILESET_DATABASE_PATH } from '../../content/formats/ja2set.ts';
import { type MapDef, parseMap } from '../../content/formats/map.ts';
import { buildLevel, type Level } from '../../content/world/level.ts';
import { placeWorldStructures } from '../../content/world/placement.ts';
import { buildTileDatabase, type TileElement } from '../../content/world/tile-database.ts';
import { parseTileTables, TILE_TABLES_PATH, type TileTables } from '../../content/world/tile-tables.ts';
import { type LoadedTileSurface, loadTileSurfaces } from '../../content/world/tileset-loader.ts';
import { fetchVfsFile, type ReadVfsFile } from '../net/vfs.ts';

export interface LoadedWorld {
  readonly mapPath: string;
  readonly map: MapDef;
  readonly level: Level;
  readonly tables: TileTables;
  readonly tiles: readonly TileElement[];
  readonly surfaces: readonly (LoadedTileSurface | null)[];
  readonly ambientId: number;
}

export function worldRoot(mapPath: string): string {
  return mapPath.slice(0, mapPath.lastIndexOf('maps/'));
}

export async function loadWorld(mapPath: string, available: ReadonlySet<string>, read: ReadVfsFile = fetchVfsFile): Promise<LoadedWorld> {
  const readOptional = async (path: string): Promise<Uint8Array | null> => (available.has(path) ? read(path) : null);
  const root = worldRoot(mapPath);
  const [tablesJson, tilesetBytes, mapBytes] = await Promise.all([
    read(TILE_TABLES_PATH),
    read(root + TILESET_DATABASE_PATH),
    read(mapPath),
  ]);
  const tables = parseTileTables(JSON.parse(new TextDecoder().decode(tablesJson)));
  const map = parseMap(mapBytes);
  const tilesets = parseTilesetDatabase(tilesetBytes);
  const surfaces = await loadTileSurfaces(readOptional, tables, tilesets, map.tilesetId, root);
  const ambientId = tilesets.tilesets[map.tilesetId]?.ambientId ?? 0;
  const tiles = buildTileDatabase(tables, surfaces, map.tilesetId);
  const { level } = placeWorldStructures(buildLevel(map, tables, tiles), tiles);
  return { mapPath, map, level, tables, tiles, surfaces, ambientId };
}
