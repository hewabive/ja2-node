import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

interface SavesHook {
  readonly rows: readonly string[];
  readonly selected: string | null;
}

interface LauncherHook {
  readonly ready: boolean;
  readonly language: string | null;
  readonly message: string;
  readonly saves: SavesHook;
}

interface DevHook {
  readonly ready: boolean;
  readonly sessions: readonly string[];
  readonly saves: SavesHook;
}

interface PageHooks {
  readonly __ja2Launcher: LauncherHook;
  readonly __ja2Dev: DevHook;
}

interface SessionSummary {
  readonly session: string;
  readonly tick?: number;
  readonly driver?: { readonly mode: string };
  readonly options?: Record<string, unknown>;
  readonly language?: string;
}

type Tables = Readonly<Record<string, string | readonly string[]>>;

const GZIP_MAGIC = [0x1f, 0x8b];
const UPLOADED = 'launcher-upload';
const SLG_LOAD_SELECTED = 4;
const MSG_YES = 2;
const STR_PB_SECTOR = 41;
const OWN_SAVES = ['QuickSave', UPLOADED];
const TICKS_AFTER_SAVE = 50;

const launcher = (page: Page) => page.evaluate(() => (window as unknown as PageHooks).__ja2Launcher);
const launcherReady = (page: Page) => page.waitForFunction(() => (window as unknown as PageHooks).__ja2Launcher?.ready);
const devReady = (page: Page) => page.waitForFunction(() => (window as unknown as PageHooks).__ja2Dev?.ready);
const sessionOf = async (page: Page, session: string) =>
  ((await page.evaluate(async () => (await fetch('/api/sessions')).json())) as SessionSummary[]).find((s) => s.session === session);
const saveNames = async (page: Page) =>
  ((await page.evaluate(async () => (await fetch('/api/saves')).json())) as { readonly name: string }[]).map((s) => s.name);

async function strings(page: Page, lang: string): Promise<Tables> {
  return page.evaluate(async (l) => ((await (await fetch(`/api/strings?lang=${l}`)).json()) as { tables: Tables }).tables, lang);
}

function entry(tables: Tables, table: string, index: number): string {
  const value = tables[table];
  return typeof value === 'string' ? value : (value?.[index] ?? '');
}

async function deleteSaves(page: Page): Promise<void> {
  await page.evaluate(async (names) => {
    for (const name of names) await fetch(`/api/saves/${name}`, { method: 'DELETE' });
  }, OWN_SAVES);
}

async function closeFromDevPage(page: Page, session: string): Promise<void> {
  const row = page.locator(`#sessionList tr[data-session="${session}"]`);
  await row.locator('button.close-session').click();
  await expect(page.locator('#messageBox')).toBeVisible();
  await page.click('#messageYes');
  await expect(row).toHaveCount(0);
}

test("the launcher's UI scale and 640×480 settings reach the game page", async ({ page }) => {
  await page.goto('/');
  await launcherReady(page);
  await expect(page.locator('#uiScale')).toHaveValue('0');
  await page.selectOption('#uiScale', '2');
  await page.check('input[data-setting="fixed640"]');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ja2-node:settings') ?? '{}'));
  expect(stored).toMatchObject({ uiScale: 2, fixed640: true });
  await page.reload();
  await launcherReady(page);
  await expect(page.locator('#uiScale')).toHaveValue('2');
  await expect(page.locator('input[data-setting="fixed640"]')).toBeChecked();

  await page.click('#playLink');
  await page.waitForFunction(() => window.__ja2Ui?.ready === true);
  expect(await page.evaluate(() => [window.__ja2Ui.scale, window.__ja2Ui.logical])).toEqual([2, { width: 640, height: 480 }]);
});

test('the developer page starts a campaign with options on /play, which quick saves and loads; the developer page lists the session, drives its time and lists its saves; the launcher loads into /play, downloads, uploads and speaks Russian', async ({
  page,
}) => {
  await page.goto('/dev?seed=1');
  await devReady(page);
  await deleteSaves(page);

  await expect(page.locator('#seed')).toHaveValue('1');
  await expect(page.locator('input[name="difficulty"][value="1"]')).toBeChecked();
  await expect(page.locator('input[name="style"][value="sciFi"]')).toBeChecked();
  await expect(page.locator('input[name="guns"][value="reduced"]')).toBeChecked();
  await expect(page.locator('input[name="saveMode"][value="anywhere"]')).toBeChecked();
  await expect(page.locator('#bloodAndGore')).toBeChecked();
  await page.check('input[name="difficulty"][value="3"]');
  await page.check('input[name="guns"][value="gunNut"]');
  await page.uncheck('#bloodAndGore');
  await page.click('#startCampaign');
  await page.waitForURL(/\/play\?session=/);
  const session = new URL(page.url()).searchParams.get('session') ?? '';
  expect((await sessionOf(page, session))?.options).toEqual({
    difficulty: 3,
    sciFi: true,
    gunNut: true,
    saveMode: 'anywhere',
    bloodAndGore: false,
  });

  await page.waitForFunction(() => window.__ja2Ui?.tactical?.ready === true || window.__ja2Ui?.error);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await page.waitForFunction(() => window.__ja2Ui.screen === 'tactical' && window.__ja2Ui.modal === null);
  await page.keyboard.press('Alt+KeyS');
  await expect.poll(async () => (await saveNames(page)).includes('QuickSave')).toBe(true);
  const savedAt = (await sessionOf(page, session))?.tick ?? 0;
  await expect.poll(async () => (await sessionOf(page, session))?.tick ?? 0).toBeGreaterThan(savedAt + TICKS_AFTER_SAVE);
  const beforeLoad = (await sessionOf(page, session))?.tick ?? 0;
  await page.keyboard.press('Alt+KeyL');
  await expect.poll(async () => (await sessionOf(page, session))?.tick ?? 0).toBeLessThan(beforeLoad);
  await page.waitForFunction(() => window.__ja2Ui.screen === 'tactical' && window.__ja2Ui.tactical?.ready === true);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  const english = await strings(page, 'eng');

  await page.goto(`/dev?session=${session}`);
  await devReady(page);
  const sessionRow = page.locator(`#sessionList tr[data-session="${session}"]`);
  const gameLink = sessionRow.locator('a.game');
  await expect(gameLink).toHaveAttribute('href', `/play?session=${session}`);
  await page.check('input[data-param="shadowHints"]');
  await page.check('input[data-param="drive"]');
  await expect(gameLink).toHaveAttribute('href', `/play?session=${session}&shadowHints=1&drive=manual`);
  await sessionRow.locator('select.driver').selectOption('instant');
  await expect(page.locator('#status')).toHaveText(`${session}: instant.`);
  expect((await sessionOf(page, session))?.driver).toEqual({ mode: 'instant' });
  await sessionRow.locator('button.run-idle').click();
  await expect(page.locator('#status')).toContainText(`${session} ran to tick `);
  await sessionRow.locator('select.driver').selectOption('manual');
  await expect(page.locator('#status')).toHaveText(`${session}: paused.`);
  expect((await sessionOf(page, session))?.driver).toEqual({ mode: 'manual' });
  await expect(page.locator('#saveSession')).toHaveValue(session);
  const devQuickRow = page.locator('tr[data-save="QuickSave"]');
  await expect(devQuickRow).toBeVisible();
  await expect(devQuickRow).toContainText('A9');
  await expect(devQuickRow).toContainText('$');
  expect(await devQuickRow.getAttribute('title')).toContain('stubs');

  await page.goto('/');
  await launcherReady(page);
  await expect(page.locator('#saveSession')).toHaveCount(0);
  const quickRow = page.locator('tr[data-save="QuickSave"]');
  await expect(quickRow).toBeVisible();
  await quickRow.click();
  const downloading = page.waitForEvent('download');
  await page.click('#downloadSave');
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('QuickSave.j2s');
  const bytes = await readFile((await download.path()) ?? '');
  expect([...bytes.subarray(0, 2)]).toEqual(GZIP_MAGIC);

  await page.setInputFiles('#uploadSave', { name: `${UPLOADED}.j2s`, mimeType: 'application/gzip', buffer: bytes });
  await expect(page.locator(`tr[data-save="${UPLOADED}"]`)).toBeVisible();
  expect((await launcher(page)).saves.selected).toBe(UPLOADED);
  await expect(page.locator('#status')).toContainText(UPLOADED);

  const russian = await strings(page, 'rus');
  await page.selectOption('#language', 'rus');
  await page.waitForFunction(() => (window as unknown as PageHooks).__ja2Launcher.language === 'rus');
  await expect(page.locator('#saves h2')).toHaveText('Сохранённые игры');
  await expect(page.locator('#loadSave')).toHaveText(entry(russian, 'zSaveLoadText', SLG_LOAD_SELECTED));
  expect(entry(russian, 'zSaveLoadText', SLG_LOAD_SELECTED)).not.toBe(entry(english, 'zSaveLoadText', SLG_LOAD_SELECTED));
  await page.reload();
  await launcherReady(page);
  expect((await launcher(page)).language).toBe('rus');
  await expect(page.locator('#language')).toHaveValue('rus');

  await page.locator(`tr[data-save="${UPLOADED}"]`).click();
  await page.click('#deleteSave');
  await expect(page.locator('#messageBox')).toBeVisible();
  await expect(page.locator('#messageYes')).toHaveText(entry(russian, 'pMessageStrings', MSG_YES));
  await page.click('#messageYes');
  await expect(page.locator(`tr[data-save="${UPLOADED}"]`)).toHaveCount(0);

  await quickRow.click();
  await page.click('#loadSave');
  await page.waitForURL(/\/play\?session=/);
  const loadedSession = new URL(page.url()).searchParams.get('session') ?? '';
  expect(loadedSession).not.toBe(session);

  await page.goto('/dev');
  await devReady(page);
  await expect(page.locator('#saveList th').nth(2)).toHaveText(entry(english, 'gpStrategicString', STR_PB_SECTOR));
  await closeFromDevPage(page, loadedSession);
  await closeFromDevPage(page, session);
  await deleteSaves(page);
});

test('the developer page keeps the session rows busy until run until idle has refreshed the list, so the next time choice reaches the session', async ({
  page,
}) => {
  await page.goto('/dev');
  await devReady(page);
  const session = await page.evaluate(async () => {
    const created = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 1 }),
    });
    return ((await created.json()) as { readonly session: string }).session;
  });
  await page.reload();
  await devReady(page);
  const sessionRow = page.locator(`#sessionList tr[data-session="${session}"]`);
  await sessionRow.locator('select.driver').selectOption('instant');
  await expect(page.locator('#status')).toHaveText(`${session}: instant.`);
  await expect(sessionRow.locator('select.driver')).toBeEnabled();
  let releaseList = () => {};
  const listHeld = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'GET') await listHeld;
    await route.continue();
  });
  await sessionRow.locator('button.run-idle').click();
  await expect(page.locator('#status')).toContainText(`${session} ran to tick `);
  await expect(sessionRow.locator('select.driver')).toBeDisabled();
  const choosing = sessionRow.locator('select.driver').selectOption('manual');
  releaseList();
  await choosing;
  await expect(page.locator('#status')).toHaveText(`${session}: paused.`);
  expect((await sessionOf(page, session))?.driver).toEqual({ mode: 'manual' });
  await page.unroute('**/api/sessions');
  await closeFromDevPage(page, session);
});
