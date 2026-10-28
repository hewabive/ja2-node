import { expect, type Page, test } from '@playwright/test';

interface VideoResult {
  readonly path: string;
  readonly outcome: string;
  readonly frameCount: number;
  readonly framesShown: number;
  readonly framesDecoded: number;
}

interface SequenceResult {
  readonly outcome: string;
  readonly videos: readonly VideoResult[];
}

interface VideoPageHook {
  ready: boolean;
  busy: boolean;
  error: string | null;
  video: { progress: { framesDecoded: number; framesShown: number }; sequences: SequenceResult[] };
  credits: { running: boolean; rowsRead: number; scrolledPixels: number; outcome: string | null; error: string | null };
}

declare global {
  interface Window {
    __ja2Video: VideoPageHook;
  }
}

const STUB_SPLASH_FRAMES = 30;

const lastSequence = (page: Page) => page.evaluate(() => window.__ja2Video.video.sequences.at(-1) ?? null);
const idle = (page: Page) => page.waitForFunction(() => !window.__ja2Video.busy);

test('the stub splash plays in the browser, Escape ends it, missing videos are skipped and the credits scroll', async ({ page }) => {
  await page.goto('/src/devtools/video/');
  await page.waitForFunction(() => window.__ja2Video?.ready);

  await page.click('#playSplash');
  await expect(page.locator('.ja2-video canvas')).toBeVisible();
  await idle(page);
  const played = await lastSequence(page);
  expect(played?.outcome).toBe('finished');
  expect(played?.videos[0]).toMatchObject({ path: 'intro/splashscreen.smk', outcome: 'ended', frameCount: STUB_SPLASH_FRAMES });
  expect(played?.videos[0]?.framesDecoded).toBe(STUB_SPLASH_FRAMES);
  expect(played?.videos[0]?.framesShown).toBeGreaterThan(0);
  await expect(page.locator('.ja2-video')).toHaveCount(0);

  await page.click('#playSplash');
  await page.waitForFunction(() => window.__ja2Video.video.progress.framesShown > 0);
  await page.keyboard.press('Escape');
  await idle(page);
  const escaped = await lastSequence(page);
  expect(escaped?.outcome).toBe('escaped');
  expect(escaped?.videos[0]?.outcome).toBe('skipped');
  expect(escaped?.videos[0]?.framesDecoded).toBeLessThan(STUB_SPLASH_FRAMES);
  await expect(page.locator('.ja2-video')).toHaveCount(0);

  await page.click('#playBeginning');
  await idle(page);
  const beginning = await lastSequence(page);
  expect(beginning?.outcome).toBe('finished');
  expect(beginning?.videos.map((v) => v.outcome)).toEqual(['missing', 'missing', 'missing', 'missing']);

  await page.click('#playCredits');
  await page.waitForFunction(() => window.__ja2Video.credits.scrolledPixels > 20 && window.__ja2Video.credits.rowsRead > 2);
  await expect(page.locator('.ja2-credits')).toContainText('ja2-node');
  await page.keyboard.press('Escape');
  await idle(page);
  expect(await page.evaluate(() => window.__ja2Video.credits)).toMatchObject({ running: false, outcome: 'escaped', error: null });
  expect(await page.evaluate(() => window.__ja2Video.error)).toBeNull();
});
