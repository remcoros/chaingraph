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
  await page.getByRole('button', { name: 'Save annotation', exact: true }).click();
  await expect(page.locator('.transaction-view')).toBeVisible();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  await page.getByLabel('Tag name', { exact: true }).fill('Production saved tag');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  const tags = page.getByRole('region', { name: 'Tags and wallet matches' });
  await tags.locator('summary').click();
  await tags.getByRole('checkbox', { name: /Production saved tag/ }).check();
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('Production saved label');
  expect(stored).not.toContain('Production saved tag');
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Save and lock workspace' }).click();
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
  expect(errors, 'production browser errors').toEqual([]);
  console.log(
    'Production browser smoke passed: built WebGL, CSP, transaction view, annotation, tags, encrypted save and reload/unlock.',
  );
} finally {
  await browser.close();
}
