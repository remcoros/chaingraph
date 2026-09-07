import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'tests/*.test.ts'],
    testTimeout: 20000,
  },
});
