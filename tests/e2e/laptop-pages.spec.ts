import { expect, type Page, test } from '@playwright/test';
import { capture, clickWidget, expectGolden, openUiPage, widgets, widgetText } from './ui-capture.ts';

type LaptopCommand = { readonly type: string; readonly [key: string]: unknown };

interface LaptopPagesHook {
  readonly session: string | null;
  readonly command: ((cmd: LaptopCommand) => Promise<{ readonly ok: boolean }>) | null;
}

const LAPTOP = '/src/devtools/laptop/';
const LAPTOP_PAGES_TEST_TIMEOUT_MS = 300_000;
const SEED = 7;
const SQUAD_SEED = 32;
const WEEK_CONTRACT = 7;
const DAY_CONTRACT = 1;
const WEEK_HIRES = [0, 1, 3, 4, 5, 6, 7, 9, 10];
const DAY_HIRES = [2, 8, 11];
const SQUAD: readonly (readonly [number, number])[] = [
  ...WEEK_HIRES.map((profile) => [profile, WEEK_CONTRACT] as const),
  ...DAY_HIRES.map((profile) => [profile, DAY_CONTRACT] as const),
];
const HISTORY_ROWS_PER_PAGE = 22;
const REPEATED = '.0';
const FLOWER = 1;
const DESTINATION_ROW = 3;
const BLACK_ROSES_CHECK = 3;

test.describe.configure({ timeout: LAPTOP_PAGES_TEST_TIMEOUT_MS });

function laptopUrl(seed: number, hire: readonly (readonly [number, number])[]): string {
  const squad = hire.map(([profile, days]) => `${profile}:${days}`).join(',');
  return `${LAPTOP}?seed=${seed}&pinClock=1&wait=0&slide=0&scale=2${squad ? `&hire=${squad}` : ''}`;
}

async function send(page: Page, cmd: LaptopCommand): Promise<{ readonly ok: boolean }> {
  return page.evaluate(async (c) => {
    const h = (window as unknown as { __ja2Laptop?: LaptopPagesHook }).__ja2Laptop;
    if (!h?.command) throw new Error('the laptop page has no command hook');
    return h.command(c);
  }, cmd);
}

async function waitVisible(page: Page, id: string, shown = true): Promise<void> {
  await page.waitForFunction(
    ([wanted, state]) =>
      window.__ja2Ui.widgets.some((w) => w.id === wanted && w.visible === state) ||
      (!state && !window.__ja2Ui.widgets.some((w) => w.id === wanted)),
    [id, shown] as const,
  );
}

async function waitText(page: Page, id: string, pattern: string): Promise<string> {
  await page.waitForFunction(
    ([wanted, p]) => {
      const w = window.__ja2Ui.widgets.find((x) => x.id === wanted);
      return w?.visible === true && new RegExp(p).test(w.text ?? '');
    },
    [id, pattern] as const,
  );
  return (await widgetText(page, id)) ?? '';
}

async function waitEnabled(page: Page, id: string, enabled = true): Promise<void> {
  await page.waitForFunction(([wanted, state]) => window.__ja2Ui.widgets.some((w) => w.id === wanted && w.visible && w.enabled === state), [
    id,
    enabled,
  ] as const);
}

async function waitPressed(page: Page, id: string): Promise<void> {
  await page.waitForFunction((wanted) => window.__ja2Ui.widgets.some((w) => w.id === wanted && w.visible && w.state === 'pressed'), id);
}

async function waitChanged(page: Page, id: string, before: string | null): Promise<void> {
  await page.waitForFunction(([wanted, old]) => window.__ja2Ui.widgets.find((w) => w.id === wanted)?.text !== old, [id, before] as const);
}

async function dismissNewMail(page: Page): Promise<void> {
  await waitVisible(page, 'newMailOk');
  await clickWidget(page, 'newMailOk');
  await waitVisible(page, 'newMailOk', false);
}

async function openAim(page: Page): Promise<void> {
  await clickWidget(page, 'webButton');
  await waitVisible(page, 'bookmarkRegion0');
  await clickWidget(page, 'bookmarkRegion0');
  await waitVisible(page, 'memberCardLink');
}

async function aimLink(page: Page, link: number): Promise<void> {
  await clickWidget(page, 'aimLogo');
  await waitVisible(page, 'linksLink');
  await clickWidget(page, 'linksLink');
  await waitVisible(page, `aimLink${link}`);
  await clickWidget(page, `aimLink${link}`);
}

async function bookmarkRows(page: Page): Promise<number> {
  return (await widgets(page)).filter((w) => w.id?.startsWith('bookmarkRegion') && w.visible).length;
}

async function closeSession(page: Page): Promise<void> {
  const session = await page.evaluate(() => (window as unknown as { __ja2Laptop?: LaptopPagesHook }).__ja2Laptop?.session ?? null);
  if (!session) return;
  const closed = await page.evaluate(
    async (id) => (await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })).ok,
    session,
  );
  expect(closed).toBe(true);
}

test.describe('the laptop pages of U12 on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });
  test.afterEach(async ({ page }) => closeSession(page));

  test('pages through Personnel and History, insures a merc and reads a file, with goldens', async ({ page }) => {
    await openUiPage(page, laptopUrl(SQUAD_SEED, SQUAD));
    await dismissNewMail(page);
    for (let soldier = 1; soldier < WEEK_HIRES.length; soldier++)
      expect(await send(page, { type: 'insure', soldier })).toMatchObject({ ok: true });

    await clickWidget(page, 'personnelButton');
    const first = await waitText(page, 'personnelName', '.+');
    await waitText(page, 'personnelTeamCount', `\\( ${SQUAD.length} \\)`);
    await expectGolden('laptop-personnel', await capture(page));
    await clickWidget(page, 'personnelNext');
    await waitChanged(page, 'personnelName', first);
    await clickWidget(page, 'personnelEmploymentButton');
    await waitText(page, 'personnelEmployment0', '.+');
    await clickWidget(page, 'personnelInventoryButton');
    await waitPressed(page, 'personnelInventoryButton');
    await clickWidget(page, 'personnelPrev');
    await waitText(page, 'personnelName', `^${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

    await openAim(page);
    await aimLink(page, 2);
    await waitVisible(page, 'insuranceContractLink');
    await clickWidget(page, 'insuranceContractLink');
    await waitText(page, 'insuranceNickname0', '.+');
    await waitEnabled(page, 'insuranceAccept0');
    await expectGolden('laptop-insurance-contract', await capture(page));
    const balance = await widgetText(page, 'balance');
    await clickWidget(page, 'insuranceAccept0');
    await waitChanged(page, 'balance', balance);
    await waitEnabled(page, 'insuranceAccept0', false);

    await clickWidget(page, 'historyButton');
    await waitText(page, 'historyPage', '1 / 2$');
    await waitText(page, `historyText${HISTORY_ROWS_PER_PAGE - 1}`, '.+');
    await expectGolden('laptop-history', await capture(page));
    await clickWidget(page, 'nextHistoryPage');
    await waitText(page, 'historyPage', '2 / 2$');
    await waitEnabled(page, 'nextHistoryPage', false);
    await clickWidget(page, 'prevHistoryPage');
    await waitText(page, 'historyPage', '1 / 2$');

    await clickWidget(page, 'filesButton');
    await waitVisible(page, 'fileRow0');
    await clickWidget(page, 'fileRow0');
    await waitVisible(page, 'fileText');
    await waitEnabled(page, 'nextFilePage');
    await expectGolden('laptop-files', await capture(page));
    await clickWidget(page, 'nextFilePage');
    await waitEnabled(page, 'prevFilePage');
  });

  test('every side button and bookmark leads to a finished page, and an order of flowers goes out', async ({ page }) => {
    await openUiPage(page, laptopUrl(SEED, []));
    await dismissNewMail(page);
    const programs: readonly (readonly [string, string])[] = [
      ['emailButton', 'listPage'],
      ['filesButton', 'fileRow0'],
      ['historyButton', 'historyPage'],
      ['personnelButton', 'personnelTeamCount'],
      ['financesButton', 'financePage'],
    ];
    for (const [button, shown] of programs) {
      await clickWidget(page, button);
      await waitVisible(page, shown);
    }

    await openAim(page);
    await expectGolden('laptop-aim-home', await capture(page));
    await clickWidget(page, 'policiesLink');
    await waitVisible(page, 'aimPolicyAgreement1');
    await clickWidget(page, 'aimPolicyAgreement1');
    await waitVisible(page, 'aimPolicyToc0');
    await clickWidget(page, 'aimPolicyToc0');
    await waitText(page, 'aimPolicySectionTitle', '.+');
    await expectGolden('laptop-aim-policies', await capture(page));
    await clickWidget(page, 'aimPolicyMenu3');
    await waitText(page, 'aimPolicySectionTitle', '.+');
    await clickWidget(page, 'aimPolicyMenu1');
    await waitVisible(page, 'historyLink');
    await clickWidget(page, 'historyLink');
    await waitVisible(page, 'aimHistoryToc0');
    await clickWidget(page, 'aimHistoryToc0');
    await waitText(page, 'aimHistoryChapterTitle', '.+');
    await clickWidget(page, 'aimHistoryMenu2');
    await waitVisible(page, 'aimAlumnus0');
    await expectGolden('laptop-aim-alumni', await capture(page));
    await clickWidget(page, 'aimAlumnus0');
    await waitText(page, 'aimAlumniPopupName', '.+');
    await clickWidget(page, `aimAlumniDone${REPEATED}`);
    await waitVisible(page, 'aimAlumniPopupName', false);
    await clickWidget(page, 'aimAlumniPage2');
    await waitVisible(page, 'aimAlumnus10');

    await aimLink(page, 2);
    await waitVisible(page, 'insuranceInfoLink');
    await expectGolden('laptop-insurance-home', await capture(page));
    await clickWidget(page, 'insuranceInfoLink');
    await waitVisible(page, 'insuranceInfoNext');
    await clickWidget(page, 'insuranceInfoNext');
    await waitText(page, 'insuranceInfoTitle', '.+');
    await clickWidget(page, 'insuranceTitleLink');
    await waitVisible(page, 'insuranceCommentsLink');
    await clickWidget(page, 'insuranceCommentsLink');
    await waitText(page, 'insuranceCommentsTitle', '.+');

    await openAim(page);
    await aimLink(page, 1);
    await waitText(page, 'funeralSentence1', '.+');
    await expectGolden('laptop-funeral', await capture(page));
    await clickWidget(page, 'funeralLink3');
    await waitVisible(page, 'funeralCondolences');
    await clickWidget(page, 'funeralRipRegion');
    await waitVisible(page, 'funeralCondolences', false);
    await clickWidget(page, 'funeralLink0');
    await waitVisible(page, 'floristGallery');
    await expectGolden('laptop-florist-home', await capture(page));
    await clickWidget(page, 'floristGallery');
    await waitText(page, 'floristFlowerPrice0', '^\\$');
    await expectGolden('laptop-florist-gallery', await capture(page));
    await clickWidget(page, `floristFlower${FLOWER}`);
    await waitText(page, 'floristOrderNumber', '^[1-9]');
    await clickWidget(page, 'floristDestinationBox');
    await waitVisible(page, `floristDestinationRow${DESTINATION_ROW}`);
    await clickWidget(page, `floristDestinationRow${DESTINATION_ROW}`);
    await waitVisible(page, `floristDestinationRow${DESTINATION_ROW}`, false);
    await clickWidget(page, `floristCheck${BLACK_ROSES_CHECK}`);
    const price = await waitText(page, 'floristPrice', '^\\$');
    await expectGolden('laptop-florist-order', await capture(page));
    const balance = await widgetText(page, 'balance');
    await clickWidget(page, 'floristSend');
    await waitVisible(page, 'floristGallery');
    await waitChanged(page, 'balance', balance);
    expect(price).toMatch(/^\$\d+\.00/);

    await clickWidget(page, 'webButton');
    await waitVisible(page, 'bookmarkRegion0');
    const rows = await bookmarkRows(page);
    expect(rows).toBeGreaterThanOrEqual(4);
    const pages: readonly string[] = ['memberCardLink', 'funeralSentence1', 'floristGallery', 'insuranceCommentsLink'];
    for (let row = 0; row < rows - 1; row++) {
      if (row > 0) {
        await clickWidget(page, 'webButton');
        await waitVisible(page, `bookmarkRegion${row}`);
      }
      await clickWidget(page, `bookmarkRegion${row}`);
      await page.waitForFunction((ids) => window.__ja2Ui.widgets.some((w) => w.visible && ids.includes(w.id ?? '')), pages as string[]);
    }
  });
});
