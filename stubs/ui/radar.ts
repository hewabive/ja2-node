import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeStiIndexed } from '../../src/content/formats/sti.ts';
import { parseStubMapSource, type StubMapSource } from '../../src/content/formats/stub-map.ts';
import { WORLD_COLS, WORLD_ROWS } from '../../src/content/world/grid.ts';
import { parseTileTables, type TileTables } from '../../src/content/world/tile-tables.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { buildPalette, color } from '../palette.ts';
import { IndexedRaster } from '../raster.ts';

export const RADAR_MAP_WIDTH = 88;
export const RADAR_MAP_HEIGHT = 44;
export const STUB_MAPS_DIR = 'world/maps';
export const STUB_RADAR_DIR = 'world/radarmaps';

const MAPS_SOURCE_DIR = join(import.meta.dirname, '..', 'maps');
const MAP_SOURCE_SUFFIX = '.map.txt';
const OFF_MAP = color('gray', 1);
const LAND_COLOURS: Readonly<Record<string, number>> = {
  FIRSTTEXTURE: color('green', 7),
  SECONDTEXTURE: color('brown', 8),
  THIRDTEXTURE: color('gray', 7),
  REGWATERTEXTURE: color('water', 7),
  FIRSTFLOOR: color('khaki', 9),
};
const OTHER_LAND = color('olive', 7);
const ROOF = color('red', 6);
const WALL = color('brown', 5);
const FENCE = color('brown', 10);
const CLIFF = color('gray', 6);
const STRUCTURE = color('rust', 8);

interface TileLayerRef {
  readonly layer: string;
  readonly type: number;
}

function typeName(tables: TileTables, type: number): string {
  return tables.types[type]?.name ?? '';
}

function structureColour(name: string): number {
  if (/WALL|DOOR/.test(name)) return WALL;
  if (/FENCE/.test(name)) return FENCE;
  if (/CLIFF/.test(name)) return CLIFF;
  return STRUCTURE;
}

export function legendColour(tables: TileTables, tiles: readonly TileLayerRef[]): number {
  if (tiles.some((t) => t.layer === 'roofs')) return ROOF;
  const structure = tiles.find((t) => t.layer === 'structs');
  if (structure) return structureColour(typeName(tables, structure.type));
  const land = tiles.find((t) => t.layer === 'land');
  return land ? (LAND_COLOURS[typeName(tables, land.type)] ?? OTHER_LAND) : OTHER_LAND;
}

export function tileColours(source: StubMapSource, tables: TileTables): Uint8Array {
  const colours = new Uint8Array(WORLD_COLS * WORLD_ROWS).fill(legendColour(tables, source.fill.tiles));
  const symbols = new Map([...source.legend].map(([symbol, legend]) => [symbol, legendColour(tables, legend.tiles)]));
  source.rows.forEach((row, y) => {
    [...row].forEach((symbol, x) => {
      colours[(source.origin.y + y) * WORLD_COLS + source.origin.x + x] = symbols.get(symbol) ?? OTHER_LAND;
    });
  });
  return colours;
}

export function radarRaster(colours: Uint8Array): IndexedRaster {
  const r = new IndexedRaster(RADAR_MAP_WIDTH, RADAR_MAP_HEIGHT);
  for (let py = 0; py < RADAR_MAP_HEIGHT; py++) {
    for (let px = 0; px < RADAR_MAP_WIDTH; px++) {
      const across = (((px + 0.5) / RADAR_MAP_WIDTH) * 2 - 1) * WORLD_COLS;
      const down = ((py + 0.5) / RADAR_MAP_HEIGHT) * 2 * WORLD_ROWS;
      const x = Math.floor((down + across) / 2);
      const y = Math.floor((down - across) / 2);
      const inside = x >= 0 && y >= 0 && x < WORLD_COLS && y < WORLD_ROWS;
      r.set(px, py, inside ? (colours[y * WORLD_COLS + x] ?? OFF_MAP) : OFF_MAP);
    }
  }
  return r;
}

export function radarMapPath(mapPath: string): string {
  return mapPath.replace(/(^|\/)maps\/([^/]+)\.dat$/, '$1radarmaps/$2.sti');
}

async function tileTables(): Promise<TileTables> {
  return parseTileTables(JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'tables/tiles.json'), 'utf8')));
}

export async function buildStubRadarMaps(out: string, aliases: Map<string, string>): Promise<string[]> {
  const tables = await tileTables();
  const palette = buildPalette();
  const written: string[] = [];
  for (const file of (await readdir(MAPS_SOURCE_DIR)).filter((f) => f.endsWith(MAP_SOURCE_SUFFIX)).sort()) {
    const source = parseStubMapSource(await readFile(join(MAPS_SOURCE_DIR, file), 'utf8'), tables);
    const raster = radarRaster(tileColours(source, tables));
    const path = radarMapPath(`${STUB_MAPS_DIR}/${file.replace(MAP_SOURCE_SUFFIX, '.dat')}`);
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(
      join(out, path),
      encodeStiIndexed({
        palette,
        subImages: [{ offsetX: 0, offsetY: 0, width: raster.width, height: raster.height, pixels: raster.pixels }],
      }),
    );
    written.push(path);
  }
  for (const [alias, target] of [...aliases]) {
    if (!alias.startsWith(`${STUB_MAPS_DIR}/`) || !target.startsWith(`${STUB_MAPS_DIR}/`)) continue;
    aliases.set(radarMapPath(alias), radarMapPath(target));
  }
  return written;
}
