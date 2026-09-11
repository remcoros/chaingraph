import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.CHAINGRAPH_E2E_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('CHAINGRAPH_E2E_PORT must be an integer between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
const preview = process.env.CHAINGRAPH_E2E_PREVIEW === '1';
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const cachedChromium = existsSync(cache)
  ? readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(cache, name, 'chrome-linux64/chrome'))
      .find((file) => existsSync(file))
  : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/browser-qa',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? cachedChromium,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    // React Compiler runs on `build` only (see vite.config.ts), so the dev
    // server never exercises compiled output. CHAINGRAPH_E2E_PREVIEW=1 builds
    // and serves the production bundle instead, which is how the compiled code
    // gets end-to-end coverage.
    command: preview
      ? `npm exec vite -- build && npm exec vite -- preview --host 127.0.0.1 --port ${port} --strictPort`
      : `npm exec vite -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
