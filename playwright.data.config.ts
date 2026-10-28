import { defineConfig, devices } from '@playwright/test';
import {
  DATA_DIR,
  DATA_SAVE_DIR,
  E2E_EXPECT_TIMEOUT_MS,
  E2E_LONG_TEST_TIMEOUT_MS,
  E2E_MAX_SESSIONS,
  E2E_SERVER_START_TIMEOUT_MS,
  SERVER_PORT,
  TOKEN,
  WEB_PORT,
} from './tests/e2e/env.ts';

const SETTINGS_KEY = 'ja2-node:settings';
const SETTINGS_WITHOUT_HELP = JSON.stringify({ version: 2, helpHidden: true });

if (!DATA_DIR) throw new Error('set JA2_E2E_DATA_DIR to the game Data folder to run the original-data structural tests');

export default defineConfig({
  testDir: 'tests/e2e-data',
  fullyParallel: false,
  workers: 1,
  timeout: E2E_LONG_TEST_TIMEOUT_MS,
  expect: { timeout: E2E_EXPECT_TIMEOUT_MS },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1280, height: 960 },
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    storageState: {
      cookies: [],
      origins: [{ origin: `http://127.0.0.1:${WEB_PORT}`, localStorage: [{ name: SETTINGS_KEY, value: SETTINGS_WITHOUT_HELP }] }],
    },
  },
  projects: [{ name: 'chromium-original-data', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 960 } } }],
  webServer: {
    command: 'node tools/dev.ts',
    url: `http://127.0.0.1:${WEB_PORT}/`,
    reuseExistingServer: false,
    timeout: E2E_SERVER_START_TIMEOUT_MS,
    env: {
      JA2_DATA_DIR: DATA_DIR,
      JA2_PORT: String(SERVER_PORT),
      JA2_WEB_PORT: String(WEB_PORT),
      JA2_TOKEN: TOKEN,
      JA2_SAVE_DIR: DATA_SAVE_DIR,
      JA2_MAX_SESSIONS: String(E2E_MAX_SESSIONS),
    },
  },
});
