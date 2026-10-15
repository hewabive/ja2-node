import { expect, type Page, test } from '@playwright/test';
import type {} from '../../src/devtools/asset-browser/debug-hook.ts';

const PAGE = '/src/devtools/asset-browser/';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ja2AssetBrowser?.ready === true || window.__ja2AssetBrowser?.error !== null);
  expect(await page.evaluate(() => window.__ja2AssetBrowser.error)).toBeNull();
}

function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = document.getElementById('canvas') as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) n++;
    return n;
  });
}

test('shows a stub sprite as a frame grid and as an animation', async ({ page }, info) => {
  await page.goto(`${PAGE}#path=stubs/soldier/capsule.sprite.json`);
  await ready(page);
  await expect(page.locator('#status')).toContainText('original data not connected');
  await expect(page.locator('#info h3')).toHaveText('stubs/soldier/capsule.sprite.json');
  expect(await page.evaluate(() => window.__ja2AssetBrowser.frames)).toBe(32);
  expect(await page.evaluate(() => window.__ja2AssetBrowser.lastQuads)).toBe(32);
  expect(await paintedPixels(page)).toBeGreaterThan(32 * 200);
  await info.attach('grid', { body: await page.locator('#stage').screenshot(), contentType: 'image/png' });

  await page.click('[data-mode="anim"]');
  expect(await page.evaluate(() => window.__ja2AssetBrowser.lastQuads)).toBe(1);
  await expect(page.locator('#group-size')).toHaveValue('4');
  await page.fill('#group', '2');
  await page.locator('#group').dispatchEvent('change');
  await expect(page.locator('#hover')).toContainText('8 of 32');
  expect(page.url()).toContain('mode=anim');
  await info.attach('anim', { body: await page.locator('#stage').screenshot(), contentType: 'image/png' });
});

test('filters files, shows tiles and text files', async ({ page }) => {
  await page.goto(PAGE);
  await ready(page);
  await page.fill('#filter', 'ground');
  await page.locator('.tree .row', { hasText: 'stubs/tiles/ground.sprite.json' }).click();
  await expect(page.locator('#info')).toContainText('frames12');
  expect(await paintedPixels(page)).toBeGreaterThan(12 * 300);

  await page.fill('#filter', 'readme');
  await page.locator('.tree .row', { hasText: 'stubs/readme.txt' }).click();
  await expect(page.locator('#text')).toBeVisible();
  await expect(page.locator('#text')).toContainText('stub pack v0');
});

test('rejects direct server access without a token', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:7431/api/health');
  expect(res.status()).toBe(401);
});
