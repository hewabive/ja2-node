import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeStiIndexed, type StiAppData, type StiSubImage } from '../../src/content/formats/sti.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { CURSORS_TABLE_PATH, type CursorTable, cursorFramesUsed, parseCursorTable } from '../../src/ui/cursors/cursor-table.ts';
import { buildPalette, color, type RampName } from '../palette.ts';
import { IndexedRaster } from '../raster.ts';

export const ANIMATED_STUB_CURSORS: Readonly<Record<string, number>> = {
  'cursors/cur_wait.sti': 4,
  'cursors/cur_targ.sti': 4,
};
const AUX_ANIMATED_TILE = 0x02;
const ARROW_SIZE = 16;
const RING_SIZE = 24;
const MARK_SIZE = 16;
const IBEAM_WIDTH = 7;
const IBEAM_HEIGHT = 16;
const OUTLINE = color('gray', 0);
const RAMPS: readonly RampName[] = ['red', 'green', 'blue', 'orange', 'violet', 'teal', 'sand', 'rust'];

type Shape = 'arrow' | 'ring' | 'ibeam' | 'mark';

function shapeOf(path: string): Shape {
  const name = path.split('/').at(-1) ?? path;
  if (name === 'cursor.sti' || name.includes('laptopcursor') || name.includes('fingercursor')) return 'arrow';
  if (name.startsWith('ibeam')) return 'ibeam';
  if (/^(cur_t|targ|cur_bst|cur_rbst|burst|bullseye|cross)/.test(name)) return 'ring';
  return 'mark';
}

function arrow(fill: number): IndexedRaster {
  const r = new IndexedRaster(ARROW_SIZE, ARROW_SIZE);
  for (let y = 0; y < ARROW_SIZE - 4; y++) for (let x = 0; x <= Math.floor(y * 0.7); x++) r.set(x, y, fill);
  for (let y = ARROW_SIZE - 6; y < ARROW_SIZE; y++) for (let x = 4; x < 7; x++) r.set(x + Math.floor((y - ARROW_SIZE + 6) / 2), y, fill);
  r.outline(OUTLINE);
  return r;
}

function ring(fill: number, frame: number): IndexedRaster {
  const r = new IndexedRaster(RING_SIZE, RING_SIZE);
  const c = (RING_SIZE - 1) / 2;
  const radius = 4 + (frame % 6) * 1.2;
  r.ellipse(c, c, radius + 1, radius + 1, () => fill);
  r.ellipse(c, c, radius - 1, radius - 1, () => 0);
  r.line(c, 0, c, RING_SIZE - 1, fill);
  r.line(0, c, RING_SIZE - 1, c, fill);
  r.outline(OUTLINE);
  return r;
}

function ibeam(fill: number): IndexedRaster {
  const r = new IndexedRaster(IBEAM_WIDTH, IBEAM_HEIGHT);
  r.rect(0, 0, IBEAM_WIDTH, 1, fill);
  r.rect(0, IBEAM_HEIGHT - 1, IBEAM_WIDTH, 1, fill);
  r.rect(3, 0, 1, IBEAM_HEIGHT, fill);
  return r;
}

function mark(fill: number, frame: number): IndexedRaster {
  const r = new IndexedRaster(MARK_SIZE, MARK_SIZE);
  const half = MARK_SIZE / 2;
  for (let y = 1; y < MARK_SIZE - 1; y++) {
    const span = half - 1 - Math.abs(y - half + 0.5);
    for (let x = Math.ceil(half - 1 - span); x <= Math.floor(half + span); x++) r.set(x, y, fill);
  }
  for (let i = 0; i <= frame % 4; i++) r.set(half - 2 + i, half, OUTLINE);
  r.outline(OUTLINE);
  return r;
}

export function stubCursorFrame(path: string, frame: number, fileIndex: number): StiSubImage {
  const fill = color(RAMPS[(fileIndex + frame) % RAMPS.length] as RampName, 11);
  const shape = shapeOf(path);
  const raster =
    shape === 'arrow'
      ? arrow(color('gray', 15))
      : shape === 'ring'
        ? ring(fill, frame)
        : shape === 'ibeam'
          ? ibeam(color('gray', 15))
          : mark(fill, frame);
  return { offsetX: 0, offsetY: 0, width: raster.width, height: raster.height, pixels: raster.pixels };
}

export function encodeStubCursor(table: CursorTable, path: string): Uint8Array {
  const fileIndex = table.files.findIndex((f) => f.path === path);
  const used = cursorFramesUsed(table).get(path) ?? 1;
  const animated = ANIMATED_STUB_CURSORS[path] ?? 0;
  const count = Math.max(used, animated);
  const subImages = Array.from({ length: count }, (_, i) => stubCursorFrame(path, i, fileIndex));
  const appData: StiAppData[] | undefined =
    animated > 0
      ? subImages.map(() => ({
          wallOrientation: 0,
          numberOfTiles: 0,
          tileLocationIndex: 0,
          currentFrame: 0,
          numberOfFrames: animated,
          flags: AUX_ANIMATED_TILE,
        }))
      : undefined;
  return encodeStiIndexed({ palette: buildPalette(), subImages, ...(appData ? { appData } : {}) });
}

export async function loadCursorTable(): Promise<CursorTable> {
  return parseCursorTable(JSON.parse(await readFile(join(PROJECT_DATA_DIR, CURSORS_TABLE_PATH), 'utf8')));
}

export async function buildStubCursors(out: string): Promise<string[]> {
  const table = await loadCursorTable();
  const written: string[] = [];
  for (const path of new Set(table.files.flatMap((f) => (f.path ? [f.path] : [])))) {
    const target = join(out, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, encodeStubCursor(table, path));
    written.push(path);
  }
  return written.sort();
}
