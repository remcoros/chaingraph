import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.CHAINGRAPH_E2E_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('CHAINGRAPH_E2E_PORT must be an integer between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
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
    command: `npm exec vite -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
