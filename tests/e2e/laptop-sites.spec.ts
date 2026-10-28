import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { LAPTOP_SITES_SAVE, writeLaptopSitesSave } from '../support/e2e-laptop-saves.ts';
import { MCP_CALL_OPTIONS, SAVE_DIR, SERVER, TOKEN } from './env.ts';
import { capture, clickWidget, expectGolden, nextFrames, openUiPage, widgets, widgetText } from './ui-capture.ts';

declare global {
  interface Window {
    __ja2Laptop?: { session: string | null; closed: boolean };
  }
}

const LAPTOP = '/src/devtools/laptop/';
const BOBBY_RAY_ROW = 1;
const MERC_ROW = 2;
const IMP_ROW = 3;
const DRASSEN_ROW = 2;
const DELIVERY_SECONDS = 5 * 24 * 3600;
const IMP_CODE = 'XEP624';
const MERCS_AFTER_IMP = 3;

async function loadSession(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sessions', { data: { load: LAPTOP_SITES_SAVE } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}

async function closeSession(page: Page): Promise<void> {
  const session = await page.evaluate(() => window.__ja2Laptop?.session ?? null);
  if (session) await page.evaluate(async (id) => fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }), session);
}

async function shown(page: Page, id: string, visible = true): Promise<void> {
  await page.waitForFunction(
    ([wanted, state]) =>
      window.__ja2Ui.widgets.some((w) => w.id === wanted && w.visible === state) ||
      (!state && !window.__ja2Ui.widgets.some((w) => w.id === wanted)),
    [id, visible] as const,
  );
}

async function enabled(page: Page, id: string): Promise<boolean> {
  return (await widgets(page)).some((w) => w.id === id && w.visible && w.enabled);
}

async function through(page: Page, id: string, next: string): Promise<void> {
  await clickWidget(page, id);
  await shown(page, next);
}

async function dismissModal(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ja2Ui.modal !== null);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__ja2Ui.modal === null);
  await nextFrames(page);
}

async function openSite(page: Page, session: string, row: number, first: string): Promise<void> {
  await openUiPage(page, `${LAPTOP}?session=${encodeURIComponent(session)}&pinClock=1&wait=0&slide=0&scale=2`);
  if ((await widgets(page)).some((w) => w.id === 'newMailOk' && w.visible)) await clickWidget(page, 'newMailOk');
  await clickWidget(page, 'webButton');
  if (!(await widgets(page)).some((w) => w.id === `bookmarkRegion${row}` && w.visible)) await clickWidget(page, 'webButton');
  await through(page, `bookmarkRegion${row}`, first);
}

async function mcp(): Promise<{ call: (name: string, args: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void> }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-laptop-sites', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  return {
    call: async (name, args) => {
      const result = await client.callTool({ name, arguments: args }, undefined, MCP_CALL_OPTIONS);
      return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
    },
    close: () => client.close(),
  };
}

test.describe('the laptop sites on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });
  test.beforeAll(async () => {
    await writeLaptopSitesSave(SAVE_DIR);
  });
  test.afterEach(async ({ page }) => closeSession(page));

  test("orders from Bobby Ray's catalogue through the drop-down and receives the shipment in Drassen", async ({ page, request }) => {
    const session = await loadSession(request);
    await openSite(page, session, BOBBY_RAY_ROW, 'bobbyRaySign2');
    await through(page, 'bobbyRaySign2', 'itemName0');
    await clickWidget(page, 'bigImage0');
    await page.waitForFunction(() => window.__ja2Ui.widgets.find((w) => w.id === 'onOrder0')?.text?.trim() === '1');
    await expectGolden('laptop-bobby-ray-guns', await capture(page));
    await through(page, 'bobbyRayOrderForm', 'orderQuantity0');
    await clickWidget(page, 'cityDropDownToggle');
    await shown(page, `cityDropDown.row${DRASSEN_ROW}`);
    await clickWidget(page, `cityDropDown.row${DRASSEN_ROW}`);
    await page.waitForFunction(() => window.__ja2Ui.widgets.find((w) => w.id === 'shippingCity')?.text === 'Drassen');
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'acceptOrder' && w.enabled));
    await expectGolden('laptop-bobby-ray-order', await capture(page));
    await clickWidget(page, 'acceptOrder');
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'confirmOrderArea' && w.enabled));
    await through(page, 'confirmOrderArea', 'bobbyRaySign2');
    await through(page, 'bobbyRaySign2', 'itemName0');
    await through(page, 'bobbyRayOrderForm', 'orderShipments');
    await through(page, 'orderShipments', 'shipmentRow0');
    await expectGolden('laptop-bobby-ray-shipments', await capture(page));

    const game = await mcp();
    try {
      expect(await game.call('act', { session, command: { type: 'closeLaptop' } })).toMatchObject({ ok: true });
      const report = (await game.call('advance', { session, worldSeconds: DELIVERY_SECONDS, compressionStopped: false })) as {
        events: { type: string; sector?: string }[];
      };
      expect(report.events.find((e) => e.type === 'shipmentDelivered')).toMatchObject({ sector: 'B13' });
    } finally {
      await game.close();
    }
  });

  test('opens a M.E.R.C. account, hires from the files and pays the bill', async ({ page, request }) => {
    const session = await loadSession(request);
    await openSite(page, session, MERC_ROW, 'mercAccountButton');
    await shown(page, 'speckVideoTitle');
    await expectGolden('laptop-merc-home', await capture(page));
    await clickWidget(page, 'speckClose');
    await through(page, 'mercAccountButton', 'mercOpenAccount');
    await clickWidget(page, 'mercOpenAccount');
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'mercFilesButton' && w.visible && w.enabled));
    await through(page, 'mercFilesButton', 'mercFileName');
    expect(await widgetText(page, 'mercSalary')).toMatch(/^\d+ /);
    await expectGolden('laptop-merc-files', await capture(page));
    await clickWidget(page, 'mercHire');
    await dismissModal(page);
    await through(page, 'mercAccountButton', 'accountCharge0');
    expect(await widgetText(page, 'accountCharge0')).toMatch(/^\$ +\d+$/);
    await clickWidget(page, 'mercAuthorize');
    await page.waitForFunction(() => window.__ja2Ui.modal !== null);
    await page.keyboard.press('y');
    await shown(page, 'speckVideoTitle');
    expect(await enabled(page, 'mercFilesButton')).toBe(true);
  });

  test('creates an I.M.P. character through every page', async ({ page, request }) => {
    const session = await loadSession(request);
    await openSite(page, session, IMP_ROW, 'impHomeTitle');
    await expectGolden('laptop-imp-home', await capture(page));
    await clickWidget(page, 'impCode');
    await page.keyboard.type(IMP_CODE);
    await page.keyboard.press('Enter');
    await shown(page, 'impMainTitle');
    await through(page, 'impBegin', 'impBeginTitle');
    await clickWidget(page, 'impFullName');
    await page.keyboard.type('Ivana Testova');
    await clickWidget(page, 'impFemaleBox');
    await shown(page, 'impFemaleMark');
    await through(page, 'impBeginDone', 'impMainTitle');
    await through(page, 'impProfile0', 'impPersonalityTitle');
    await through(page, 'impPersonalityBegin', 'impQuizTitle');
    for (let q = 1; q <= 16; q++) {
      await page.waitForFunction((n) => window.__ja2Ui.widgets.find((w) => w.id === 'impQuestionNumber')?.text === String(n), q);
      await clickWidget(page, 'impAnswer1');
      if (q === 1) await expectGolden('laptop-imp-quiz', await capture(page));
      await clickWidget(page, 'impQuizConfirm');
    }
    await shown(page, 'impPersonalityQuestion');
    await clickWidget(page, 'impPersonalityNo');
    await through(page, 'impPersonalityOk', 'impMainTitle');
    await through(page, 'impProfile1', 'impAttributeEntranceTitle');
    await through(page, 'impAttributeEntranceBegin', 'impAttributesTitle');
    await clickWidget(page, 'impIncrease3');
    await page.waitForFunction(() => window.__ja2Ui.widgets.find((w) => w.id === 'impAttributeValue3')?.text === '56');
    await expectGolden('laptop-imp-attributes', await capture(page));
    await through(page, 'impAttributesFinish', 'impAttributeFinishTitle');
    await through(page, 'impAttributesYes', 'impMainTitle');
    await through(page, 'impProfile2', 'impPortraitTitle');
    await through(page, 'impPortraitDone', 'impMainTitle');
    await through(page, 'impProfile3', 'impVoiceTitle');
    await through(page, 'impVoiceDone', 'impFinishName');
    expect(await widgetText(page, 'impFinishName')).toContain('Ivana Testova');
    await expectGolden('laptop-imp-finish', await capture(page));
    await through(page, 'impFinishDone', 'impConfirmTitle');
    await clickWidget(page, 'impConfirmYes');
    await shown(page, 'impHomeTitle');
    const game = await mcp();
    try {
      const view = (await game.call('observe', { session })) as {
        strategic?: { mercs: unknown[] };
        laptop?: { imp: { canCreate: boolean } };
      };
      expect(view.strategic?.mercs).toHaveLength(MERCS_AFTER_IMP);
      expect(view.laptop?.imp.canCreate).toBe(false);
    } finally {
      await game.close();
    }
  });
});
