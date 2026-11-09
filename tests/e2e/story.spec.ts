import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { INSTALLATION_FILE } from '../../src/server/installation-store.ts';
import { STORY_MAP_SAVE, STORY_MEANWHILE_SAVE, STORY_PALACE_SAVE, STORY_SCENE, writeStorySaves } from '../support/e2e-story-saves.ts';
import { SAVE_DIR } from './env.ts';
import { capture, clickWidget, expectGolden, nextFrames, waitForSettledFrames, widget } from './ui-capture.ts';

const SETTINGS_KEY = 'ja2-node:settings';
const SETTINGS_VERSION = 2;
const GOLDEN_QUERY = '&pinClock=1&fixed640=1&scale=1';
const TIME_HELD = '&holdTime=1';
const SCENE_DUE_WITHIN_SECONDS = 120;
const SCENE_TIMEOUT_MS = 60_000;
const STORY_SCENE_SEEN = 1 << STORY_SCENE;
const SKIPPED_SCENE_FRAMES = 20;

const sessions: string[] = [];

async function loadSession(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/sessions', { data: { load: name } });
  expect(response.ok()).toBe(true);
  const { session } = (await response.json()) as { session: string };
  sessions.push(session);
  return session;
}

async function settings(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, stored]) => {
      try {
        localStorage.setItem(key, stored);
      } catch {}
    },
    [SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, ...values })] as const,
  );
}

async function openGame(page: Page, session: string, screen: string, extra = ''): Promise<void> {
  await page.goto(`/play?session=${encodeURIComponent(session)}${extra}`);
  await page.waitForFunction((wanted) => window.__ja2Ui?.screen === wanted || window.__ja2Ui?.error, screen);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
}

async function openMap(page: Page, session: string, extra = ''): Promise<void> {
  await openGame(page, session, 'map', extra);
  await page.waitForFunction(() => window.__ja2Ui.map?.ready === true);
  await nextFrames(page, 4);
}

async function compressTime(page: Page): Promise<void> {
  const reply = await page.evaluate(() => window.__ja2Ui.map?.command({ type: 'compressTime', mode: 2 }));
  expect(reply).toMatchObject({ ok: true });
}

async function compressTimeShownSettled(page: Page): Promise<void> {
  await compressTime(page);
  await page.waitForFunction(() => window.__ja2Ui.map?.screen?.compression?.compressing === true);
  await waitForSettledFrames(page);
}

async function advanceToTheScene(page: Page): Promise<void> {
  await page.evaluate((seconds) => window.__ja2Ui.map?.advance({ worldSeconds: seconds }), SCENE_DUE_WITHIN_SECONDS);
}

async function handedOverToTheServer(page: Page): Promise<void> {
  await page.waitForFunction((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}').meanwhileScenesSeen === undefined;
    } catch {
      return false;
    }
  }, SETTINGS_KEY);
}

async function installationScenesSeen(request: APIRequestContext): Promise<number> {
  const response = await request.get('/api/installation');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { meanwhileScenesSeen: number }).meanwhileScenesSeen;
}

async function boxOffersOkAndSkip(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ja2Ui.modal === 'meanwhileBox');
  expect([(await widget(page, 'meanwhileBox.yes')).text, (await widget(page, 'meanwhileBox.no')).text]).toEqual(['OK', 'Skip']);
}

async function playedInThePalace(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ja2Ui.screen === 'tactical' && window.__ja2Ui.story?.step === null);
  await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
  await page.waitForFunction(() => window.__ja2Ui.screen === 'map', undefined, { timeout: SCENE_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__ja2Ui.modal)).toBeNull();
}

test.describe('the story and the help screens on /play', () => {
  test.beforeAll(async () => {
    await writeStorySaves(SAVE_DIR);
    await rm(join(SAVE_DIR, INSTALLATION_FILE), { force: true });
  });

  test.afterAll(async ({ request }) => {
    for (const session of sessions.splice(0)) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  });

  test('a due palace scene opens the meanwhile box over the map screen, with OK alone the first time, whose OK fades out into the scene', async ({
    page,
    request,
  }) => {
    await settings(page, { helpHidden: true });
    const session = await loadSession(request, STORY_MEANWHILE_SAVE);
    await openMap(page, session, `${GOLDEN_QUERY}${TIME_HELD}`);
    await compressTimeShownSettled(page);
    await advanceToTheScene(page);
    await page.waitForFunction(() => window.__ja2Ui.modal === 'meanwhileBox');
    expect((await widget(page, 'meanwhileBox')).text).toBe('Meanwhile.....');
    expect(await page.evaluate(() => window.__ja2Ui.widgets.filter((w) => w.id.startsWith('meanwhileBox.')).map((w) => w.id))).toEqual([
      'meanwhileBox.ok',
    ]);
    expect(await page.evaluate(() => window.__ja2Ui.map?.holds ?? [])).toEqual([]);
    await expectGolden('story-meanwhile-box', await capture(page));
    await clickWidget(page, 'meanwhileBox.ok');
    await page.waitForFunction(() => window.__ja2Ui.modal === 'fade-out' && window.__ja2Ui.story?.step === 'meanwhile');
    expect(await page.evaluate(() => window.__ja2Ui.story?.meanwhileBoxes)).toBe(1);
  });

  test('a page hands the scenes an older page marked seen to the server, whose box then offers OK and Skip, and Skip stays on the map: no fade, no hall', async ({
    page,
    request,
  }) => {
    await settings(page, { helpHidden: true, meanwhileScenesSeen: STORY_SCENE_SEEN });
    const session = await loadSession(request, STORY_MEANWHILE_SAVE);
    await openMap(page, session);
    await handedOverToTheServer(page);
    expect((await installationScenesSeen(request)) & STORY_SCENE_SEEN).toBe(STORY_SCENE_SEEN);
    await compressTime(page);
    await boxOffersOkAndSkip(page);
    await clickWidget(page, 'meanwhileBox.no');
    await page.waitForFunction(() => window.__ja2Ui.modal === null && window.__ja2Ui.story?.step === null);
    await nextFrames(page, SKIPPED_SCENE_FRAMES);
    expect(await page.evaluate(() => [window.__ja2Ui.screen, window.__ja2Ui.modal, window.__ja2Ui.story?.played])).toEqual([
      'map',
      null,
      ['meanwhileBox'],
    ]);
  });

  test('OK at the box of a scene seen before plays it in the hall and comes back to the map', async ({ page, request }) => {
    const handed = await request.post('/api/installation', { data: { meanwhileScenesSeen: STORY_SCENE_SEEN } });
    expect(handed.ok()).toBe(true);
    await settings(page, { helpHidden: true });
    const session = await loadSession(request, STORY_MEANWHILE_SAVE);
    await openMap(page, session);
    await compressTime(page);
    await boxOffersOkAndSkip(page);
    await clickWidget(page, 'meanwhileBox.yes');
    await playedInThePalace(page);
    expect(await page.evaluate(() => window.__ja2Ui.story?.played)).toEqual(['meanwhileBox', 'meanwhile']);
  });

  test('the Queen dies in the palace basement and the ending runs to the videos, the silent credits and the main menu', async ({
    page,
    request,
  }) => {
    await settings(page, { helpHidden: true });
    const session = await loadSession(request, STORY_PALACE_SAVE);
    await openGame(page, session, 'tactical');
    await page.waitForFunction(() => window.__ja2Ui.screen === 'credits');
    expect(await page.evaluate(() => window.__ja2Ui.story?.played)).toEqual(['upstairs', 'ending']);
    const ending = await page.evaluate(() => window.__ja2Ui.video?.sequences.at(-1) ?? null);
    expect(ending?.plan).toMatchObject({ sequence: 'ending', followedBy: 'credits' });
    expect(ending?.videos.map((v) => v.path)).toEqual(['intro/throne_mig.smk', 'intro/heli_flyby.smk', 'intro/heli_sky.smk']);
    expect(await page.evaluate(() => window.__ja2Ui.session)).toBeNull();
    expect(await page.evaluate(() => window.__ja2Ui.music?.mode)).toBe('none');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ja2Ui.screen === 'mainMenu');
    await page.waitForFunction(() => window.__ja2Ui.music?.mode === 'mainMenu');
  });

  test('a help screen comes up by itself once per campaign, h brings it back without the check box, and Escape closes it', async ({
    page,
    request,
  }) => {
    const session = await loadSession(request, STORY_MAP_SAVE);
    await page.goto('/play?screen=testPattern');
    await page.evaluate((key) => localStorage.removeItem(key), SETTINGS_KEY);
    await openGame(page, session, 'map', GOLDEN_QUERY);
    await page.waitForFunction(() => window.__ja2Ui.modal === 'helpScreen');
    expect(await page.evaluate(() => window.__ja2Ui.help)).toMatchObject({ open: 'map', forced: false, page: 0 });
    expect((await widget(page, 'helpTitle')).text).toBe('Stub map screen');
    expect((await widget(page, 'helpDontShowAgain')).visible).toBe(true);
    expect((await widget(page, 'helpFooter')).text).toBe('Hide the stub help screens');
    await clickWidget(page, 'helpPage3');
    expect(await page.evaluate(() => window.__ja2Ui.help?.page)).toBe(3);
    await page.keyboard.press('ArrowRight');
    await nextFrames(page);
    expect(await page.evaluate(() => window.__ja2Ui.help?.page)).toBe(4);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ja2Ui.modal === null);
    await page.reload();
    await openGame(page, session, 'map', GOLDEN_QUERY);
    await page.waitForFunction(() => window.__ja2Ui.map?.ready === true && window.__ja2Ui.map.lagTicks === 0);
    await nextFrames(page, 10);
    expect(await page.evaluate(() => window.__ja2Ui.modal)).toBeNull();
    await page.keyboard.press('KeyH');
    await page.waitForFunction(() => window.__ja2Ui.modal === 'helpScreen');
    expect(await page.evaluate(() => window.__ja2Ui.help)).toMatchObject({ open: 'map', forced: true, page: 0 });
    expect((await widget(page, 'helpDontShowAgain')).visible).toBe(false);
    await nextFrames(page, 4);
    await expectGolden('story-help-screen', await capture(page));
    await clickWidget(page, 'helpExit');
    await page.waitForFunction(() => window.__ja2Ui.modal === null);
  });
});
