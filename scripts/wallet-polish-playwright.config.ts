import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '../tests/e2e',
  testMatch: 'wallet-flow-polish.spec.ts',
  outputDir: '../artifacts/wallet-polish/browser-results',
  webServer: undefined,
  use: { ...base.use, baseURL: 'http://127.0.0.1:3126' },
});
