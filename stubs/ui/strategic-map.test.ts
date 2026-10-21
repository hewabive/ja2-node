import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodePcx, type Pcx } from '../../src/content/formats/pcx.ts';
import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import {
  BOARD_CELL_HEIGHT,
  BOARD_CELL_WIDTH,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  buildStubStrategicMap,
  cellLeft,
  cellTop,
  loadStubMovementCosts,
  STRATEGIC_MAP_PATH,
  sectorTerrain,
  Terrain,
  terrainColour,
} from './strategic-map.ts';

const TOWN_SECTOR = 'A9';
const WATER_SECTOR = 'B14';
const EDGE_SECTOR = 'A4';
const INSET = 6;

let dir = '';
let pcx: Pcx;

function indexAt(x: number, y: number): number {
  return pcx.pixels[y * pcx.width + x] ?? -1;
}

function sectorSample(name: string): number {
  const s = parseSectorString(name);
  return indexAt(cellLeft(s.x) + INSET, cellTop(s.y) + INSET);
}

function rgb(index: number): readonly number[] {
  return [...pcx.palette.subarray(index * 3, index * 3 + 3)];
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ja2-stub-board-'));
  expect(await buildStubStrategicMap(dir)).toEqual([STRATEGIC_MAP_PATH]);
  pcx = decodePcx(new Uint8Array(await readFile(join(dir, STRATEGIC_MAP_PATH))));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the stub strategic map board', () => {
  it('is the original 714×612 board: a label strip and 16×16 cells of 42×36 that halve to the 21×18 screen grid', () => {
    expect([pcx.width, pcx.height]).toEqual([BOARD_WIDTH, BOARD_HEIGHT]);
    expect([BOARD_WIDTH, BOARD_HEIGHT]).toEqual([714, 612]);
    expect([BOARD_CELL_WIDTH / 2, BOARD_CELL_HEIGHT / 2]).toEqual([21, 18]);
    expect(cellLeft(1) % 2).toBe(0);
    expect(cellTop(1) % 2).toBe(0);
  });

  it('colours each sector by its strategic traversability: towns, water and the edge of the world differ', async () => {
    const costs = await loadStubMovementCosts();
    const at = (name: string) => {
      const s = parseSectorString(name);
      return sectorTerrain(costs, s.x, s.y);
    };
    expect([at(TOWN_SECTOR), at(WATER_SECTOR), at(EDGE_SECTOR)]).toEqual([Terrain.TOWN, Terrain.WATER, Terrain.EDGEOFWORLD]);
    expect(sectorSample(TOWN_SECTOR)).toBe(terrainColour(Terrain.TOWN));
    expect(sectorSample(WATER_SECTOR)).toBe(terrainColour(Terrain.WATER));
    const [town, water, edge] = [TOWN_SECTOR, WATER_SECTOR, EDGE_SECTOR].map((s) => rgb(sectorSample(s)));
    expect(town).not.toEqual(water);
    expect((water?.[2] ?? 0) > (water?.[0] ?? 0)).toBe(true);
    const brightness = (c: readonly number[] | undefined) => (c ?? []).reduce((sum, v) => sum + v, 0);
    expect(brightness(town)).toBeGreaterThan(brightness(water));
    expect(brightness(edge)).toBeLessThan(brightness(water));
  });

  it('keeps the label strip plain and draws grid lines on even pixels, so the half-scale blit keeps them', () => {
    const strip = indexAt(0, 0);
    for (let x = 0; x < BOARD_WIDTH; x += 7) expect(indexAt(x, 2)).toBe(strip);
    for (let y = 0; y < BOARD_HEIGHT; y += 7) expect(indexAt(2, y)).toBe(strip);
    const grid = indexAt(cellLeft(5), cellTop(5) + INSET);
    expect(grid).not.toBe(sectorSample('E5'));
    expect(indexAt(cellLeft(5) + INSET, cellTop(5))).toBe(grid);
  });
});
