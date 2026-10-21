import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodePcx } from '../../src/content/formats/pcx.ts';
import { parseJsoncBytes } from '../../src/content/strategic/jsonc.ts';
import { type MovementCosts, parseMovementCosts, parseTraversabilityMap, StrategicMove } from '../../src/content/strategic/map-tables.ts';
import { MAP_SIDE, sectorId } from '../../src/content/strategic/sector-ids.ts';
import { STRATEGIC_CONTENT_PATHS } from '../../src/content/strategic/strategic-content.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { buildPalette, color } from '../palette.ts';
import { IndexedRaster } from '../raster.ts';

export const STRATEGIC_MAP_PATH = 'interface/b_map.pcx';
export const BOARD_CELL_WIDTH = 42;
export const BOARD_CELL_HEIGHT = 36;
export const BOARD_WIDTH = (MAP_SIDE + 1) * BOARD_CELL_WIDTH;
export const BOARD_HEIGHT = (MAP_SIDE + 1) * BOARD_CELL_HEIGHT;

const GRID_LINE = 2;
const ROAD_WIDTH = 4;
const STRIP = color('gray', 3);
const GRID = color('gray', 4);
const ROAD = color('sand', 12);
const UNKNOWN = color('violet', 6);

export const Terrain = {
  TOWN: 0,
  ROAD: 1,
  PLAINS: 2,
  SAND: 3,
  SPARSE: 4,
  DENSE: 5,
  SWAMP: 6,
  WATER: 7,
  HILLS: 8,
  GROUNDBARRIER: 9,
  NS_RIVER: 10,
  EW_RIVER: 11,
  EDGEOFWORLD: 12,
  TROPICS: 13,
  FARMLAND: 14,
  PLAINS_ROAD: 15,
  SPARSE_ROAD: 16,
  FARMLAND_ROAD: 17,
  TROPICS_ROAD: 18,
  DENSE_ROAD: 19,
  COASTAL: 20,
  HILLS_ROAD: 21,
  COASTAL_ROAD: 22,
  SAND_ROAD: 23,
  SWAMP_ROAD: 24,
} as const;

const GROUND: Readonly<Record<number, number>> = {
  [Terrain.TOWN]: color('skin', 12),
  [Terrain.ROAD]: color('khaki', 9),
  [Terrain.PLAINS]: color('green', 8),
  [Terrain.SAND]: color('sand', 8),
  [Terrain.SPARSE]: color('olive', 8),
  [Terrain.DENSE]: color('green', 5),
  [Terrain.SWAMP]: color('teal', 5),
  [Terrain.WATER]: color('water', 8),
  [Terrain.HILLS]: color('brown', 8),
  [Terrain.GROUNDBARRIER]: color('gray', 6),
  [Terrain.NS_RIVER]: color('blue', 8),
  [Terrain.EW_RIVER]: color('blue', 8),
  [Terrain.EDGEOFWORLD]: color('gray', 1),
  [Terrain.TROPICS]: color('teal', 7),
  [Terrain.FARMLAND]: color('olive', 10),
  [Terrain.COASTAL]: color('sand', 10),
};

const ROAD_GROUND: Readonly<Record<number, number>> = {
  [Terrain.PLAINS_ROAD]: Terrain.PLAINS,
  [Terrain.SPARSE_ROAD]: Terrain.SPARSE,
  [Terrain.FARMLAND_ROAD]: Terrain.FARMLAND,
  [Terrain.TROPICS_ROAD]: Terrain.TROPICS,
  [Terrain.DENSE_ROAD]: Terrain.DENSE,
  [Terrain.HILLS_ROAD]: Terrain.HILLS,
  [Terrain.COASTAL_ROAD]: Terrain.COASTAL,
  [Terrain.SAND_ROAD]: Terrain.SAND,
  [Terrain.SWAMP_ROAD]: Terrain.SWAMP,
};

export function terrainColour(terrain: number): number {
  return GROUND[ROAD_GROUND[terrain] ?? terrain] ?? UNKNOWN;
}

export function hasRoad(terrain: number): boolean {
  return terrain === Terrain.ROAD || ROAD_GROUND[terrain] !== undefined;
}

export function sectorTerrain(costs: MovementCosts, x: number, y: number): number {
  return costs.traversability[sectorId({ x, y })]?.[StrategicMove.THROUGH] ?? Terrain.EDGEOFWORLD;
}

export function cellLeft(x: number): number {
  return x * BOARD_CELL_WIDTH;
}

export function cellTop(y: number): number {
  return y * BOARD_CELL_HEIGHT;
}

function paintRoad(r: IndexedRaster, x: number, y: number): void {
  const left = cellLeft(x);
  const top = cellTop(y);
  r.rect(left, top + (BOARD_CELL_HEIGHT - ROAD_WIDTH) / 2, BOARD_CELL_WIDTH, ROAD_WIDTH, ROAD);
  r.rect(left + (BOARD_CELL_WIDTH - ROAD_WIDTH) / 2, top, ROAD_WIDTH, BOARD_CELL_HEIGHT, ROAD);
}

function paintGrid(r: IndexedRaster): void {
  for (let i = 1; i <= MAP_SIDE; i++) {
    r.rect(cellLeft(i), cellTop(1), GRID_LINE, BOARD_HEIGHT - cellTop(1), GRID);
    r.rect(cellLeft(1), cellTop(i), BOARD_WIDTH - cellLeft(1), GRID_LINE, GRID);
  }
}

export function strategicMapRaster(costs: MovementCosts): IndexedRaster {
  const r = new IndexedRaster(BOARD_WIDTH, BOARD_HEIGHT);
  r.rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT, STRIP);
  for (let y = 1; y <= MAP_SIDE; y++)
    for (let x = 1; x <= MAP_SIDE; x++) {
      const terrain = sectorTerrain(costs, x, y);
      r.rect(cellLeft(x), cellTop(y), BOARD_CELL_WIDTH, BOARD_CELL_HEIGHT, terrainColour(terrain));
      if (hasRoad(terrain)) paintRoad(r, x, y);
    }
  paintGrid(r);
  return r;
}

async function readDataJsonc(path: string): Promise<unknown> {
  return parseJsoncBytes(new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))));
}

export async function loadStubMovementCosts(): Promise<MovementCosts> {
  const terrain = parseTraversabilityMap(await readDataJsonc(STRATEGIC_CONTENT_PATHS.traversability));
  return parseMovementCosts(await readDataJsonc(STRATEGIC_CONTENT_PATHS.movementCosts), terrain);
}

export async function buildStubStrategicMap(out: string): Promise<string[]> {
  const raster = strategicMapRaster(await loadStubMovementCosts());
  const file = join(out, STRATEGIC_MAP_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, encodePcx(raster.width, raster.height, raster.pixels, buildPalette()));
  return [STRATEGIC_MAP_PATH];
}
