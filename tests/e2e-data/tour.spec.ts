import type { APIRequestContext, Page } from '@playwright/test';
import { clickVisible, imagesLoaded, modalIs, openTacticalSession, rightClickWidget, screenIs, waitVisible } from '../e2e/play-flow.ts';
import { clickWidget, nextFrames, openUiPage } from '../e2e/ui-capture.ts';
import { expect, test } from './fixture.ts';
import { expectNoMissingArt, expectTextsPresent, expectWidgets } from './structure.ts';

const LAPTOP = '/src/devtools/laptop/?seed=7&wait=0&slide=0&scale=2';
const OPTION_TOGGLES = 23;
const MUG_SHOTS = 'mugRegion0_0';
const HAND = 5;
const STEP_TIMEOUT_MS = 120_000;

async function newSandbox(request: APIRequestContext): Promise<string> {
  return ((await (await request.post('/api/sessions', { data: {} })).json()) as { session: string }).session;
}

async function failedVfsReads(page: Page): Promise<string[]> {
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/vfs/')) failed.push(`${response.status()} ${response.url()}`);
  });
  return failed;
}

test.describe('a structural tour of the screens on the original data (no picture is taken)', () => {
  test.beforeEach(({ page }) => {
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
  });

  test('the front end: main menu, game init, options, save/load and credits', async ({ page }) => {
    const failed = await failedVfsReads(page);
    await openUiPage(page, '/play');
    await screenIs(page, 'mainMenu');
    await expectWidgets(page, ['newGame', 'loadGame', 'preferences', 'credits', 'quit']);
    expect(await page.evaluate(() => window.__ja2Ui.dataVersion)).not.toBe('stubs');
    await expectNoMissingArt(page);
    await clickWidget(page, 'newGame');
    await screenIs(page, 'gameInit');
    await expectWidgets(page, ['difficulty0', 'difficulty1', 'difficulty2', 'start', 'cancel']);
    await expectNoMissingArt(page);
    await page.keyboard.press('Escape');
    await screenIs(page, 'mainMenu');
    await page.keyboard.press('KeyO');
    await screenIs(page, 'options');
    await expectWidgets(page, ['effectsVolume', 'speechVolume', 'musicVolume', { id: 'done', enabled: true }]);
    for (let i = 0; i < OPTION_TOGGLES; i++) await expectWidgets(page, [`toggle${i}`]);
    await expectTextsPresent(page, 'toggleLabel', OPTION_TOGGLES);
    await expectNoMissingArt(page);
    await page.keyboard.press('Escape');
    await screenIs(page, 'mainMenu');
    await page.keyboard.press('KeyS');
    await screenIs(page, 'credits');
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'roll'));
    await expectNoMissingArt(page);
    await page.keyboard.press('Escape');
    await screenIs(page, 'mainMenu');
    expect(failed).toEqual([]);
  });

  test('the laptop pages of a new campaign', async ({ page }) => {
    await openUiPage(page, LAPTOP);
    expect(await page.evaluate(() => window.__ja2Ui.screen)).toBe('laptop');
    await clickVisible(page, 'newMailOk');
    await waitVisible(page, 'newMailOk', false);
    const programs: readonly (readonly [string, string])[] = [
      ['emailButton', 'listPage'],
      ['financesButton', 'financePage'],
      ['personnelButton', 'personnelTeamCount'],
      ['historyButton', 'historyPage'],
      ['filesButton', 'fileRow0'],
    ];
    for (const [button, shown] of programs) {
      await clickWidget(page, button);
      await waitVisible(page, shown);
      await expectNoMissingArt(page);
    }
    await expectWidgets(page, [{ id: 'fileRow0', text: true }]);
    await clickWidget(page, 'webButton');
    await clickVisible(page, 'bookmarkRegion0');
    await waitVisible(page, 'memberCardLink');
    await expectNoMissingArt(page);
    await clickWidget(page, 'memberCardLink');
    await clickVisible(page, 'toMugShotsLink');
    await waitVisible(page, MUG_SHOTS);
    await expectTextsPresent(page, 'mugName', 8);
    await expectNoMissingArt(page);
    await clickWidget(page, MUG_SHOTS);
    await waitVisible(page, 'aimContact');
    await expectNoMissingArt(page);
    await clickWidget(page, 'aimLogo');
    await clickVisible(page, 'linksLink');
    for (const [link, shown] of [
      [1, 'funeralSentence1'],
      [2, 'insuranceInfoLink'],
    ] as const) {
      await clickVisible(page, `aimLink${link}`);
      await waitVisible(page, shown);
      await expectNoMissingArt(page);
      await clickWidget(page, 'webButton');
      await clickVisible(page, 'bookmarkRegion0');
      await clickVisible(page, 'aimLogo');
      await clickVisible(page, 'linksLink');
    }
  });

  test('the tactical screen of the A9 sandbox: panels, inventory, the description box and the overhead map', async ({ page, request }) => {
    const session = await newSandbox(request);
    try {
      await openTacticalSession(page, session);
      const hook = await page.evaluate(() => window.__ja2Ui.tactical);
      expect(hook?.map).toMatch(/a9\.dat$/i);
      expect(hook?.panel).toBe('team');
      expect(hook?.faces.length).toBeGreaterThan(0);
      await expectWidgets(page, ['teamFaceRegion0', 'teamMapScreen', 'teamEndTurn', 'teamSquad']);
      await expectNoMissingArt(page);
      await clickWidget(page, 'teamFaceRegion0');
      await rightClickWidget(page, 'teamFaceRegion0');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.panel === 'sm');
      await imagesLoaded(page);
      await expectWidgets(page, [`slot${HAND}`, 'smHand', 'smMoney']);
      await expectNoMissingArt(page);
      await rightClickWidget(page, `slot${HAND}`);
      await page.waitForFunction(() => window.__ja2Ui.tactical?.descriptionOpen === true);
      await imagesLoaded(page);
      expect(await page.evaluate(() => window.__ja2Ui.tactical?.descriptionItem)).not.toBeNull();
      await expectNoMissingArt(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.descriptionOpen === false);
      await page.keyboard.press('Insert');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.overheadOpen === true);
      await nextFrames(page, 4);
      await expectNoMissingArt(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.overheadOpen === false);
      await modalIs(page, null);
      const refused = await page.evaluate(() => window.__ja2Ui.tactical?.commands.filter((c) => !c.ok) ?? []);
      expect(refused).toEqual([]);
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });
});
