import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { TimeSummary } from '../../src/app/game/time-samples.ts';
import { openTacticalSession } from './play-flow.ts';
import { openUiPage } from './ui-capture.ts';

const SAMPLED_FRAMES = 120;
const SAMPLE_TIMEOUT_MS = 120_000;
const LOOSE_P95_MS = 250;
const LOOSE_MAX_MS = 2_000;

async function newSandbox(request: APIRequestContext): Promise<string> {
  return ((await (await request.post('/api/sessions', { data: {} })).json()) as { session: string }).session;
}

async function sampleFrames(page: Page): Promise<TimeSummary> {
  await page.evaluate(() => window.__ja2Ui.resetFrameStats());
  await page.waitForFunction((n) => window.__ja2Ui.frameStats.count >= n, SAMPLED_FRAMES, { timeout: SAMPLE_TIMEOUT_MS });
  return page.evaluate(() => window.__ja2Ui.frameStats);
}

function expectSane(stats: TimeSummary, what: string): void {
  console.log(`frame time (${what}, stubs, SwiftShader): ${JSON.stringify(stats)}`);
  expect(stats.count).toBeGreaterThanOrEqual(SAMPLED_FRAMES);
  expect(stats.p50).toBeGreaterThan(0);
  expect(stats.p50).toBeLessThanOrEqual(stats.p95);
  expect(stats.p95).toBeLessThanOrEqual(stats.max);
  expect(stats.p95, `${what}: p95 frame time`).toBeLessThan(LOOSE_P95_MS);
  expect(stats.max, `${what}: longest frame`).toBeLessThan(LOOSE_MAX_MS);
}

test.describe('the frame-time probe on stubs (docs/28 §15, §16)', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test('reports sane frame times for the main menu and the tactical screen at UI scale 2', async ({ page, request }) => {
    await openUiPage(page, '/play');
    await page.waitForFunction(() => window.__ja2Ui.screen === 'mainMenu');
    expectSane(await sampleFrames(page), 'main menu');
    const session = await newSandbox(request);
    try {
      await openTacticalSession(page, session);
      expect(await page.evaluate(() => window.__ja2Ui.scale)).toBe(2);
      expectSane(await sampleFrames(page), 'tactical');
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });
});
