import { openFixtureWorkspace, openLaboratoryFixture } from '../fixtures/open-workspace';
import { laboratoryWorkspace } from '../fixtures/laboratory';
import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';
const password = 'tracing-test-passphrase';
async function create(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'New workspace',
      exact: true,
    })
    .last()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Public tracing study');
  await dialog.getByLabel('Workspace description').fill('Private investigation details');
  await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByLabel('Confirm password').fill(password);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
}
async function add(page: Page, value: string) {
  await page.getByLabel('Transaction, output, or address').fill(value);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
}
test('selecting an input hydrates its previous output with prefetch off and follows exact spends', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await create(page);
  await expect(page.getByLabel('Prefetch previous levels')).toHaveValue('0');
  await add(page, TX_SPENDING);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  expect(calls.filter((c) => c.method === 'getrawtransaction').map((c) => c.params[0])).toEqual([
    TX_SPENDING,
  ]);
  await page
    .locator('.transaction-view')
    .getByRole('button', { name: /^Input 0:/ })
    .click();
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
  ).toHaveText('1.00 000 000 BTC');
  await page.getByRole('button', { name: 'Find spending transactions', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Find spending transactions', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(calls.some((c) => c.method === 'gettxspendingprevout')).toBe(false);
  await page.getByRole('button', { name: /^Spending tx:/ }).click();
  await expect(page.locator('.selection-heading .eyebrow')).toHaveText('TRANSACTION');
  await expect(
    page.locator(`.selection-heading .selection-facts code[title="${TX_SPENDING}"]`),
  ).toBeVisible();
});
test('explicit previous-level prefetch exposes input output values without another fetch', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await create(page);
  await page.getByLabel('Prefetch previous levels').selectOption('1');
  await add(page, TX_SPENDING);
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('output');
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await page.locator('.entity-row').first().click();
  await expect(
    page
      .locator('.selection-facts > div')
      .filter({ has: page.locator('dt', { hasText: /^Value$/ }) })
      .locator('dd'),
  ).toHaveText('1.00 000 000 BTC');
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  expect(calls.filter((c) => c.method === 'getrawtransaction').map((c) => c.params[0])).toEqual([
    TX_SPENDING,
    TX_FUNDING,
  ]);
});
test('explicit input detail loading deduplicates parents and exposes output values', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await create(page);
  await page.getByLabel('Prefetch previous levels').selectOption('0');
  await add(page, TX_SPENDING);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await page
    .locator('.transaction-view')
    .getByRole('button', { name: 'Load missing input details (1)', exact: true })
    .click();
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
  ).toHaveText('1.00 000 000 BTC');
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});
test('saved incoming and outgoing paths remain navigable offline and survive locking', async ({
  page,
}) => {
  const calls = await mockBitcoin(page, false);
  await openLaboratoryFixture(page, 'Saved path study', password);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await page.locator('.entity-row').click();
  const view = page.locator('.transaction-view');
  const parent = (2000).toString(16).padStart(64, '0');
  const join = (1000).toString(16).padStart(64, '0');
  const child = (4000).toString(16).padStart(64, '0');
  await view.getByRole('button', { name: /^Input 0:/ }).click();
  await view
    .getByRole('button', { name: `Go to previous transaction ${parent}`, exact: true })
    .click();
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(parent);
  await view
    .getByRole('button', { name: `Go to spending transaction ${join}`, exact: true })
    .click();
  await view.getByRole('button', { name: /^Output 0:/ }).click();
  await view
    .getByRole('button', { name: `Go to spending transaction ${child}`, exact: true })
    .click();
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(child);
  await expect(page.locator('.statusbar')).toContainText('543 transactions');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toBeVisible();
  await page.reload();
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('543 transactions');
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(child);
  expect(calls).toHaveLength(0);
});
test('previously saved synthetic workspaces keep live queries disabled on a connected backend', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  const legacy = laboratoryWorkspace();
  legacy.demo = true;
  // Retain an old initial laboratory snapshot with missing input transactions.
  legacy.transactions = Object.fromEntries(
    Object.entries(legacy.transactions).filter(([, transaction]) => transaction.vin.length === 150),
  );
  await openFixtureWorkspace(page, legacy, password);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await page.locator('.entity-row').click();
  await expect(page.locator('.details')).toContainText('150 / 150');
  await page
    .getByLabel('Transaction, output, or address')
    .fill((1000).toString(16).padStart(64, '0'));
  await expect(page.getByRole('button', { name: 'Add to graph', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Load previous transactions', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Find spending transactions', exact: true }),
  ).toBeDisabled();
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
