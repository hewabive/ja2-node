import { expect, type Page, test } from '@playwright/test';
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
  await screenIs(page, 'laptopPlaceholder');
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

  test('starts a new game from the canvas main menu that opens the laptop with nobody hired', async ({ page, request }) => {
    await openUiPage(page, PLAY);
    await screenIs(page, 'mainMenu');
    const session = await newGame(page);
    const summary = ((await (await request.get('/api/sessions')).json()) as { session: string; flow?: string }[]).find(
      (s) => s.session === session,
    );
    expect(summary?.flow).toBe('laptop');
    const music = await page.evaluate(() => window.__ja2Ui.music?.serverMode ?? null);
    expect(music).not.toBe('mainMenu');
    await page.keyboard.press('Alt+KeyX');
    await modalIs(page, 'exitBoxLaptop');
    await clickWidget(page, 'exitBoxLaptop.yes');
    await screenIs(page, 'mainMenu');
    expect(await page.evaluate(() => window.__ja2Ui.session)).toBeNull();
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

  test('saves through the canvas save screen and loads the save from the main menu', async ({ page }) => {
    const description = `canvas ${Date.now() % 100000}`;
    await openUiPage(page, PLAY);
    await screenIs(page, 'mainMenu');
    await newGame(page);
    await page.keyboard.press('Control+KeyS');
    await screenIs(page, 'saveLoad');
    expect((await widget(page, 'saveButton')).visible).toBe(true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.kind === 'textField' && w.state === 'editing'));
    await page.keyboard.type(description);
    await page.keyboard.press('Enter');
    await screenIs(page, 'laptopPlaceholder');
    await clickWidget(page, 'mainMenu');
    await screenIs(page, 'mainMenu');
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'loadGame' && w.enabled));
    await clickWidget(page, 'loadGame');
    await screenIs(page, 'saveLoad');
    const row = (await widgets(page)).find((w) => w.id.startsWith('description') && w.text === description);
    expect(row).toBeDefined();
    await clickWidget(page, `row${row?.id.replace('description', '')}`);
    await clickWidget(page, 'loadButton');
    await screenIs(page, 'laptopPlaceholder');
    await modalIs(page, null);
    expect(await page.evaluate(() => window.__ja2Ui.session)).toMatch(/\S/);
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
