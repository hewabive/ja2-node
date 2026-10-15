import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeTilesetDatabase } from '../src/content/formats/ja2set.ts';
import { writeMap } from '../src/content/formats/map.ts';
import { parseStubMapSource, stubMapToMapDef } from '../src/content/formats/stub-map.ts';
import { STUB_SPRITE_SUFFIX } from '../src/content/picture/stub-sprite.ts';
import { parseTileTables, typeIndex } from '../src/content/world/tile-tables.ts';
import { Rng } from '../src/core/rng.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { color, type RampName } from './palette.ts';
import { IndexedRaster } from './raster.ts';
import type { StubFrame, StubSprite } from './sprites.ts';

export const STUB_WORLD_DIR = 'world';
const STUB_TILESET_ID = 0;
const STUB_WALL_HEIGHT = 50;
const MAPS_SOURCE_DIR = join(import.meta.dirname, 'maps');

function groundTile(ramp: RampName, base: number, seed: number): StubFrame {
  const rng = Rng.fromSeed(seed);
  const r = new IndexedRaster(40, 20);
  for (let y = 0; y < 20; y++) {
    const dy = y < 10 ? y : 19 - y;
    const half = 2 + dy * 2;
    for (let x = 20 - half; x < 20 + half; x++) r.set(x, y, color(ramp, base + rng.int(3) - 1));
  }
  return { raster: r, ox: 0, oy: 0 };
}

function wall(side: 'left' | 'right'): StubFrame {
  const raised = STUB_WALL_HEIGHT + 1;
  const r = new IndexedRaster(24, raised + 21);
  for (let i = 0; i <= 20; i++) {
    const x = side === 'left' ? i : 20 - i;
    const baseY = raised + 10 - Math.floor(i / 2);
    const px = side === 'left' ? x : x + 2;
    for (let y = baseY - STUB_WALL_HEIGHT; y <= baseY; y++)
      r.set(px, y, color('brown', 7 + (side === 'left' ? 1 : -1) + ((y + i) % 11 === 0 ? 3 : 0)));
    r.set(px, baseY - STUB_WALL_HEIGHT, color('brown', 13));
  }
  return { raster: r, ox: side === 'left' ? 0 : 18, oy: -raised };
}

function barrel(): StubFrame {
  const r = new IndexedRaster(16, 24);
  r.ellipse(8, 14, 6, 9, (nx) => color('rust', 8 - nx * 3));
  r.ellipse(8, 5, 6, 2.5, () => color('rust', 12));
  r.outline(color('gray', 1));
  return { raster: r, ox: 12, oy: -14 };
}

const SURFACES: readonly { readonly type: string; readonly sprite: StubSprite }[] = [
  { type: 'FIRSTTEXTURE', sprite: { path: 'grass', frames: [groundTile('green', 7, 1), groundTile('green', 6, 2)] } },
  { type: 'SECONDTEXTURE', sprite: { path: 'dirt', frames: [groundTile('brown', 8, 3), groundTile('brown', 7, 4)] } },
  { type: 'THIRDTEXTURE', sprite: { path: 'road', frames: [groundTile('gray', 7, 5)] } },
  { type: 'REGWATERTEXTURE', sprite: { path: 'water', frames: [groundTile('water', 7, 6)] } },
  { type: 'FIRSTFLOOR', sprite: { path: 'floor', frames: [groundTile('khaki', 9, 7)] } },
  { type: 'FIRSTWALL', sprite: { path: 'wall', frames: [wall('left'), wall('right')] } },
  { type: 'FIRSTROOF', sprite: { path: 'roof', frames: [groundTile('red', 6, 8)] } },
  { type: 'FIRSTOSTRUCT', sprite: { path: 'barrel', frames: [barrel()] } },
];

export interface StubWorldWriter {
  writeSprite(dir: string, sprite: StubSprite): Promise<string>;
}

export async function buildStubWorld(outDir: string, writer: StubWorldWriter): Promise<string[]> {
  const root = join(outDir, STUB_WORLD_DIR);
  const tables = parseTileTables(JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'tables/tiles.json'), 'utf8')));
  const surfaceFiles = tables.types.map(() => '');
  const tilesetDir = join(root, 'tilesets', String(STUB_TILESET_ID));
  for (const s of SURFACES) {
    await writer.writeSprite(tilesetDir, s.sprite);
    surfaceFiles[typeIndex(tables, s.type)] = `${s.sprite.path}${STUB_SPRITE_SUFFIX}`;
  }
  const db = writeTilesetDatabase({
    tileTypeCount: tables.types.length,
    tilesets: [{ id: STUB_TILESET_ID, name: 'STUB WORLD', ambientId: 0, surfaceFiles }],
  });
  const dbPath = join(root, 'binarydata', 'ja2set.dat');
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, db);
  const written = [`${STUB_WORLD_DIR}/binarydata/ja2set.dat`];
  for (const file of (await readdir(MAPS_SOURCE_DIR)).filter((f) => f.endsWith('.map.txt')).sort()) {
    const source = parseStubMapSource(await readFile(join(MAPS_SOURCE_DIR, file), 'utf8'), tables);
    const name = file.replace(/\.map\.txt$/, '.dat');
    await mkdir(join(root, 'maps'), { recursive: true });
    await writeFile(join(root, 'maps', name), writeMap(stubMapToMapDef(source)));
    written.push(`${STUB_WORLD_DIR}/maps/${name}`);
  }
  return written;
}
