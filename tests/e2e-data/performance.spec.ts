import type { TimeSummary } from '../../src/app/game/time-samples.ts';
import { waitWhileLoading, watchLoading } from '../e2e/play-flow.ts';
import { nextFrames } from '../e2e/ui-capture.ts';
import { expect, test } from './fixture.ts';

const SAMPLED_FRAMES = 300;
const SAMPLE_TIMEOUT_MS = 300_000;
const FULL_HD = { width: 1920, height: 1080 };

test.use({ viewport: FULL_HD });

test('measures the frame time of the A9 sandbox on /play at 1920×1080 in real time (logged, docs/28 §16)', async ({ page, request }) => {
  test.setTimeout(SAMPLE_TIMEOUT_MS * 2);
  const session = ((await (await request.post('/api/sessions', { data: {} })).json()) as { session: string }).session;
  try {
    watchLoading(page);
    await page.goto(`/play?session=${encodeURIComponent(session)}`);
    await waitWhileLoading(page, () => window.__ja2Ui?.tactical?.ready === true && window.__ja2Ui.tactical.pendingImages === 0);
    await nextFrames(page, 10);
    expect(await page.evaluate(() => window.__ja2Ui.scale)).toBe(2);
    const start = await page.evaluate(() => {
      window.__ja2Ui.resetFrameStats();
      window.__ja2Ui.tactical?.resetTimes();
      return { at: performance.now(), frames: window.__ja2Ui.frameCount };
    });
    await page.waitForFunction((n) => window.__ja2Ui.frameStats.count >= n, SAMPLED_FRAMES, { timeout: SAMPLE_TIMEOUT_MS });
    const measured = await page.evaluate(
      (from) => ({
        meanIntervalMs: (performance.now() - from.at) / (window.__ja2Ui.frameCount - from.frames),
        frame: window.__ja2Ui.frameStats,
        world: window.__ja2Ui.tactical?.worldMs ?? null,
        drawCalls: window.__ja2Ui.tactical?.drawCalls ?? 0,
        ui: { instances: window.__ja2Ui.draw?.instances ?? 0, batches: window.__ja2Ui.draw?.batches ?? 0 },
        soldiers: window.__ja2Ui.tactical?.drawnSoldiers ?? 0,
      }),
      start,
    );
    console.log(`A9 on the original data, /play 1920×1080 scale 2: ${JSON.stringify(measured)}`);
    const frame: TimeSummary = measured.frame;
    expect(frame.count).toBeGreaterThanOrEqual(SAMPLED_FRAMES);
  } finally {
    await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  }
});
