import { parseTilesetDatabase, TILESET_DATABASE_PATH } from '../../content/formats/ja2set.ts';
import { type MapDef, parseMap } from '../../content/formats/map.ts';
import type { Level } from '../../content/world/level.ts';
import { DOOR_COSTS_PATH } from '../../content/world/movement-costs.ts';
import type { WorldStructures } from '../../content/world/structures.ts';
import { buildTacticalWorld, type TacticalWorld } from '../../content/world/tactical-world.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { parseTileTables, TILE_TABLES_PATH, type TileTables } from '../../content/world/tile-tables.ts';
import { type LoadedTileSurface, loadTileSurfaces } from '../../content/world/tileset-loader.ts';
import { type LevelRenderData, prepareLevelRenderData } from '../../render/world/level-render-data.ts';
import type { LightColour } from '../../render/world/soldier-palettes.ts';
import type { RenderWorld } from '../../render/world/world-renderer.ts';
import { fetchVfsFile, type ReadVfsFile } from '../net/vfs.ts';

export interface LoadedWorld {
  readonly mapPath: string;
  readonly map: MapDef;
  readonly level: Level;
  readonly tables: TileTables;
  readonly tiles: readonly TileElement[];
  readonly surfaces: readonly (LoadedTileSurface | null)[];
  readonly structures: WorldStructures;
  readonly tactical: TacticalWorld;
  readonly prepared: LevelRenderData;
  readonly ambientId: number;
  readonly underground: boolean;
}

export function worldRoot(mapPath: string): string {
  return mapPath.slice(0, mapPath.lastIndexOf('maps/'));
}

const NO_LIGHT: LightColour = [0, 0, 0];

export function mapLightColour(map: MapDef): LightColour {
  const c = map.lights?.colors[0];
  return c ? [c[0], c[1], c[2]] : NO_LIGHT;
}

export async function loadWorld(mapPath: string, available: ReadonlySet<string>, read: ReadVfsFile = fetchVfsFile): Promise<LoadedWorld> {
  const readOptional = async (path: string): Promise<Uint8Array | null> => (available.has(path) ? read(path) : null);
  const root = worldRoot(mapPath);
  const [tablesJson, tilesetBytes, mapBytes, doorCostBytes] = await Promise.all([
    read(TILE_TABLES_PATH),
    read(root + TILESET_DATABASE_PATH),
    read(mapPath),
    read(DOOR_COSTS_PATH),
  ]);
  const tables = parseTileTables(JSON.parse(new TextDecoder().decode(tablesJson)));
  const map = parseMap(mapBytes);
  const tilesets = parseTilesetDatabase(tilesetBytes);
  const surfaces = await loadTileSurfaces(readOptional, tables, tilesets, map.tilesetId, root);
  const ambientId = tilesets.tilesets[map.tilesetId]?.ambientId ?? 0;
  const tactical = buildTacticalWorld(mapPath, map, tables, surfaces, JSON.parse(new TextDecoder().decode(doorCostBytes)));
  const underground = map.ambient?.basement === true || map.ambient?.caves === true;
  const prepared = prepareLevelRenderData(tactical.level, tactical.tiles, tables, map.info, underground);
  return {
    mapPath,
    map,
    level: tactical.level,
    tables,
    tiles: tactical.tiles,
    surfaces,
    structures: tactical.structures,
    tactical,
    prepared,
    ambientId,
    underground,
  };
}

export function renderWorldOf(w: LoadedWorld): RenderWorld {
  return {
    level: w.level,
    tiles: w.tiles,
    tables: w.tables,
    structures: w.structures,
    prepared: w.prepared,
    surfaces: w.surfaces,
    restrictedScrollId: w.map.info.restrictedScrollId,
    basement: w.map.ambient?.basement === true,
    lightColour: mapLightColour(w.map),
  };
}
