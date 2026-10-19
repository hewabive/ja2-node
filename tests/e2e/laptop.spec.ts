import { expect, type Page, test } from '@playwright/test';
import { capture, clickWidget, expectGolden, nextFrames, openUiPage, widget, widgets, widgetText } from './ui-capture.ts';

declare global {
  interface Window {
    __ja2Laptop?: { session: string | null; closed: boolean };
  }
}

const LAPTOP = '/src/devtools/laptop/';
const LAPTOP_TEST_TIMEOUT_MS = 240_000;
const SEED = 7;
const MUG_ROWS = 5;
const MUG_COLUMNS = 8;
const VIEWER = '.0';

test.describe.configure({ timeout: LAPTOP_TEST_TIMEOUT_MS });

async function visible(page: Page, id: string): Promise<boolean> {
  return (await widgets(page)).some((w) => w.id === id && w.visible);
}

async function waitVisible(page: Page, id: string, shown = true): Promise<void> {
  await page.waitForFunction(
    ([wanted, state]) =>
      window.__ja2Ui.widgets.some((w) => w.id === wanted && w.visible === state) ||
      (!state && !window.__ja2Ui.widgets.some((w) => w.id === wanted)),
    [id, shown] as const,
  );
}

async function waitText(page: Page, id: string, predicate: string): Promise<string> {
  await page.waitForFunction(
    ([wanted, pattern]) => {
      const w = window.__ja2Ui.widgets.find((x) => x.id === wanted);
      return w?.visible === true && new RegExp(pattern).test(w.text ?? '');
    },
    [id, predicate] as const,
  );
  return (await widgetText(page, id)) ?? '';
}

async function dismissNewMail(page: Page): Promise<void> {
  await waitVisible(page, 'newMailOk');
  await clickWidget(page, 'newMailOk');
  await waitVisible(page, 'newMailOk', false);
}

async function closeSession(page: Page): Promise<void> {
  const session = await page.evaluate(() => window.__ja2Laptop?.session ?? null);
  if (!session) return;
  const closed = await page.evaluate(
    async (id) => (await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })).ok,
    session,
  );
  expect(closed).toBe(true);
}

test.describe('the canvas laptop on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });
  test.afterEach(async ({ page }) => closeSession(page));

  test('a new campaign greets with the new-mail box, lists the mails, pages a two-page mail and shows the finances', async ({ page }) => {
    await openUiPage(page, `${LAPTOP}?seed=${SEED}&pinClock=1&wait=0&slide=0&scale=2`);
    expect(await page.evaluate(() => window.__ja2Ui.screen)).toBe('laptop');
    await waitVisible(page, 'newMailOk');
    await expectGolden('laptop-new-mail', await capture(page));
    await dismissNewMail(page);

    await clickWidget(page, 'emailButton');
    await waitText(page, 'title', '.+');
    await waitText(page, 'listPage', '^1 / 1$');
    const subjects = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => page.evaluate((id) => window.__ja2Ui.widgets.find((w) => w.id === id), `unreadSubject${i}`)),
    );
    const unread = subjects.findIndex((w) => w?.visible === true);
    expect(unread).toBeGreaterThanOrEqual(0);
    await expectGolden('laptop-email', await capture(page));

    await clickWidget(page, `mailRow${unread}`);
    await waitText(page, `viewerSubject${VIEWER}`, 'Build your own mercenary');
    expect(await waitText(page, `mailPage${VIEWER}`, '^1 / 2$')).toBe('1 / 2');
    await clickWidget(page, `nextMailPage${VIEWER}`);
    expect(await waitText(page, `mailPage${VIEWER}`, '^2 / 2$')).toBe('2 / 2');
    await clickWidget(page, `closeMail${VIEWER}`);
    await waitVisible(page, `viewerSubject${VIEWER}`, false);
    await page.waitForFunction((id) => window.__ja2Ui.widgets.find((w) => w.id === id)?.visible === true, `subject${unread}`);

    await clickWidget(page, 'financesButton');
    await waitText(page, 'financePage', '1 / 2$');
    expect(await waitText(page, 'amount7', '^\\$')).toMatch(/^\$[\d,]+$/);
    await clickWidget(page, 'nextFinancePage');
    await waitText(page, 'financePage', '2 / 2$');
    expect(await waitText(page, 'ledgerText0', '.+')).not.toBe('');
  });

  test('hires a stub A.I.M. merc through the video conference', async ({ page }) => {
    await openUiPage(page, `${LAPTOP}?seed=${SEED}&wait=0&slide=0&scale=2`);
    await dismissNewMail(page);
    await clickWidget(page, 'webButton');
    await waitVisible(page, 'bookmarkRegion0');
    await clickWidget(page, 'bookmarkRegion0');
    await waitVisible(page, 'memberCardLink');
    await clickWidget(page, 'memberCardLink');
    await waitVisible(page, 'toMugShotsLink');
    await clickWidget(page, 'toMugShotsLink');
    await waitVisible(page, 'mugRegion0_0');

    const target = await page.evaluate(
      ([rows, columns]) => {
        const find = (id: string) => window.__ja2Ui.widgets.find((w) => w.id === id);
        for (let row = 0; row < rows; row++)
          for (let column = 0; column < columns; column++) {
            const overlay = find(`mugOverlay${row}_${column}`);
            if (find(`mugName${row}_${column}`)?.text && overlay && !overlay.text) return `mugRegion${row}_${column}`;
          }
        return null;
      },
      [MUG_ROWS, MUG_COLUMNS] as const,
    );
    expect(target).not.toBeNull();
    await clickWidget(page, target as string);
    await waitVisible(page, 'aimContact');
    const before = await widgetText(page, 'personnel');

    await clickWidget(page, 'aimContact');
    await waitVisible(page, 'hire');
    expect(await widgetText(page, 'confTitle')).toMatch(/.+/);
    await clickWidget(page, 'hire');
    await waitVisible(page, 'transferFunds');
    await waitText(page, 'chargeText', '^\\$');
    await clickWidget(page, 'transferFunds');
    await waitVisible(page, 'popupOk');
    await clickWidget(page, 'popupOk');
    await page.waitForFunction(() => window.__ja2Ui.modal !== null, undefined, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__ja2Ui.modal)).toBeTruthy();
    expect(await widgetText(page, 'personnel')).not.toBe(before);
    await nextFrames(page);
    expect(await visible(page, 'terminal')).toBe(false);
    expect((await widget(page, 'aimContact')).visible).toBe(true);
  });
});
