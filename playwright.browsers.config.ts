import { defineConfig, devices } from '@playwright/test';
import { E2E_MAX_SESSIONS, SAVE_DIR, SERVER_PORT, TOKEN, WEB_PORT } from './tests/e2e/env.ts';

const BROWSER_TEST_TIMEOUT_MS = 600_000;
const DESKTOP_PIXEL_RATIOS = [1, 1.25, 1.5, 2];
const SAFARI_PIXEL_RATIOS = [1, 2];
const WEBGL_WITHOUT_GPU = { 'webgl.force-enabled': true };
const SCREENSHOT_REPAINTS_CANVAS = 'keepDrawingBuffer=1';

export default defineConfig({
  testDir: 'tests/e2e-browsers',
  fullyParallel: false,
  workers: 1,
  timeout: BROWSER_TEST_TIMEOUT_MS,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, metadata: { pixelRatios: DESKTOP_PIXEL_RATIOS } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], headless: false, launchOptions: { firefoxUserPrefs: WEBGL_WITHOUT_GPU } },
      metadata: { pixelRatios: DESKTOP_PIXEL_RATIOS },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      metadata: { pixelRatios: SAFARI_PIXEL_RATIOS, query: SCREENSHOT_REPAINTS_CANVAS },
    },
  ],
  webServer: {
    command: 'node tools/dev.ts',
    url: `http://127.0.0.1:${WEB_PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      JA2_DATA_DIR: '',
      JA2_PORT: String(SERVER_PORT),
      JA2_WEB_PORT: String(WEB_PORT),
      JA2_TOKEN: TOKEN,
      JA2_SAVE_DIR: SAVE_DIR,
      JA2_MAX_SESSIONS: String(E2E_MAX_SESSIONS),
    },
  },
});
