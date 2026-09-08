import { chromium, expect } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockBitcoin, TX_SPENDING } from '../tests/fixtures/bitcoin';

// This checks real built assets and CSP, while isolating chain requests from any personal data.
const base = process.env.CHAINGRAPH_SMOKE_URL ?? 'http://127.0.0.1:4300';
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(cache)
    ? readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(cache, name, 'chrome-linux64/chrome'))
        .find(existsSync)
    : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await mockBitcoin(page);
  await page.goto(base);
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const create = page.getByRole('dialog', { name: 'Create a workspace' });
  await create.getByLabel('Name (public)', { exact: true }).fill('Production smoke');
  await create.getByLabel('Bitcoin network').selectOption('mainnet');
  await create.getByLabel('Password', { exact: true }).fill('public-production-test-passphrase');
  await create.getByLabel('Confirm password').fill('public-production-test-passphrase');
  await create.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await page.getByLabel('Prefetch previous levels').selectOption('1');
  await page.getByLabel('Transaction, output, or address').fill(TX_SPENDING);
  await page.getByRole('button', { name: 'Add to graph' }).click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await expect(page.locator('canvas')).toBeVisible();
  await page
    .locator('.transaction-view')
    .getByRole('button', { name: /^Output 0:/ })
    .click();
  await page.getByLabel('Node label').fill('Production saved label');
  await expect(page.locator('.transaction-view')).toBeVisible();
  const tags = page.getByRole('region', { name: 'Tags and wallet matches' });
  await tags.getByRole('button', { name: 'Add or choose tags' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose tags' });
  await picker.getByLabel('Find or create tag').fill('Production saved tag');
  await picker.getByLabel('Find or create tag').press('Enter');
  await expect(picker.getByRole('checkbox', { name: 'Production saved tag' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  expect(
    workerUrls.some((url) => {
      const parsed = new URL(url);
      return (
        parsed.origin === new URL(base).origin &&
        /\/assets\/workspaceEncryption\.worker-[^/]+\.js$/.test(parsed.pathname)
      );
    }),
    'production encrypted saves use the bundled same-origin worker under CSP',
  ).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('Production saved label');
  expect(stored).not.toContain('Production saved tag');
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await expect(page.locator('.saved-row')).toBeVisible();
  await page.reload();
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill('public-production-test-passphrase');
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Production saved label');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await page.locator('.entity-row').click();
  await expect(page.locator('.transaction-view')).toContainText('Production saved label');
  await expect(page.getByRole('region', { name: 'Tags and wallet matches' })).toContainText(
    'Production saved tag',
  );
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.locator('.tag-card')).toContainText('Production saved tag');
  await expect(page.locator('.tag-card')).toContainText(/1 loaded entit(?:y|ies)/);
  await page.getByRole('button', { name: 'Help and samples', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Example workspaces', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create An on-chain message workspace', exact: true })
    .click();
  const example = page.getByRole('dialog', { name: 'Create a workspace' });
  await expect(example.getByLabel('Bitcoin network')).toHaveValue('mainnet');
  await example.getByLabel('Password', { exact: true }).fill('public-production-test-passphrase');
  await example.getByLabel('Confirm password').fill('public-production-test-passphrase');
  await example.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('OP_RETURN text');
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  expect(
    workerUrls.some((url) =>
      /\/assets\/templateWorkspace\.worker-[^/]+\.js$/.test(new URL(url).pathname),
    ),
    'production template snapshot loads and validates in its bundled worker under CSP',
  ).toBe(true);
  expect(errors, 'production browser errors').toEqual([]);
  console.log(
    'Production browser smoke passed: built WebGL, CSP, bundled encryption worker, transaction view, annotation, tags, encrypted save and reload/unlock, real template creation.',
  );
} finally {
  await browser.close();
}
