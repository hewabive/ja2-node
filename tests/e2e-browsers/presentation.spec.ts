import { type Browser, expect, test } from '@playwright/test';
import { decodePng, type PngImage } from '../../src/content/formats/png.ts';
import { type Resolution, resolveResolution } from '../../src/ui/resolution.ts';
import { WEB_PORT } from '../e2e/env.ts';

const ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const STORAGE = {
  cookies: [],
  origins: [{ origin: ORIGIN, localStorage: [{ name: 'ja2-node:settings', value: JSON.stringify({ version: 2, helpHidden: true }) }] }],
};
const WINDOWS = [
  { width: 1301, height: 977 },
  { width: 1366, height: 768 },
];
const SETTLE_MS = 1_000;
const RGB = 3;
const RGBA = 4;

interface Shown {
  readonly capture: { readonly width: number; readonly height: number; readonly rgba: string };
  readonly stage: { readonly width: number; readonly height: number };
  readonly ratio: number;
}

function expectedAt(logicalWidth: number, r: Resolution, x: number, y: number): number {
  const inside = x >= r.viewX && x < r.viewX + r.viewWidth && y >= r.viewY && y < r.viewY + r.viewHeight;
  if (!inside) return -1;
  const lx = Math.floor(((x - r.viewX) * r.logicalWidth) / r.viewWidth);
  const ly = Math.floor(((y - r.viewY) * r.logicalHeight) / r.viewHeight);
  return (ly * logicalWidth + lx) * RGBA;
}

function channel(capture: Uint8Array, at: number, c: number): number {
  return at < 0 ? 0 : (capture[at + c] as number);
}

function mismatch(shot: PngImage, shown: Shown, fixed640: boolean): string | null {
  const device = (css: number) => Math.max(1, Math.floor(css * shown.ratio));
  const r = resolveResolution(device(shown.stage.width), device(shown.stage.height), { scale: 0, fixed640 }, shown.ratio);
  const capture = Buffer.from(shown.capture.rgba, 'base64');
  let pixels = 0;
  let first = '';
  for (let y = 0; y < shot.height; y++) {
    for (let x = 0; x < shot.width; x++) {
      const at = expectedAt(shown.capture.width, r, x, y);
      const o = (y * shot.width + x) * shot.channels;
      let same = true;
      for (let c = 0; c < RGB; c++) if (shot.data[o + c] !== channel(capture, at, c)) same = false;
      if (same) continue;
      pixels++;
      if (!first) first = `(${x}, ${y}) shows ${Array.from(shot.data.subarray(o, o + RGB))}`;
    }
  }
  return pixels === 0 ? null : `${pixels} device pixels differ, first ${first}`;
}

async function presentationMismatch(browser: Browser, ratio: number, size: (typeof WINDOWS)[number], fixed640: boolean, query: string) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: ratio, baseURL: ORIGIN, storageState: STORAGE });
  try {
    const page = await context.newPage();
    await page.goto(`/play?${[query, fixed640 ? 'fixed640=1' : ''].filter(Boolean).join('&')}`);
    await page.waitForFunction(() => {
      const ui = window.__ja2Ui;
      return ui?.screen === 'mainMenu' && ui.draw !== null && ui.draw.missingImages.length === 0 && ui.draw.missingFonts.length === 0;
    });
    await page.waitForTimeout(SETTLE_MS);
    const shown = await page.evaluate((): Shown | null => {
      const capture = window.__ja2Ui.capture();
      const stage = document.getElementById('stage')?.getBoundingClientRect();
      return capture && stage ? { capture, stage: { width: stage.width, height: stage.height }, ratio: devicePixelRatio } : null;
    });
    if (!shown) return 'nothing to capture';
    return mismatch(decodePng(await page.screenshot({ scale: 'device' })), shown, fixed640);
  } finally {
    await context.close();
  }
}

test('shows every logical pixel as a whole block of device pixels at each pixel ratio, window size and the 640×480-only option', async ({
  browser,
}, info) => {
  const ratios = info.project.metadata.pixelRatios as readonly number[];
  const query = (info.project.metadata.query as string | undefined) ?? '';
  const failures: string[] = [];
  for (const ratio of ratios) {
    for (const size of WINDOWS) {
      for (const fixed640 of [false, true]) {
        const found = await presentationMismatch(browser, ratio, size, fixed640, query);
        if (found) failures.push(`ratio ${ratio}, ${size.width}×${size.height}${fixed640 ? ', 640×480 only' : ''}: ${found}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
