import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __ja2Tactical: {
      ready: boolean;
      map: string | null;
      soldiers: number;
      drawnSoldiers: number;
      selected: number | null;
      selectedGridNo: number | null;
      tick: number;
      error: string | null;
      lastResult: string | null;
    };
  }
}

const SQUAD_SIZE = 4;

test('shows the stub sandbox squad and walks the selected merc to a clicked tile', async ({ page }) => {
  await page.goto('/src/devtools/tactical/');
  await page.waitForFunction(() => window.__ja2Tactical?.ready || window.__ja2Tactical?.error !== null);
  expect(await page.evaluate(() => window.__ja2Tactical.error)).toBeNull();
  expect(await page.evaluate(() => window.__ja2Tactical.map)).toBe('stubs/world/maps/village.dat');
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.drawnSoldiers)).toBeGreaterThanOrEqual(SQUAD_SIZE);
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.drawnSoldiers === window.__ja2Tactical.soldiers)).toBe(true);
  const start = await page.evaluate(() => window.__ja2Tactical.selectedGridNo);
  expect(start).not.toBeNull();

  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  await page.mouse.click(box.x + box.width / 2 - 200, box.y + box.height / 2 + 60);
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.lastResult)).toContain(': ok');
  await page.click('[data-speed="8"]');
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.selectedGridNo), { timeout: 15_000 }).not.toBe(start);
});

test('runs orders instantly on the server and plays them back at the chosen speed', async ({ page }) => {
  await page.goto('/src/devtools/tactical/');
  await page.waitForFunction(() => window.__ja2Tactical?.ready || window.__ja2Tactical?.error !== null);
  expect(await page.evaluate(() => window.__ja2Tactical.error)).toBeNull();
  await page.click('[data-speed="instant"]');
  await page.click('[data-playback="16"]');
  const start = await page.evaluate(() => window.__ja2Tactical.selectedGridNo);
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  await page.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2 + 90);
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.lastResult)).toContain(': ok');
  await expect(page.locator('#info')).toContainText('instant');
  await page.click('#skip');
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.selectedGridNo), { timeout: 15_000 }).not.toBe(start);
});
