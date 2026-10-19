import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { encodePngRgba } from '../../src/content/formats/png.ts';

const port = process.argv[2] ?? '5501';
const out = process.argv[3];
const steps = JSON.parse(process.argv[4] ?? '[]');
const path = process.argv[5] ?? '/play';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console error:', m.text());
});
await page.goto(`http://127.0.0.1:${port}${path}`);
await page.waitForFunction(() => window.__ja2Ui?.ready === true || window.__ja2Ui?.error, null, { timeout: 60000 });
const frames = async (n = 3) => {
  const start = await page.evaluate(() => window.__ja2Ui.frameCount);
  await page.waitForFunction((s) => window.__ja2Ui.frameCount > s, start + n);
};
const point = async (x, y) => {
  const view = await page.evaluate(() => ({ scale: window.__ja2Ui.scale, logical: window.__ja2Ui.logical }));
  const box = await page.locator('#screen').boundingBox();
  const ox = (box.width - view.logical.width * view.scale) / 2;
  const oy = (box.height - view.logical.height * view.scale) / 2;
  return { x: box.x + ox + x * view.scale + view.scale / 2, y: box.y + oy + y * view.scale + view.scale / 2 };
};
let shot = 0;
for (const step of steps) {
  if (step.click) {
    await page.waitForFunction((id) => window.__ja2Ui.widgets.some((w) => w.id === id && w.visible), step.click, { timeout: 20000 });
    const w = await page.evaluate((id) => window.__ja2Ui.widgets.find((x) => x.id === id), step.click);
    const p = await point(w.rect.x + Math.floor(w.rect.width / 2), w.rect.y + Math.floor(w.rect.height / 2));
    await page.mouse.move(p.x, p.y);
    await frames();
    await page.mouse.down();
    await frames();
    await page.mouse.up();
    await frames();
  }
  if (step.at) {
    const p = await point(step.at[0], step.at[1]);
    await page.mouse.move(p.x, p.y);
    await frames();
  }
  if (step.key) {
    await page.keyboard.press(step.key);
    await frames();
  }
  if (step.type) {
    await page.keyboard.type(step.type);
    await frames();
  }
  if (step.wait) await page.waitForFunction((s) => window.__ja2Ui.screen === s, step.wait, { timeout: 60000 });
  if (step.waitModal !== undefined) await page.waitForFunction((s) => window.__ja2Ui.modal === s, step.waitModal, { timeout: 60000 });
  if (step.sleep) await page.waitForTimeout(step.sleep);
  if (step.shot) {
    await frames();
    const pixels = await page.evaluate(() => window.__ja2Ui.capture());
    writeFileSync(`${out}-${shot++}.png`, encodePngRgba(pixels.width, pixels.height, new Uint8Array(Buffer.from(pixels.rgba, 'base64'))));
  }
  if (step.dump) {
    const hook = await page.evaluate(() => {
      const h = window.__ja2Ui;
      return { error: h.error, screen: h.screen, modal: h.modal, session: h.session, widgets: h.widgets.map((w) => `${w.id}:${w.kind}:${w.visible}:${w.enabled}:${w.state}:${w.text}`) };
    });
    console.log(JSON.stringify(hook));
  }
}
await browser.close();
