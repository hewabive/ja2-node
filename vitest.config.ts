import { defineConfig } from 'vitest/config';

const LOADED_MACHINE_TIMEOUT_MS = 600_000;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'stubs/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/support/run-temp-dir.ts', 'tests/support/build-stub-pack.ts'],
    hookTimeout: LOADED_MACHINE_TIMEOUT_MS,
    testTimeout: LOADED_MACHINE_TIMEOUT_MS,
  },
});
