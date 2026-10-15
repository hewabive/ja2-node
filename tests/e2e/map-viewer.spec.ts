import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __ja2MapViewer: { ready: boolean; map: string | null; quads: number; hoverGridNo: number | null; error: string | null };
  }
}

test('renders the stub village and picks the hovered tile', async ({ page }) => {
  await page.goto('/src/devtools/map-viewer/#map=stubs%2Fworld%2Fmaps%2Fvillage.dat');
  await page.waitForFunction(() => window.__ja2MapViewer?.ready || window.__ja2MapViewer?.error !== null);
  expect(await page.evaluate(() => window.__ja2MapViewer.error)).toBeNull();
  expect(await page.evaluate(() => window.__ja2MapViewer.map)).toBe('stubs/world/maps/village.dat');
  expect(await page.evaluate(() => window.__ja2MapViewer.quads)).toBeGreaterThan(500);

  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#hover')).toContainText('gridno');
  const hovered = await page.evaluate(() => window.__ja2MapViewer.hoverGridNo);
  expect(hovered).not.toBeNull();

  await page.uncheck('#roofs');
  await page.waitForTimeout(100);
  const withoutRoofs = await page.evaluate(() => window.__ja2MapViewer.quads);
  await page.check('#roofs');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__ja2MapViewer.quads)).toBeGreaterThan(withoutRoofs);
});
