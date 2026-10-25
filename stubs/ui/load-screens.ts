import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rgbToRgb565 } from '../../src/content/formats/rgb565.ts';
import { encodeStiRgb } from '../../src/content/formats/sti.ts';
import { collectReferences } from '../../src/ui/layout/references.ts';
import { IndexedRaster } from '../raster.ts';
import { labelFont, labelHeight, labelWidth, stampLabel } from './label.ts';
import { readOriginalLayouts } from './skin.ts';

export const LOAD_SCREEN_PATH = 'loadscreens/stub-load-screen-565.sti';
export const LOAD_SCREEN_WIDTH = 640;
export const LOAD_SCREEN_HEIGHT = 480;
const LOADING_SCREEN = 'loading';
const LOAD_SCREEN_PREFIX = 'loadscreens/ls_';
const TITLE = 'ja2-node stub load screen';
const INK = 1;
const BORDER = 8;
const CHANNEL_MAX = 255;
const TOP = { red: 18, green: 32, blue: 64 } as const;
const BOTTOM = { red: 24, green: 88, blue: 72 } as const;
const BORDER_COLOUR = rgbToRgb565(200, 180, 96);
const TITLE_COLOUR = rgbToRgb565(CHANNEL_MAX, CHANNEL_MAX, CHANNEL_MAX);

export async function loadScreenPaths(): Promise<string[]> {
  const loading = (await readOriginalLayouts()).find((m) => m.json.screen === LOADING_SCREEN);
  if (!loading) throw new Error('no loading screen layout');
  const paths = [...collectReferences(loading).assets.values()].map((use) => use.asset.path);
  return [...new Set(paths.filter((p) => p.startsWith(LOAD_SCREEN_PREFIX)))].sort();
}

function mix(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

async function titleMask(): Promise<IndexedRaster> {
  const font = await labelFont();
  const mask = new IndexedRaster(LOAD_SCREEN_WIDTH, LOAD_SCREEN_HEIGHT);
  const x = Math.floor((LOAD_SCREEN_WIDTH - labelWidth(font, TITLE)) / 2);
  const y = Math.floor((LOAD_SCREEN_HEIGHT - labelHeight(font)) / 2);
  stampLabel(mask, font, TITLE, x, y, INK);
  return mask;
}

function inBorder(x: number, y: number): boolean {
  return x < BORDER || y < BORDER || x >= LOAD_SCREEN_WIDTH - BORDER || y >= LOAD_SCREEN_HEIGHT - BORDER;
}

export async function encodeLoadScreen(): Promise<Uint8Array> {
  const mask = await titleMask();
  const pixels = new Uint16Array(LOAD_SCREEN_WIDTH * LOAD_SCREEN_HEIGHT);
  for (let y = 0; y < LOAD_SCREEN_HEIGHT; y++) {
    const t = y / (LOAD_SCREEN_HEIGHT - 1);
    const row = rgbToRgb565(mix(TOP.red, BOTTOM.red, t), mix(TOP.green, BOTTOM.green, t), mix(TOP.blue, BOTTOM.blue, t));
    for (let x = 0; x < LOAD_SCREEN_WIDTH; x++)
      pixels[y * LOAD_SCREEN_WIDTH + x] = inBorder(x, y) ? BORDER_COLOUR : mask.get(x, y) === INK ? TITLE_COLOUR : row;
  }
  return encodeStiRgb(LOAD_SCREEN_WIDTH, LOAD_SCREEN_HEIGHT, pixels);
}

export async function buildStubLoadScreens(out: string, aliases: Map<string, string>): Promise<string[]> {
  const target = join(out, LOAD_SCREEN_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await encodeLoadScreen());
  for (const path of await loadScreenPaths()) aliases.set(path, LOAD_SCREEN_PATH);
  return [LOAD_SCREEN_PATH];
}
