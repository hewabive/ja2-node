import { defineConfig } from 'vitest/config';

const CONTENT_HOOK_TIMEOUT_MS = 60_000;
const LOADED_MACHINE_TEST_TIMEOUT_MS = 30_000;
const RELOAD_MODE_TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'stubs/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    hookTimeout: CONTENT_HOOK_TIMEOUT_MS,
    testTimeout: LOADED_MACHINE_TEST_TIMEOUT_MS,
    ...(process.env.JA2_RELOAD === '1' ? { testTimeout: RELOAD_MODE_TEST_TIMEOUT_MS, hookTimeout: RELOAD_MODE_TEST_TIMEOUT_MS } : {}),
  },
});
