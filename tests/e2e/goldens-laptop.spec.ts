import { test } from '@playwright/test';
import { clickVisible, waitVisible } from './play-flow.ts';
import { capture, clickWidget, expectGolden, openUiPage, widgets } from './ui-capture.ts';

declare global {
  interface Window {
    __ja2Laptop?: { session: string | null; closed: boolean };
  }
}

const LAPTOP = '/src/devtools/laptop/?seed=7&pinClock=1&wait=0&slide=0&scale=2';
const MEMBER = 'Marlow';

test.describe('goldens of the A.I.M. pages on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test.afterEach(async ({ page }) => {
    const session = await page.evaluate(() => window.__ja2Laptop?.session ?? null);
    if (session) await page.evaluate(async (id) => fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }), session);
  });

  test('the sort page, the mug shots and a member page', async ({ page }) => {
    await openUiPage(page, LAPTOP);
    await clickVisible(page, 'newMailOk');
    await waitVisible(page, 'newMailOk', false);
    await clickWidget(page, 'webButton');
    await clickVisible(page, 'bookmarkRegion0');
    await clickVisible(page, 'memberCardLink');
    await waitVisible(page, 'toMugShotsLink');
    await expectGolden('laptop-aim-sort', await capture(page));
    await clickWidget(page, 'toMugShotsLink');
    await waitVisible(page, 'mugRegion0_0');
    await expectGolden('laptop-aim-mugshots', await capture(page));
    const mug = (await widgets(page)).find((w) => w.id.startsWith('mugName') && w.text === MEMBER);
    if (!mug) throw new Error(`no mug shot of ${MEMBER}`);
    await clickWidget(page, mug.id.replace('mugName', 'mugRegion'));
    await waitVisible(page, 'aimContact');
    await expectGolden('laptop-aim-member', await capture(page));
  });
});
