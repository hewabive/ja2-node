import { defineConfig } from 'vitest/config';
import { UNIT_TEST_TIMEOUT_MS } from './tests/support/patience.ts';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'stubs/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/support/run-temp-dir.ts', 'tests/support/build-stub-pack.ts'],
    hookTimeout: UNIT_TEST_TIMEOUT_MS,
    testTimeout: UNIT_TEST_TIMEOUT_MS,
  },
});
