import { expect, type Page } from '@playwright/test';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import { clickWidget, devicePoint, nextFrames, widgets } from './ui-capture.ts';

const SETTINGS_KEY = 'ja2-node:settings';
const LOAD_TIMEOUT_MS = 120_000;

export interface HintStatsView {
  readonly local: number;
  readonly server: number;
  readonly shadowCompared: number;
  readonly shadowStale: number;
  readonly shadowFailed: number;
  readonly mismatchCount: number;
  readonly mismatches: readonly unknown[];
}

export interface ShadowStats {
  readonly tactical: HintStatsView | null;
  readonly map: HintStatsView | null;
}

export function flowStorage(origin: string, settings: Record<string, unknown>) {
  return {
    cookies: [],
    origins: [{ origin, localStorage: [{ name: SETTINGS_KEY, value: JSON.stringify({ version: 2, helpHidden: true, ...settings }) }] }],
  };
}

export async function seedNewCampaigns(page: Page, seed: number): Promise<void> {
  await page.route('**/api/sessions', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (!body || body.campaign === undefined || body.load !== undefined) return route.fallback();
    return route.fallback({ postData: JSON.stringify({ ...body, seed }) });
  });
}

export async function screenIs(page: Page, id: string, timeout = LOAD_TIMEOUT_MS): Promise<void> {
  await page.waitForFunction((wanted) => window.__ja2Ui.screen === wanted, id, { timeout });
  await nextFrames(page);
}

export async function modalIs(page: Page, id: string | null, timeout = LOAD_TIMEOUT_MS): Promise<void> {
  await page.waitForFunction((wanted) => window.__ja2Ui.modal === wanted, id, { timeout });
  await nextFrames(page);
}

export async function waitVisible(page: Page, id: string, shown = true, timeout = LOAD_TIMEOUT_MS): Promise<void> {
  await page.waitForFunction(
    ([wanted, state]) =>
      window.__ja2Ui.widgets.some((w) => w.id === wanted && w.visible === state) ||
      (!state && !window.__ja2Ui.widgets.some((w) => w.id === wanted)),
    [id, shown] as const,
    { timeout },
  );
}

export async function visibleWidget(page: Page, id: string): Promise<boolean> {
  return (await widgets(page)).some((w) => w.id === id && w.visible);
}

export async function clickVisible(page: Page, id: string): Promise<void> {
  await waitVisible(page, id);
  await clickWidget(page, id);
}

export async function pointAt(page: Page, x: number, y: number, frames = 2): Promise<void> {
  const at = await devicePoint(page, x, y);
  await page.mouse.move(at.x, at.y);
  await nextFrames(page, frames);
}

export async function clickAt(page: Page, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
  await pointAt(page, x, y);
  await page.mouse.down({ button });
  await nextFrames(page);
  await page.mouse.up({ button });
  await nextFrames(page);
}

export async function shadowStats(page: Page): Promise<ShadowStats> {
  return page.evaluate(() => ({
    tactical: (window.__ja2Ui.hints?.stats as unknown as HintStatsView | undefined) ?? null,
    map: (window.__ja2Ui.map?.hints.stats as unknown as HintStatsView | undefined) ?? null,
  }));
}

export function expectNoShadowDifference(stats: HintStatsView | null, what: string): number {
  expect(stats, `${what}: the hint provider exists`).not.toBeNull();
  expect(stats?.mismatches, `${what}: local hints equal the server's answers`).toEqual([]);
  expect(stats?.mismatchCount, what).toBe(0);
  expect(stats?.shadowFailed, what).toBe(0);
  return stats?.shadowCompared ?? 0;
}

export async function waitShadowSettled(page: Page, host: 'tactical' | 'map'): Promise<void> {
  await expect
    .poll(
      async () => {
        const stats = (await shadowStats(page))[host];
        return stats ? stats.local - stats.shadowCompared - stats.shadowStale - stats.shadowFailed : -1;
      },
      { timeout: 30_000 },
    )
    .toBe(0);
}

export async function openTacticalSession(page: Page, session: string, extra = ''): Promise<void> {
  watchLoading(page);
  await page.goto(`/play?session=${encodeURIComponent(session)}&drive=manual${extra}`);
  await waitWhileLoading(page, () => window.__ja2Ui?.tactical?.ready === true || window.__ja2Ui?.error);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await waitWhileLoading(page, () => window.__ja2Ui.tactical?.pendingImages === 0 && window.__ja2Ui.screen === 'tactical');
  await nextFrames(page, 4);
}

export async function rightClickWidget(page: Page, id: string): Promise<void> {
  const rect = await page.evaluate((wanted) => window.__ja2Ui.widgets.find((w) => w.id === wanted)?.rect ?? null, id);
  if (!rect) throw new Error(`no widget ${id}`);
  await clickAt(page, rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2), 'right');
}

export async function tacticalOrder(page: Page, cmd: CommandEnvelope): Promise<void> {
  const reply = (await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), cmd)) as { ok: boolean; reason?: string } | undefined;
  expect(reply?.ok, `${cmd.type}: ${reply?.reason ?? ''}`).toBe(true);
  await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
}

export async function showLatest(page: Page): Promise<void> {
  await page.evaluate(() => window.__ja2Ui.skipPlayback());
  await page.waitForFunction(() => window.__ja2Ui.lagTicks === 0, null, { timeout: LOAD_TIMEOUT_MS });
  await nextFrames(page, 2);
}

export async function imagesLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__ja2Ui.tactical?.pendingImages ?? 0) === 0, null, { timeout: LOAD_TIMEOUT_MS });
  await nextFrames(page, 2);
}

const LOAD_POLL_MS = 5_000;
const LOAD_STALL_MS = 90_000;
const finishedRequests = new WeakMap<Page, { count: number }>();

function requestCounter(page: Page): { count: number } {
  const known = finishedRequests.get(page);
  if (known) return known;
  const counter = { count: 0 };
  page.on('requestfinished', () => {
    counter.count++;
  });
  finishedRequests.set(page, counter);
  return counter;
}

async function loadingSignature(page: Page, counter: { count: number }): Promise<string> {
  const shown = await page.evaluate(() => {
    const ui = window.__ja2Ui;
    const bar = ui?.widgets.find((w) => w.kind === 'progressBar');
    return `${ui?.screen ?? ''}:${String(bar?.state ?? '')}`;
  });
  return `${counter.count}:${shown}`;
}

export function watchLoading(page: Page): void {
  requestCounter(page);
}

export async function waitWhileLoading(page: Page, predicate: () => unknown, stallMs = LOAD_STALL_MS): Promise<void> {
  const counter = requestCounter(page);
  let signature = await loadingSignature(page, counter);
  let since = Date.now();
  for (;;) {
    const done = await page
      .waitForFunction(predicate, null, { timeout: LOAD_POLL_MS })
      .then(() => true)
      .catch((error: Error) => {
        if (error.name !== 'TimeoutError') throw error;
        return false;
      });
    if (done) return;
    const now = await loadingSignature(page, counter);
    if (now !== signature) {
      signature = now;
      since = Date.now();
    } else if (Date.now() - since > stallMs) throw new Error(`the page stopped loading for ${stallMs} ms (${now})`);
  }
}

export async function expectShadowClean(page: Page): Promise<number> {
  const stats = await shadowStats(page);
  let compared = 0;
  for (const [host, found] of Object.entries(stats) as [string, HintStatsView | null][]) {
    if (!found) continue;
    expect(found.mismatches, `${host}: local hints equal the server's answers`).toEqual([]);
    expect(found.mismatchCount, host).toBe(0);
    compared += found.shadowCompared;
  }
  return compared;
}
