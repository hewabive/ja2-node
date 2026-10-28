import { expect, type Page, test } from '@playwright/test';
import { openTacticalSession, waitWhileLoading } from './play-flow.ts';
import { capture, clickWidget, expectGolden, nextFrames, openUiPage, widget, widgets } from './ui-capture.ts';

const PLAY = '/play';
const ENGINE = { version: '0.0.0', commit: 'golden0' };
const OPTIONS = { difficulty: 2, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true };
const ROUTED_SAVES = [
  {
    name: 'golden-a',
    native: false,
    modified: '2026-10-02T00:00:00.000Z',
    version: 2,
    compatible: true,
    problems: [],
    header: {
      kind: 'player',
      description: 'Before the bridge',
      savedAt: '2026-10-02T00:00:00.000Z',
      engine: ENGINE,
      content: { source: 'stubs', dataVersion: 'stubs' },
      options: OPTIONS,
      world: { day: 3, hour: 14, minute: 30 },
      sector: 'B13',
      flow: 'strategic',
      mercs: 4,
      balance: 21_750,
      campaign: 'golden',
      session: 'campaign',
      tick: 1,
    },
  },
  {
    name: 'golden-b',
    native: false,
    modified: '2026-10-01T00:00:00.000Z',
    version: 2,
    compatible: true,
    problems: [],
    header: {
      kind: 'deadIsDead',
      description: 'Last stand',
      savedAt: '2026-10-01T00:00:00.000Z',
      engine: ENGINE,
      content: { source: 'stubs', dataVersion: 'stubs' },
      options: { ...OPTIONS, saveMode: 'deadIsDead' },
      world: { day: 1, hour: 7, minute: 0 },
      sector: 'A9',
      flow: 'tactical',
      mercs: 1,
      balance: 3_000,
      campaign: 'golden-did',
      session: 'campaign',
      tick: 1,
    },
  },
];

async function routeForGoldens(page: Page): Promise<void> {
  await page.route('**/api/saves', (route) => route.fulfill({ json: ROUTED_SAVES }));
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    route.fulfill({ response, json: { ...(await response.json()), engine: ENGINE } });
  });
}

async function screenIs(page: Page, id: string): Promise<void> {
  await page.waitForFunction((wanted) => window.__ja2Ui.screen === wanted, id, { timeout: 30_000 });
  await nextFrames(page);
}

async function modalIs(page: Page, id: string | null): Promise<void> {
  await page.waitForFunction((wanted) => window.__ja2Ui.modal === wanted, id, { timeout: 30_000 });
  await nextFrames(page);
}

async function newGame(page: Page): Promise<string> {
  await clickWidget(page, 'newGame');
  await screenIs(page, 'gameInit');
  await clickWidget(page, 'start');
  await modalIs(page, 'messageBox');
  await clickWidget(page, 'messageBox.yes');
  await waitWhileLoading(page, () => window.__ja2Ui.screen === 'laptop');
  const session = await page.evaluate(() => window.__ja2Ui.session);
  if (!session) throw new Error('no session after a new game');
  return session;
}

test.describe('the canvas front end on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test('draws the main menu, game init, options, save/load and credits screens exactly like the goldens', async ({ page }) => {
    await routeForGoldens(page);
    await openUiPage(page, `${PLAY}?pinClock=1`);
    await screenIs(page, 'mainMenu');
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'loadGame' && w.enabled));
    expect(await page.evaluate(() => [window.__ja2Ui.draw?.missingImages, window.__ja2Ui.draw?.missingFonts])).toEqual([[], []]);
    await expectGolden('front-end-main-menu', await capture(page));
    await clickWidget(page, 'newGame');
    await screenIs(page, 'gameInit');
    await expectGolden('front-end-game-init', await capture(page));
    await page.keyboard.press('Escape');
    await screenIs(page, 'mainMenu');
    await page.keyboard.press('KeyO');
    await screenIs(page, 'options');
    await expectGolden('front-end-options', await capture(page));
    await page.keyboard.press('Escape');
    await screenIs(page, 'mainMenu');
    await clickWidget(page, 'loadGame');
    await screenIs(page, 'saveLoad');
    expect((await widget(page, 'description0')).text).toBe('Before the bridge');
    await expectGolden('front-end-save-load', await capture(page));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await screenIs(page, 'mainMenu');
    await page.keyboard.press('KeyS');
    await screenIs(page, 'credits');
    await expectGolden('front-end-credits', await capture(page));
  });

  test('starts a new game from the canvas main menu into the laptop with nobody hired, leaves it with Alt+X and loads its save through the canvas screens', async ({
    page,
    request,
  }) => {
    const description = `canvas ${Date.now() % 100000}`;
    await openUiPage(page, PLAY);
    await screenIs(page, 'mainMenu');
    const session = await newGame(page);
    const summary = ((await (await request.get('/api/sessions')).json()) as { session: string; flow?: string }[]).find(
      (s) => s.session === session,
    );
    expect(summary?.flow).toBe('laptop');
    expect(await page.evaluate(() => window.__ja2Ui.music?.serverMode ?? null)).not.toBe('mainMenu');
    expect((await request.post(`/api/sessions/${encodeURIComponent(session)}/save`, { data: { description } })).ok()).toBe(true);
    await page.keyboard.press('Alt+KeyX');
    await modalIs(page, 'exitBoxLaptop');
    await clickWidget(page, 'exitBoxLaptop.yes');
    await screenIs(page, 'mainMenu');
    expect(await page.evaluate(() => window.__ja2Ui.session)).toBeNull();
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'loadGame' && w.enabled));
    await clickWidget(page, 'loadGame');
    await screenIs(page, 'saveLoad');
    const row = (await widgets(page)).find((w) => w.id.startsWith('description') && w.text === description);
    expect(row).toBeDefined();
    await clickWidget(page, `row${row?.id.replace('description', '')}`);
    await clickWidget(page, 'loadButton');
    await waitWhileLoading(page, () => window.__ja2Ui.screen === 'laptop');
    await modalIs(page, null);
    const loaded = await page.evaluate(() => window.__ja2Ui.session);
    expect(loaded).not.toBeNull();
    await page.keyboard.press('Alt+KeyX');
    await modalIs(page, 'exitBoxLaptop');
    await clickWidget(page, 'exitBoxLaptop.yes');
    await screenIs(page, 'mainMenu');
    await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    if (loaded) await request.delete(`/api/sessions/${encodeURIComponent(loaded)}`);
  });

  test('leaves a session another page watches on Main Menu, and that page returns to the main menu with the reason once the session is closed', async ({
    page,
    request,
  }) => {
    const created = (await (await request.post('/api/sessions', { data: { seed: 7 } })).json()) as { session: string };
    const listed = async () =>
      ((await (await request.get('/api/sessions')).json()) as { session: string }[]).some((s) => s.session === created.session);
    const other = await page.context().newPage();
    try {
      await openTacticalSession(page, created.session);
      await openTacticalSession(other, created.session);
      await page.keyboard.press('KeyO');
      await screenIs(page, 'options');
      await clickWidget(page, 'mainMenu');
      await modalIs(page, 'messageBox');
      await clickWidget(page, 'messageBox.yes');
      await screenIs(page, 'mainMenu');
      expect(await listed()).toBe(true);
      expect(await other.evaluate(() => [window.__ja2Ui.screen, window.__ja2Ui.modal])).toEqual(['tactical', null]);
      expect((await request.delete(`/api/sessions/${encodeURIComponent(created.session)}`)).ok()).toBe(true);
      await modalIs(other, 'sessionEnded');
      expect(await other.evaluate(() => [window.__ja2Ui.screen, window.__ja2Ui.session])).toEqual(['mainMenu', null]);
      expect((await widget(other, 'sessionEnded')).text).toBe('The game session was closed on the server.');
      await clickWidget(other, 'sessionEnded.ok');
      await modalIs(other, null);
    } finally {
      await other.close();
      if (await listed()) await request.delete(`/api/sessions/${encodeURIComponent(created.session)}`);
    }
  });

  test('keeps the options toggles across a reload', async ({ page }) => {
    await openUiPage(page, PLAY);
    await screenIs(page, 'mainMenu');
    await clickWidget(page, 'preferences');
    await screenIs(page, 'options');
    expect((await widget(page, 'toggle17')).state).toBe(true);
    await clickWidget(page, 'toggle17');
    await clickWidget(page, 'toggleLabel12');
    expect((await widget(page, 'toggle17')).state).toBe(false);
    await clickWidget(page, 'done');
    await screenIs(page, 'mainMenu');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ja2-node:settings') ?? '{}').display);
    expect(stored).toMatchObject({ treeTops: false, useMetricSystem: false });
    await page.reload();
    await openUiPage(page, PLAY);
    await screenIs(page, 'mainMenu');
    await page.keyboard.press('KeyO');
    await screenIs(page, 'options');
    expect([(await widget(page, 'toggle17')).state, (await widget(page, 'toggle12')).state, (await widget(page, 'toggle0')).state]).toEqual(
      [false, false, true],
    );
    await page.evaluate(() => localStorage.removeItem('ja2-node:settings'));
  });

  test('plays the credits on the canvas and ends them on Escape', async ({ page }) => {
    await openUiPage(page, PLAY);
    await screenIs(page, 'mainMenu');
    await clickWidget(page, 'credits');
    await screenIs(page, 'credits');
    await page.waitForFunction(
      () => (window.__ja2Ui.draw?.instances ?? 0) > 1 && window.__ja2Ui.widgets.some((w) => w.id === 'roll'),
      null,
      { timeout: 10_000 },
    );
    await clickWidget(page, 'face4');
    expect((await widget(page, 'name')).visible).toBe(true);
    await page.keyboard.press('Escape');
    await screenIs(page, 'mainMenu');
  });
});
