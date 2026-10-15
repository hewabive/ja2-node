import { parseTilesetDatabase, TILESET_DATABASE_PATH } from '../../content/formats/ja2set.ts';
import { type MapDef, parseMap } from '../../content/formats/map.ts';
import { buildLevel, type Level } from '../../content/world/level.ts';
import { buildTileDatabase, type TileElement } from '../../content/world/tile-database.ts';
import { parseTileTables, TILE_TABLES_PATH, type TileTables } from '../../content/world/tile-tables.ts';
import { type LoadedTileSurface, loadTileSurfaces } from '../../content/world/tileset-loader.ts';
import { fetchFile } from '../asset-browser/api.ts';

export interface LoadedWorld {
  readonly mapPath: string;
  readonly map: MapDef;
  readonly level: Level;
  readonly tables: TileTables;
  readonly tiles: readonly TileElement[];
  readonly surfaces: readonly (LoadedTileSurface | null)[];
}

export function worldRoot(mapPath: string): string {
  return mapPath.slice(0, mapPath.lastIndexOf('maps/'));
}

export async function loadWorld(mapPath: string, available: ReadonlySet<string>): Promise<LoadedWorld> {
  const readOptional = async (path: string): Promise<Uint8Array | null> => (available.has(path) ? fetchFile(path) : null);
  const root = worldRoot(mapPath);
  const [tablesJson, tilesetBytes, mapBytes] = await Promise.all([
    fetchFile(TILE_TABLES_PATH),
    fetchFile(root + TILESET_DATABASE_PATH),
    fetchFile(mapPath),
  ]);
  const tables = parseTileTables(JSON.parse(new TextDecoder().decode(tablesJson)));
  const map = parseMap(mapBytes);
  const surfaces = await loadTileSurfaces(readOptional, tables, parseTilesetDatabase(tilesetBytes), map.tilesetId, root);
  const tiles = buildTileDatabase(tables, surfaces);
  return { mapPath, map, level: buildLevel(map, tables, tiles), tables, tiles, surfaces };
}
