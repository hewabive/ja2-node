import { defineConfig, devices } from '@playwright/test';
import { SERVER_PORT, TOKEN, WEB_PORT } from './tests/e2e/env.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
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
    },
  },
});
