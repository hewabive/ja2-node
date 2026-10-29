import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { TimeSummary } from '../../src/app/game/time-samples.ts';
import { openTacticalSession } from './play-flow.ts';
import { nextFrames, openUiPage } from './ui-capture.ts';

const SAMPLED_FRAMES = 120;
const LOOSE_P95_MS = 250;
const LOOSE_MAX_MS = 2_000;
const QUIET_SEED = 1;
const LONGEST_UNDRAWN_MS = 500;
const MAP_MIDDLE = { x: 640, y: 300 };
const STILL_UI_CLOCK = 'pinClock=1';
const SAVE_LISTING = '/api/saves';
const LOAD_BUTTON = 'loadGame';

async function newSandbox(request: APIRequestContext): Promise<string> {
  return ((await (await request.post('/api/sessions', { data: { seed: QUIET_SEED } })).json()) as { session: string }).session;
}

async function openMainMenuWithItsSaveListing(page: Page): Promise<void> {
  const listing = page.waitForResponse((response) => new URL(response.url()).pathname === SAVE_LISTING);
  await openUiPage(page, `/play?${STILL_UI_CLOCK}`);
  await page.waitForFunction(() => window.__ja2Ui.screen === 'mainMenu');
  const savesExist = ((await (await listing).json()) as unknown[]).length > 0;
  await page.waitForFunction(([id, enabled]) => window.__ja2Ui.widgets.some((w) => w.id === id && w.enabled === enabled), [
    LOAD_BUTTON,
    savesExist,
  ] as const);
  await nextFrames(page);
}

interface FrameSample {
  readonly stats: TimeSummary;
  readonly presented: number;
  readonly ms: number;
}

async function sampleFrames(page: Page): Promise<FrameSample> {
  const start = await page.evaluate(() => {
    window.__ja2Ui.resetFrameStats();
    return { presented: window.__ja2Ui.presentedFrames, at: performance.now() };
  });
  await page.waitForFunction((n) => window.__ja2Ui.frameStats.count >= n, SAMPLED_FRAMES);
  return page.evaluate(
    (before) => ({
      stats: window.__ja2Ui.frameStats,
      presented: window.__ja2Ui.presentedFrames - before.presented,
      ms: performance.now() - before.at,
    }),
    start,
  );
}

function refreshesWithin(ms: number): number {
  return Math.floor(ms / LONGEST_UNDRAWN_MS) + 1;
}

function expectSane({ stats, presented, ms }: FrameSample, what: string): void {
  console.log(`frame time (${what}, stubs, SwiftShader): ${JSON.stringify(stats)}, ${presented} frames drawn in ${Math.round(ms)} ms`);
  expect(stats.count).toBeGreaterThanOrEqual(SAMPLED_FRAMES);
  expect(stats.p50).toBeGreaterThan(0);
  expect(stats.p50).toBeLessThanOrEqual(stats.p95);
  expect(stats.p95).toBeLessThanOrEqual(stats.max);
  expect(stats.p95, `${what}: p95 frame time`).toBeLessThan(LOOSE_P95_MS);
  expect(stats.max, `${what}: longest frame`).toBeLessThan(LOOSE_MAX_MS);
  expect(presented, `${what}: a still screen is drawn only to refresh it every ${LONGEST_UNDRAWN_MS} ms`).toBeLessThanOrEqual(
    refreshesWithin(ms),
  );
}

test.describe('the frame-time probe on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test('reports sane frame times for the main menu and the tactical screen at UI scale 2 and draws few frames of a still screen', async ({
    page,
    request,
  }) => {
    await openMainMenuWithItsSaveListing(page);
    expectSane(await sampleFrames(page), 'main menu');
    const session = await newSandbox(request);
    try {
      await openTacticalSession(page, session, `&${STILL_UI_CLOCK}`);
      expect(await page.evaluate(() => window.__ja2Ui.scale)).toBe(2);
      await page.mouse.move(MAP_MIDDLE.x, MAP_MIDDLE.y);
      await nextFrames(page);
      expectSane(await sampleFrames(page), 'tactical');
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });
});
