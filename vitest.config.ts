import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    execArgv: ['--no-experimental-webstorage'],
    isolate: true,
    include: [
      'src/**/*.test.{ts,tsx}',
      'server/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    testTimeout: 20000,
    reporters: ['agent'],
  },
});
