import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'stubs/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
