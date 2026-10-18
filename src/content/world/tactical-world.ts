import { FormatError } from '../binary/errors.ts';
import { parseTilesetDatabase, TILESET_DATABASE_PATH } from '../formats/ja2set.ts';
import { type MapDef, parseMap } from '../formats/map.ts';
import { withSectorExitGrids } from '../strategic/sector-maps.ts';
import { buildLevel, type Level } from './level.ts';
import {
  compileWorldMovementCosts,
  compileWorldTerrainIds,
  DOOR_COSTS_PATH,
  type MovementCosts,
  type MovementWorld,
  parseDoorCostTable,
} from './movement-costs.ts';
import { placeWorldStructures } from './placement.ts';
import type { WorldStructures } from './structures.ts';
import { buildTileDatabase, type TileElement, type TileSurface } from './tile-database.ts';
import { parseTileTables, TILE_TABLES_PATH, type TileTables } from './tile-tables.ts';
import { loadTileSurfaceGeometry, type ReadFile } from './tileset-loader.ts';

export interface TacticalWorld extends MovementWorld {
  readonly mapPath: string;
  readonly map: MapDef;
  readonly tables: TileTables;
  readonly tiles: readonly TileElement[];
  readonly level: Level;
  readonly structures: WorldStructures;
  readonly terrain: Uint8Array;
  readonly costs: MovementCosts;
  readonly rejectedStructs: number;
}

export function worldRootOf(mapPath: string): string {
  return mapPath.slice(0, mapPath.lastIndexOf('maps/'));
}

async function readRequired(read: ReadFile, path: string): Promise<Uint8Array> {
  const bytes = await read(path);
  if (!bytes) throw new FormatError(`missing ${path}`);
  return bytes;
}

async function readJson(read: ReadFile, path: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readRequired(read, path)));
}

export function buildTacticalWorld(
  mapPath: string,
  map: MapDef,
  tables: TileTables,
  surfaces: readonly (TileSurface | null)[],
  doorCostsJson: unknown,
): TacticalWorld {
  const tiles = buildTileDatabase(tables, surfaces, map.tilesetId);
  const placed = placeWorldStructures(buildLevel(map, tables, tiles), tiles);
  const terrain = compileWorldTerrainIds(placed.level, tiles, tables);
  const movement: MovementWorld = {
    level: placed.level,
    structures: placed.structures,
    terrain,
    exitGrids: new Set(map.exitGrids.map((e) => e.mapIndex)),
    doorCosts: parseDoorCostTable(doorCostsJson),
  };
  return {
    ...movement,
    mapPath,
    map,
    tables,
    tiles,
    level: placed.level,
    structures: placed.structures,
    terrain,
    costs: compileWorldMovementCosts(movement),
    rejectedStructs: placed.rejected.length,
  };
}

export interface TacticalWorldInputs {
  readonly mapPath: string;
  readonly map: MapDef;
  readonly tables: TileTables;
  readonly surfaces: readonly (TileSurface | null)[];
  readonly doorCostsJson: unknown;
}

export async function loadTacticalWorldInputs(read: ReadFile, mapPath: string): Promise<TacticalWorldInputs> {
  const root = worldRootOf(mapPath);
  const [tablesJson, doorCostsJson, tilesetBytes, mapBytes] = await Promise.all([
    readJson(read, TILE_TABLES_PATH),
    readJson(read, DOOR_COSTS_PATH),
    readRequired(read, root + TILESET_DATABASE_PATH),
    readRequired(read, mapPath),
  ]);
  const tables = parseTileTables(tablesJson);
  const map = withSectorExitGrids(parseMap(mapBytes), mapPath);
  const surfaces = await loadTileSurfaceGeometry(read, tables, parseTilesetDatabase(tilesetBytes), map.tilesetId, root);
  return { mapPath, map, tables, surfaces, doorCostsJson };
}

export function buildTacticalWorldFromInputs(inputs: TacticalWorldInputs): TacticalWorld {
  return buildTacticalWorld(inputs.mapPath, inputs.map, inputs.tables, inputs.surfaces, inputs.doorCostsJson);
}

export async function loadTacticalWorld(read: ReadFile, mapPath: string): Promise<TacticalWorld> {
  return buildTacticalWorldFromInputs(await loadTacticalWorldInputs(read, mapPath));
}
