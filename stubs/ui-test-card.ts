import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rgbToRgb565 } from '../src/content/formats/rgb565.ts';
import { encodeStiIndexed, encodeStiRgb, type StiSubImage } from '../src/content/formats/sti.ts';
import { buildPalette, color } from './palette.ts';
import { IndexedRaster } from './raster.ts';

export const TEST_CARD_PATH = 'ui/test-card.sti';
export const TEST_CARD_RGB_PATH = 'ui/test-card-565.sti';
export const OUTLINE_INDEX = 254;

const PANEL_WIDTH = 48;
const PANEL_HEIGHT = 32;
const PANEL_OFFSET_X = 2;
const PANEL_OFFSET_Y = 1;
const ITEM_SIZE = 24;
const RGB_WIDTH = 64;
const RGB_HEIGHT = 32;
const CHANNEL_MAX = 255;

function frame(raster: IndexedRaster, offsetX = 0, offsetY = 0): StiSubImage {
  return { offsetX, offsetY, width: raster.width, height: raster.height, pixels: raster.pixels };
}

function panel(): StiSubImage {
  const r = new IndexedRaster(PANEL_WIDTH, PANEL_HEIGHT);
  r.rect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, color('ui', 8));
  r.frame(0, 0, PANEL_WIDTH, PANEL_HEIGHT, color('ui', 13));
  r.frame(1, 1, PANEL_WIDTH - 2, PANEL_HEIGHT - 2, color('ui', 4));
  r.rect(4, 4, 12, 8, color('red', 9));
  r.rect(18, 4, 12, 8, color('green', 9));
  r.rect(32, 4, 12, 8, color('blue', 9));
  for (let i = 0; i < 16; i++) r.rect(4 + i * 2 + Math.floor(i / 8) * 8, 16, 2, 12, color('gray', i));
  r.rect(PANEL_WIDTH - 8, 18, 4, 4, 0);
  return frame(r, PANEL_OFFSET_X, PANEL_OFFSET_Y);
}

function item(): StiSubImage {
  const r = new IndexedRaster(ITEM_SIZE, ITEM_SIZE);
  r.ellipse(11.5, 11.5, 9, 9, (nx, ny) => color('orange', 10 - Math.round((nx + ny) * 3)));
  r.rect(9, 3, 6, 18, color('steel', 7));
  r.outline(OUTLINE_INDEX);
  return frame(r);
}

function rgbGradient(): Uint16Array {
  const pixels = new Uint16Array(RGB_WIDTH * RGB_HEIGHT);
  for (let y = 0; y < RGB_HEIGHT; y++) {
    for (let x = 0; x < RGB_WIDTH; x++) {
      const red = Math.round((x * CHANNEL_MAX) / (RGB_WIDTH - 1));
      const green = Math.round((y * CHANNEL_MAX) / (RGB_HEIGHT - 1));
      pixels[y * RGB_WIDTH + x] = rgbToRgb565(red, green, CHANNEL_MAX - red);
    }
  }
  return pixels;
}

export function encodeTestCard(): Uint8Array {
  return encodeStiIndexed({ palette: buildPalette(), subImages: [panel(), item()] });
}

export function encodeTestCardRgb(): Uint8Array {
  return encodeStiRgb(RGB_WIDTH, RGB_HEIGHT, rgbGradient());
}

async function put(out: string, path: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return path;
}

export async function buildStubTestCard(out: string): Promise<string[]> {
  return [await put(out, TEST_CARD_PATH, encodeTestCard()), await put(out, TEST_CARD_RGB_PATH, encodeTestCardRgb())];
}
