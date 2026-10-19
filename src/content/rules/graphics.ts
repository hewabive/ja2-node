import { FormatError } from '../binary/errors.ts';
import { parseTilesetDatabase, TILESET_DATABASE_PATH, tileSurfaceSource } from '../formats/ja2set.ts';
import { EXPLOSION_ANIMATIONS_PATH, explosionGraphics } from '../items/explosions.ts';
import { normalizeVfsPath } from '../vfs/path.ts';
import { worldRootOf } from '../world/tactical-world.ts';
import { parseTileTables, TILE_TABLES_PATH, type TileTables } from '../world/tile-tables.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

async function readJson(read: ReadFile, path: string): Promise<unknown | null> {
  const bytes = await read(path);
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as unknown) : null;
}

async function tilesetSurfacePaths(read: ReadFile, tables: TileTables, root: string): Promise<string[]> {
  const bytes = await read(root + TILESET_DATABASE_PATH);
  if (!bytes) return [];
  const db = parseTilesetDatabase(bytes);
  const paths: string[] = [];
  for (const tileset of db.tilesets) {
    for (const type of tables.types) {
      const source = tileSurfaceSource(db, tileset.id, type.index);
      if (source) paths.push(root + source.path);
    }
  }
  return paths;
}

export async function ruleGraphicPaths(read: ReadFile, mapPaths: Iterable<string>): Promise<string[]> {
  const found = new Set<string>();
  const tablesJson = await readJson(read, TILE_TABLES_PATH);
  if (tablesJson === null) throw new FormatError(`missing ${TILE_TABLES_PATH}`);
  const tables = parseTileTables(tablesJson);
  const roots = new Set([...mapPaths].map(worldRootOf));
  for (const root of [...roots].sort()) for (const path of await tilesetSurfacePaths(read, tables, root)) found.add(normalizeVfsPath(path));
  const animations = await readJson(read, EXPLOSION_ANIMATIONS_PATH);
  if (animations !== null) for (const graphic of explosionGraphics(animations)) if (graphic !== '') found.add(normalizeVfsPath(graphic));
  return [...found].sort();
}
