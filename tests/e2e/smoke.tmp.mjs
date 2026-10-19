import { chromium } from '@playwright/test';

const port = process.argv[2] ?? '5501';
const path = process.argv[3] ?? '/play';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.on('console', (m) => console.log('console:', m.type(), m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${port}${path}`);
await page.waitForFunction(() => window.__ja2Ui?.ready === true || window.__ja2Ui?.error, null, { timeout: 60000 });
const hook = await page.evaluate(() => {
  const h = window.__ja2Ui;
  return { error: h.error, screen: h.screen, modal: h.modal, widgets: h.widgets.map((w) => `${w.id}:${w.kind}:${JSON.stringify(w.rect)}:${w.enabled}:${w.text}`), draw: h.draw };
});
console.log(JSON.stringify(hook, null, 1));
await browser.close();
