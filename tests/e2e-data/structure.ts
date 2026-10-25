import { expect, type Page } from '@playwright/test';
import { widgets } from '../e2e/ui-capture.ts';

export interface WidgetExpectation {
  readonly id: string;
  readonly enabled?: boolean;
  readonly text?: boolean;
}

export async function expectWidgets(page: Page, expected: readonly (string | WidgetExpectation)[]): Promise<void> {
  const shown = await widgets(page);
  for (const entry of expected) {
    const want: WidgetExpectation = typeof entry === 'string' ? { id: entry } : entry;
    const found = shown.find((w) => w.id === want.id);
    expect(found, `widget ${want.id}`).toBeDefined();
    expect(found?.visible, `${want.id} is visible`).toBe(true);
    if (want.enabled !== undefined) expect(found?.enabled, `${want.id} enabled`).toBe(want.enabled);
    if (want.text) expect(found?.text?.trim() ?? '', `${want.id} has a text`).not.toBe('');
  }
}

const ART_TIMEOUT_MS = 60_000;

export async function expectNoMissingArt(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => ({ images: window.__ja2Ui.draw?.missingImages ?? [], fonts: window.__ja2Ui.draw?.missingFonts ?? [] })),
      { timeout: ART_TIMEOUT_MS },
    )
    .toEqual({ images: [], fonts: [] });
}

export async function expectTextsPresent(page: Page, prefix: string, minimum: number): Promise<void> {
  const texts = (await widgets(page)).filter((w) => w.id.startsWith(prefix) && w.visible && (w.text?.trim() ?? '') !== '');
  expect(texts.length, `visible texts of ${prefix}*`).toBeGreaterThanOrEqual(minimum);
}
