import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';
const password = 'tracing-test-passphrase';
async function create(page: Page, demo = false) {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: demo ? /Explore the CoinJoin laboratory/ : 'New workspace',
      exact: !demo,
    })
    .last()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Public tracing study');
  await dialog.getByLabel('Workspace description').fill('Private investigation details');
  if (!demo) await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByLabel('Confirm password').fill(password);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
}
async function add(page: Page, value: string) {
  await page.getByLabel('Transaction, output, or address').fill(value);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
}
test('lookup prefetch hydrates previous outputs and the spending action follows exact outputs', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await create(page);
  await expect(page.getByLabel('Prefetch previous levels')).toHaveValue('1');
  await add(page, TX_SPENDING);
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  expect(calls.filter((c) => c.method === 'getrawtransaction').map((c) => c.params[0])).toEqual([
    TX_SPENDING,
    TX_FUNDING,
  ]);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('output');
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await page.locator('.entity-row').first().click();
  await expect(
    page
      .locator('.selection-facts > div')
      .filter({ has: page.locator('dt', { hasText: /^Value$/ }) })
      .locator('dd'),
  ).toHaveText('100,000,000 sats');
  await page.getByRole('button', { name: 'Find spending transactions', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '1 spending transaction found; 0 added' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Spending transaction:/ }).click();
  await expect(page.locator('.selection-heading .eyebrow')).toHaveText('TRANSACTION');
  await expect(
    page.locator(`.selection-heading .selection-facts code[title="${TX_SPENDING}"]`),
  ).toBeVisible();
});
test('an unresolved output can load its creating transaction without prefetch', async ({
  page,
}) => {
  await mockBitcoin(page);
  await create(page);
  await page.getByLabel('Prefetch previous levels').selectOption('0');
  await add(page, TX_SPENDING);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('output');
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await page.locator('.entity-row').first().click();
  await expect(
    page
      .locator('.selection-facts > div')
      .filter({ has: page.locator('dt', { hasText: /^Value$/ }) })
      .locator('dd'),
  ).toHaveText('Unknown value');
  await page.getByRole('button', { name: 'Load previous transactions', exact: true }).click();
  await expect(
    page
      .locator('.selection-facts > div')
      .filter({ has: page.locator('dt', { hasText: /^Value$/ }) })
      .locator('dd'),
  ).toHaveText('100,000,000 sats');
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});
test('laboratory reveals incoming and outgoing fixture paths while offline', async ({ page }) => {
  const calls = await mockBitcoin(page, false);
  await create(page, true);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await page.locator('.entity-row').click();
  await page.getByRole('button', { name: 'Load previous transactions', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('153 transactions');
  await page.getByRole('button', { name: 'Find spending transactions', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('183 transactions');
  expect(calls).toHaveLength(0);
});
test('public workspace names survive locking while descriptions remain encrypted and editable', async ({
  page,
}) => {
  await mockBitcoin(page);
  await create(page);
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace details', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Workspace details' });
  await expect(details.getByLabel('Workspace description')).toHaveValue(
    'Private investigation details',
  );
  await details.getByLabel('Name (public)', { exact: true }).fill('Recognizable locked study');
  await details.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toContainText('Recognizable locked study');
  await expect(page.locator('body')).not.toContainText('Private investigation details');
  const raw = await page.evaluate(() => localStorage.getItem('chaingraph.encrypted-workspaces.v1'));
  expect(raw).toContain('Recognizable locked study');
  expect(raw).not.toContain('Private investigation details');
  await page.reload();
  await expect(page.locator('.saved-row')).toContainText('Recognizable locked study');
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(password);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.workspace-description')).toContainText(
    'Private investigation details',
  );
});
