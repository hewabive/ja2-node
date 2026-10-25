import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CapturedPixels } from '../../src/app/game/ui-hook.ts';
import { decodePng, encodePngRgba, PngColorType } from '../../src/content/formats/png.ts';
import type { WidgetInfo } from '../../src/ui/widgets/widget-info.ts';
import { ORIGINAL_DATA_MODE } from './env.ts';

const GOLDEN_DIR = join(import.meta.dirname, 'golden');
const UPDATE_GOLDENS = process.env.JA2_UPDATE_GOLDENS === '1';
const RGBA = 4;
const TOLERANCE = 1;

export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Capture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly multiplyAreas: readonly Area[];
}

export async function openUiPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__ja2Ui?.ready === true || window.__ja2Ui?.error);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
}

export async function nextFrames(page: Page, count = 2): Promise<void> {
  const frames = await page.evaluate(() => window.__ja2Ui.frameCount);
  await page.waitForFunction((n) => window.__ja2Ui.frameCount > n, frames + count - 1);
}

export const NO_ORIGINAL_DATA_PICTURES = 'pictures of the original data are never captured, compared or written (docs/28 §15)';

function refuseOriginalData(): void {
  if (ORIGINAL_DATA_MODE) throw new Error(NO_ORIGINAL_DATA_PICTURES);
}

export async function capture(page: Page): Promise<Capture> {
  refuseOriginalData();
  await nextFrames(page);
  const shot: { pixels: CapturedPixels | null; areas: readonly Area[] } = await page.evaluate(() => ({
    pixels: window.__ja2Ui.capture(),
    areas: window.__ja2Ui.draw?.multiplyAreas ?? [],
  }));
  if (!shot.pixels) throw new Error('nothing was captured');
  return {
    width: shot.pixels.width,
    height: shot.pixels.height,
    rgba: new Uint8Array(Buffer.from(shot.pixels.rgba, 'base64')),
    multiplyAreas: shot.areas,
  };
}

function inside(areas: readonly Area[], x: number, y: number): boolean {
  return areas.some((a) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height);
}

function differences(actual: Capture, golden: Uint8Array): string[] {
  const problems: string[] = [];
  for (let i = 0; i < actual.width * actual.height && problems.length < 10; i++) {
    const x = i % actual.width;
    const y = Math.floor(i / actual.width);
    let worst = 0;
    for (let c = 0; c < RGBA; c++) worst = Math.max(worst, Math.abs((actual.rgba[i * RGBA + c] ?? 0) - (golden[i * RGBA + c] ?? 0)));
    const allowed = inside(actual.multiplyAreas, x, y) ? TOLERANCE : 0;
    if (worst > allowed) problems.push(`(${x}, ${y}) differs by ${worst}`);
  }
  return problems;
}

export async function expectGolden(name: string, actual: Capture): Promise<void> {
  refuseOriginalData();
  const path = join(GOLDEN_DIR, `${name}.png`);
  if (UPDATE_GOLDENS) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encodePngRgba(actual.width, actual.height, actual.rgba));
    return;
  }
  const golden = decodePng(await readFile(path));
  expect(golden.colorType).toBe(PngColorType.RGBA);
  expect([golden.width, golden.height]).toEqual([actual.width, actual.height]);
  expect(differences(actual, golden.data)).toEqual([]);
}

export async function widgets(page: Page): Promise<WidgetInfo[]> {
  return page.evaluate(() => [...window.__ja2Ui.widgets]);
}

export async function widget(page: Page, id: string): Promise<WidgetInfo> {
  await page.waitForFunction((wanted) => window.__ja2Ui.widgets.some((w) => w.id === wanted), id);
  const found = (await widgets(page)).find((w) => w.id === id);
  if (!found) throw new Error(`no widget ${id}`);
  return found;
}

export async function devicePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const view = await page.evaluate(() => ({ scale: window.__ja2Ui.scale, logical: window.__ja2Ui.logical }));
  const box = await page.locator('#screen').boundingBox();
  if (!box) throw new Error('no canvas');
  const offsetX = (box.width - view.logical.width * view.scale) / 2;
  const offsetY = (box.height - view.logical.height * view.scale) / 2;
  return { x: box.x + offsetX + x * view.scale + view.scale / 2, y: box.y + offsetY + y * view.scale + view.scale / 2 };
}

export async function clickWidget(page: Page, id: string): Promise<void> {
  const { rect } = await widget(page, id);
  const at = await devicePoint(page, rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2));
  await page.mouse.move(at.x, at.y);
  await nextFrames(page);
  await page.mouse.down();
  await nextFrames(page);
  await page.mouse.up();
  await nextFrames(page);
}

export async function widgetText(page: Page, id: string): Promise<string | null> {
  return (await widget(page, id)).text;
}
