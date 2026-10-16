import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5183;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
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
      JA2_PORT: '7431',
      JA2_WEB_PORT: String(WEB_PORT),
      JA2_TOKEN: 'e2e-token-not-secret-0123456789',
    },
  },
});
