import { expect, test } from '@playwright/test';
import { capture, clickWidget, devicePoint, expectGolden, nextFrames, openUiPage, widget, widgets, widgetText } from './ui-capture.ts';

const GALLERY = '/src/devtools/ui-gallery/';
const GALLERY_TEST_TIMEOUT_MS = 90_000;

test.describe.configure({ timeout: GALLERY_TEST_TIMEOUT_MS });

test.describe('the widget gallery on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test('lists the live widget tree and draws exactly like the golden', async ({ page }) => {
    await openUiPage(page, `${GALLERY}?pinClock=1`);
    const tree = await widgets(page);
    for (const id of ['push', 'toggle', 'choice0', 'sound', 'hotspot', 'volume', 'name', 'menu', 'loadBar', 'status', 'textBox'])
      expect(tree.map((w) => w.id)).toContain(id);
    expect(await widget(page, 'push')).toMatchObject({
      kind: 'button:quick',
      rect: { x: 8, y: 46, width: 61, height: 20 },
      visible: true,
      enabled: true,
    });
    expect(await widget(page, 'disabledDefault')).toMatchObject({ enabled: false });
    const draw = await page.evaluate(() => window.__ja2Ui.draw);
    expect(draw?.missingImages).toEqual([]);
    expect(draw?.missingFonts).toEqual([]);
    expect(await page.evaluate(() => window.__ja2Ui.dataVersion)).toBe('stubs');
    await expectGolden('gallery', await capture(page));
  });

  test('turns clicks on widgets into actions and plays the button sounds', async ({ page }) => {
    await openUiPage(page, `${GALLERY}?pinClock=1`);
    await clickWidget(page, 'push');
    expect(await widgetText(page, 'status')).toBe('push 1');
    await clickWidget(page, 'choice2');
    expect(await widgetText(page, 'status')).toBe('choice 2');
    expect((await widget(page, 'choice2')).state).toBe(true);
    expect((await widget(page, 'choice0')).state).toBe(false);
    await clickWidget(page, 'toggle');
    expect((await widget(page, 'toggle')).state).toBe(true);
    await clickWidget(page, 'disabledHatched');
    const sounds = await page.evaluate(() => window.__ja2Ui.sounds.map((s) => ('sample' in s ? s.sample : s.file)));
    expect(sounds).toContain('BIG_SWITCH3_IN');
    expect(sounds.at(-1)).toBe('sounds/disabled button.wav');
  });

  test('drives the popup menu by its hotkey and the message box by its buttons and keys', async ({ page }) => {
    await openUiPage(page, `${GALLERY}?pinClock=1`);
    await page.keyboard.press('Alt+KeyM');
    await nextFrames(page);
    expect((await widget(page, 'menu')).visible).toBe(true);
    await clickWidget(page, 'menu.line3');
    expect(await widgetText(page, 'status')).toBe('menu open');
    await clickWidget(page, 'menu.line0');
    expect(await widgetText(page, 'status')).toBe('menu Doctor');
    await clickWidget(page, 'box0');
    expect(await page.evaluate(() => window.__ja2Ui.modal)).toBe('boxYesNo');
    await expectGolden('gallery-message-box', await capture(page));
    await clickWidget(page, 'boxYesNo.no');
    expect(await widgetText(page, 'status')).toBe('box result 3');
    await clickWidget(page, 'box2');
    await page.keyboard.press('Digit4');
    await nextFrames(page);
    expect(await widgetText(page, 'status')).toBe('box result 4');
    expect(await page.evaluate(() => window.__ja2Ui.modal)).toBeNull();
  });

  test('edits the text field, drags the slider and shows the cursor of each region', async ({ page }) => {
    await openUiPage(page, `${GALLERY}?pinClock=1`);
    await clickWidget(page, 'name');
    await page.keyboard.press('End');
    await page.keyboard.type('a!');
    await nextFrames(page);
    expect(await widgetText(page, 'name')).toBe('Ivana!');
    const slider = (await widget(page, 'volume')).rect;
    const top = await devicePoint(page, slider.x + 20, slider.y);
    const bottom = await devicePoint(page, slider.x + 20, slider.y + slider.height + 40);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await nextFrames(page);
    expect(await widgetText(page, 'status')).toBe('volume 127');
    await page.mouse.move(bottom.x, bottom.y);
    await nextFrames(page);
    await page.mouse.up();
    expect(await widgetText(page, 'status')).toBe('volume 0');
    const ibeam = (await widget(page, 'cursorIbeam')).rect;
    const at = await devicePoint(page, ibeam.x + 4, ibeam.y + 4);
    await page.mouse.move(at.x, at.y);
    await nextFrames(page);
    expect(await page.evaluate(() => window.__ja2Ui.cursor)).toMatchObject({ name: 'CURSOR_IBEAM', visible: true });
  });
});

test.describe('the widget gallery with a running clock', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test('shows fast help after resting on a button, fades and zooms', async ({ page }) => {
    await openUiPage(page, GALLERY);
    const push = (await widget(page, 'push')).rect;
    const at = await devicePoint(page, push.x + 5, push.y + 5);
    const baseline = await page.evaluate(() => window.__ja2Ui.draw?.multiplyAreas.length ?? 0);
    await page.mouse.move(at.x, at.y);
    await page.waitForFunction((n) => (window.__ja2Ui.draw?.multiplyAreas.length ?? 0) >= n + 2, baseline);
    await clickWidget(page, 'fade');
    await page.waitForFunction(() => window.__ja2Ui.widgets.find((w) => w.id === 'status')?.text === 'fade done');
    await clickWidget(page, 'zoom');
    await page.waitForFunction(() => window.__ja2Ui.widgets.find((w) => w.id === 'status')?.text === 'zoom done');
  });
});
