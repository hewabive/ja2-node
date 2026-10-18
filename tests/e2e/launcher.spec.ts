import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

interface LauncherHook {
  readonly ready: boolean;
  readonly splash: string;
  readonly language: string | null;
  readonly campaign: string | null;
  readonly message: string;
  readonly video: { readonly progress: { readonly framesShown: number }; readonly sequences: readonly { readonly outcome: string }[] };
  readonly saves: { readonly rows: readonly string[]; readonly selected: string | null };
}

interface SaveKeysHook {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly saves: number;
  readonly loads: number;
  readonly last: { readonly action: string; readonly ok: boolean; readonly text: string } | null;
}

interface PageHooks {
  readonly __ja2Launcher: LauncherHook;
  readonly __ja2SaveKeys?: SaveKeysHook;
}

interface SessionSummary {
  readonly session: string;
  readonly options?: Record<string, unknown>;
  readonly language?: string;
}

type Tables = Readonly<Record<string, string | readonly string[]>>;

const GZIP_MAGIC = [0x1f, 0x8b];
const UPLOADED = 'launcher-upload';
const SLG_LOAD_SELECTED = 4;
const GIO_DIF_LEVEL = 7;
const MSG_SAVE_SUCCESS = 8;
const SLG_LOAD_GAME_OK = 7;
const MSG_YES = 2;
const OWN_SAVES = ['QuickSave', UPLOADED];

const launcher = (page: Page) => page.evaluate(() => (window as unknown as PageHooks).__ja2Launcher);
const saveKeys = (page: Page) => page.evaluate(() => (window as unknown as PageHooks).__ja2SaveKeys ?? null);

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

async function quick(page: Page, key: 'KeyS' | 'KeyL', count: 'saves' | 'loads', before: number): Promise<SaveKeysHook> {
  await page.keyboard.press(`Alt+${key}`);
  await expect.poll(async () => (await saveKeys(page))?.[count], { timeout: 20_000 }).toBe(before + 1);
  return (await saveKeys(page)) as SaveKeysHook;
}

test('the launcher starts a campaign with options, the tactical page quick saves and loads, the save list downloads, uploads and speaks Russian', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/?seed=1');
  await page.waitForFunction(() => (window as unknown as PageHooks).__ja2Launcher?.ready);
  await deleteSaves(page);
  expect((await launcher(page)).splash).toBe('waiting');
  await expect(page.locator('#start')).toBeVisible();
  await page.click('#startButton');
  await page.waitForFunction(() => (window as unknown as PageHooks).__ja2Launcher.video.progress.framesShown > 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as unknown as PageHooks).__ja2Launcher.splash === 'done');
  expect((await launcher(page)).video.sequences.at(-1)?.outcome).toBe('escaped');
  await expect(page.locator('#start')).toBeHidden();

  await expect(page.locator('input[name="difficulty"][value="1"]')).toBeChecked();
  await expect(page.locator('input[name="style"][value="sciFi"]')).toBeChecked();
  await expect(page.locator('input[name="guns"][value="reduced"]')).toBeChecked();
  await expect(page.locator('input[name="saveMode"][value="anywhere"]')).toBeChecked();
  await expect(page.locator('#bloodAndGore')).toBeChecked();
  await page.check('input[name="difficulty"][value="3"]');
  await page.check('input[name="guns"][value="gunNut"]');
  await page.uncheck('#bloodAndGore');
  await page.check('input[name="page"][value="tactical"]');
  await page.click('#startCampaign');
  await page.waitForURL(/\/src\/devtools\/tactical\/\?session=/);
  const session = new URL(page.url()).searchParams.get('session') ?? '';
  const sessions = (await page.evaluate(async () => (await fetch('/api/sessions')).json())) as SessionSummary[];
  expect(sessions.find((s) => s.session === session)?.options).toEqual({
    difficulty: 3,
    sciFi: true,
    gunNut: true,
    saveMode: 'anywhere',
    bloodAndGore: false,
  });

  await page.waitForFunction(() => window.__ja2Tactical?.ready || window.__ja2Tactical?.error !== null);
  expect(await page.evaluate(() => window.__ja2Tactical.error)).toBeNull();
  await page.waitForFunction(() => (window as unknown as PageHooks).__ja2SaveKeys?.ready);
  const english = await strings(page, 'eng');
  const savedAt = await page.evaluate(() => window.__ja2Tactical.tick);
  const saved = await quick(page, 'KeyS', 'saves', 0);
  expect(saved.last).toEqual({ action: 'save', ok: true, text: entry(english, 'pMessageStrings', MSG_SAVE_SUCCESS) });
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.lastResult)).toBe(saved.last?.text);

  await page.click('[data-speed="8"]');
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.tick), { timeout: 20_000 }).toBeGreaterThan(savedAt + 50);
  const loaded = await quick(page, 'KeyL', 'loads', 0);
  expect(loaded.last).toMatchObject({ action: 'load', ok: true });
  expect(loaded.last?.text.startsWith(entry(english, 'zSaveLoadText', SLG_LOAD_GAME_OK))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ja2Tactical.tick)).toBe(savedAt);
  expect(await page.evaluate(() => window.__ja2Tactical.error)).toBeNull();

  await page.goto(`/?session=${session}#saves`);
  await page.waitForFunction(() => (window as unknown as PageHooks).__ja2Launcher?.ready);
  expect((await launcher(page)).splash).toBe('off');
  const quickRow = page.locator('tr[data-save="QuickSave"]');
  await expect(quickRow).toBeVisible();
  await expect(quickRow).toContainText('A9');
  await expect(quickRow).toContainText('$');
  expect(await quickRow.getAttribute('title')).toContain('stubs');
  await expect(page.locator('#saveSession')).toHaveValue(session);

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
  await expect(page.locator('#campaign h2')).toHaveText('Новая кампания');
  await expect(page.locator('#saves h2')).toHaveText('Сохранённые игры');
  await expect(page.locator('#campaign legend').first()).toHaveText(entry(russian, 'gzGIOScreenText', GIO_DIF_LEVEL));
  await expect(page.locator('#loadSave')).toHaveText(entry(russian, 'zSaveLoadText', SLG_LOAD_SELECTED));
  expect(entry(russian, 'zSaveLoadText', SLG_LOAD_SELECTED)).not.toBe(entry(english, 'zSaveLoadText', SLG_LOAD_SELECTED));
  await page.reload();
  await page.waitForFunction(() => (window as unknown as PageHooks).__ja2Launcher?.ready);
  expect((await launcher(page)).language).toBe('rus');
  await expect(page.locator('#language')).toHaveValue('rus');

  await page.locator(`tr[data-save="${UPLOADED}"]`).click();
  await page.click('#deleteSave');
  await expect(page.locator('#messageBox')).toBeVisible();
  await expect(page.locator('#messageYes')).toHaveText(entry(russian, 'pMessageStrings', MSG_YES));
  await page.click('#messageYes');
  await expect(page.locator(`tr[data-save="${UPLOADED}"]`)).toHaveCount(0);
  await expect(page.locator('tr[data-save="QuickSave"]')).toBeVisible();
  await deleteSaves(page);
});
