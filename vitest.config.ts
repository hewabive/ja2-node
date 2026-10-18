import { defineConfig } from 'vitest/config';

const RELOAD_MODE_TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'stubs/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    ...(process.env.JA2_RELOAD === '1' ? { testTimeout: RELOAD_MODE_TEST_TIMEOUT_MS, hookTimeout: RELOAD_MODE_TEST_TIMEOUT_MS } : {}),
  },
});
