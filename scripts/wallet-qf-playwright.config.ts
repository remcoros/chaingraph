import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

/** Opt-in public-demo retest against the already running review preview. */
export default defineConfig({
  ...base,
  testDir: '../tests/e2e',
  testMatch: 'wallet-qf-findings.spec.ts',
  outputDir: '../artifacts/wallet-clean-qf/browser-results',
  webServer: undefined,
  use: { ...base.use, baseURL: 'http://127.0.0.1:3123' },
});
