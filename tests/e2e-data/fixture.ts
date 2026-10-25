import { test as base, expect } from '@playwright/test';
import { ORIGINAL_DATA_MODE } from '../e2e/env.ts';
import { NO_ORIGINAL_DATA_PICTURES } from '../e2e/ui-capture.ts';

function refuseCaptureInThePage(refusal: string): void {
  let hook: { capture?: unknown } | undefined;
  const refuse = () => {
    throw new Error(refusal);
  };
  Object.defineProperty(window, '__ja2Ui', {
    configurable: false,
    get: () => hook,
    set: (value: { capture?: unknown }) => {
      Object.defineProperty(value, 'capture', { value: refuse, writable: false, configurable: false });
      hook = value;
    },
  });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    if (!ORIGINAL_DATA_MODE) throw new Error('the original-data structural tests run only with JA2_E2E_DATA_DIR');
    await page.addInitScript(refuseCaptureInThePage, NO_ORIGINAL_DATA_PICTURES);
    page.screenshot = () => Promise.reject(new Error(NO_ORIGINAL_DATA_PICTURES));
    await use(page);
  },
});

export { expect };
