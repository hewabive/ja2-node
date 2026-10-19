import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { CapturedPixels } from '../../src/app/game/ui-hook.ts';
import { decodePng, encodePngRgba, PngColorType } from '../../src/content/formats/png.ts';

const GOLDEN_DIR = join(import.meta.dirname, 'golden');
const UPDATE_GOLDENS = process.env.JA2_UPDATE_GOLDENS === '1';
const RGBA = 4;
const TOLERANCE = 1;

interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Capture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly multiplyAreas: readonly Area[];
}

async function openGamePage(page: Page, query: string): Promise<void> {
  await page.goto(`/play${query}`);
  await page.waitForFunction(() => window.__ja2Ui?.ready === true || window.__ja2Ui?.error);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
}

async function capture(page: Page): Promise<Capture> {
  const frames = await page.evaluate(() => window.__ja2Ui.frameCount);
  await page.waitForFunction((n) => window.__ja2Ui.frameCount > n + 1, frames);
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

async function expectGolden(name: string, actual: Capture): Promise<void> {
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

test.describe('the game page', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test('draws the test screen on stubs at UI scale 2 exactly like the golden', async ({ page }) => {
    await openGamePage(page, '?pinClock=1');
    const hook = await page.evaluate(() => {
      const h = window.__ja2Ui;
      return {
        screen: h.screen,
        modal: h.modal,
        scale: h.scale,
        origin: h.origin,
        logical: h.logical,
        widgets: h.widgets,
        dataVersion: h.dataVersion,
        draw: h.draw,
      };
    });
    expect(hook).toMatchObject({
      screen: 'testPattern',
      modal: null,
      scale: 2,
      origin: { x: 0, y: 0 },
      logical: { width: 640, height: 480 },
      widgets: [],
      dataVersion: 'stubs',
    });
    expect(hook.draw?.missingFonts).toEqual([]);
    expect(hook.draw?.instances).toBeGreaterThan(100);
    await expectGolden('test-pattern', await capture(page));
  });

  test('maps pointer positions through the integer scale and suppresses the context menu', async ({ page }) => {
    await openGamePage(page, '?pinClock=1');
    await page.mouse.click(2 * 100 + 1, 2 * 50 + 1);
    expect(await page.evaluate(() => [window.__ja2Ui.pointer, window.__ja2Ui.presses])).toEqual([{ x: 100, y: 50 }, 1]);
    const prevented = await page.evaluate(() => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      return !document.getElementById('screen')?.dispatchEvent(event);
    });
    expect(prevented).toBe(true);
  });
});

test.describe('the 640×480-only option', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('keeps a 640×480 frame centred with black bars and maps the pointer into it', async ({ page }) => {
    await openGamePage(page, '?pinClock=1&fixed640=1');
    expect(await page.evaluate(() => [window.__ja2Ui.scale, window.__ja2Ui.logical])).toEqual([1, { width: 640, height: 480 }]);
    await page.mouse.click(320 + 10, 160 + 20);
    expect(await page.evaluate(() => window.__ja2Ui.pointer)).toEqual({ x: 10, y: 20 });
  });

  test('extends the logical screen at scale 1 without it and centres the std640 frame', async ({ page }) => {
    await openGamePage(page, '?pinClock=1');
    expect(await page.evaluate(() => [window.__ja2Ui.scale, window.__ja2Ui.logical, window.__ja2Ui.origin])).toEqual([
      1,
      { width: 1280, height: 800 },
      { x: 320, y: 160 },
    ]);
  });
});
