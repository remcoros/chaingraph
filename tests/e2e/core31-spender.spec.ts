import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import {
  mockBitcoin,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
  type MockCall,
} from '../fixtures/bitcoin';

const blockhash = 'c'.repeat(64);
type LookupMode = 'confirmed' | 'mempool' | 'unavailable' | 'empty';

async function mockIndexedBitcoin(page: Page, mode: LookupMode) {
  const calls = await mockBitcoin(page);
  await page.route('**/api/networks', (route) =>
    route.fulfill({
      json: { networks: ['mainnet', 'testnet4'], spenderIndexNetworks: ['mainnet'] },
    }),
  );
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    if (call.method === 'gettxspendingprevout') {
      calls.push(call);
      if (mode === 'unavailable')
        return route.fulfill({
          status: 503,
          json: { error: 'Spender lookup is unavailable.', code: 'core_spender_unavailable' },
        });
      const points = call.params[0] as { txid: string; vout: number }[];
      return route.fulfill({
        json: {
          result: points.map((point) => ({
            ...point,
            ...(mode === 'empty' ? {} : { spendingtxid: TX_SPENDING }),
            ...(mode === 'confirmed' ? { blockhash } : {}),
          })),
        },
      });
    }
    if (call.method === 'getrawtransaction' && call.params[0] === TX_SPENDING) {
      calls.push(call);
      return route.fulfill({
        json: {
          result: {
            ...transactions[TX_SPENDING],
            ...(mode === 'confirmed'
              ? { blockhash, in_active_chain: true }
              : mode === 'mempool'
                ? { confirmations: 0 }
                : {}),
          },
        },
      });
    }
    if (call.method === 'getblockheader') {
      calls.push(call);
      return route.fulfill({
        json: { result: { hash: blockhash, height: 899901, confirmations: 100 } },
      });
    }
    return route.fallback();
  });
  return calls;
}

async function loadFunding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Indexed spending study');
  await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill('public-fixture-test-passphrase');
  await dialog.getByLabel('Confirm password').fill('public-fixture-test-passphrase');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await page.getByLabel('Transaction, output, or address').fill(TX_FUNDING);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await expect(page.locator('.transaction-view')).toBeVisible();
}

test('explicit flow lookup finds an exact confirmed spend and navigation reuses loaded data', async ({
  page,
}) => {
  const calls = await mockIndexedBitcoin(page, 'confirmed');
  await loadFunding(page);
  expect(calls.map((call) => call.method)).toEqual(['getrawtransaction']);
  const view = page.locator('.transaction-view');
  await view.getByRole('button', { name: 'Check output 0 for spends', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  expect(calls.filter((call) => call.method === 'gettxspendingprevout')).toEqual([
    {
      network: 'mainnet',
      target: 'core',
      method: 'gettxspendingprevout',
      params: [[{ txid: TX_FUNDING, vout: 0 }], { mempool_only: false, return_spending_tx: false }],
    },
  ]);
  expect(
    calls.filter((call) => call.method === 'getrawtransaction').map((call) => call.params),
  ).toEqual([
    [TX_FUNDING, 2],
    [TX_SPENDING, 2, blockhash],
  ]);
  expect(calls.every((call) => call.network === 'mainnet' && call.target === 'core')).toBe(true);
  const beforeNavigation = calls.length;
  await view
    .getByRole('button', { name: `Go to spending transaction ${TX_SPENDING}`, exact: true })
    .click();
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(TX_SPENDING);
  await view.getByRole('button', { name: /^Input 0:/ }).click();
  await view
    .getByRole('button', { name: `Go to previous transaction ${TX_FUNDING}`, exact: true })
    .click();
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(TX_FUNDING);
  expect(calls).toHaveLength(beforeNavigation);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/core31-spender-confirmed.png', fullPage: true });
});

test('Inspector batches transaction outputs and downloads a shared mempool spender once', async ({
  page,
}) => {
  const calls = await mockIndexedBitcoin(page, 'mempool');
  await loadFunding(page);
  await page.getByRole('button', { name: 'Find spending transactions', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  expect(
    calls.filter((call) => call.method === 'gettxspendingprevout').map((call) => call.params),
  ).toEqual([
    [
      [
        { txid: TX_FUNDING, vout: 0 },
        { txid: TX_FUNDING, vout: 1 },
      ],
      { mempool_only: false, return_spending_tx: false },
    ],
  ]);
  expect(
    calls
      .filter((call) => call.method === 'getrawtransaction' && call.params[0] === TX_SPENDING)
      .map((call) => call.params),
  ).toEqual([[TX_SPENDING, 2]]);
  expect(calls.some((call) => call.target === 'electrum')).toBe(false);
  await page.getByRole('button', { name: /^Spending tx:/ }).click();
  await expect(page.locator('.selection-heading .eyebrow')).toHaveText('TRANSACTION');
  await expect(page.locator('.transaction-view')).toContainText('Unconfirmed');
});

test('an unavailable confirmed index falls back to bounded history and loads the exact spend', async ({
  page,
}) => {
  const calls = await mockIndexedBitcoin(page, 'unavailable');
  await loadFunding(page);
  const view = page.locator('.transaction-view');
  await view.getByRole('button', { name: 'Check output 0 for spends', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  expect(calls.filter((call) => call.method === 'gettxspendingprevout')).toHaveLength(1);
  expect(calls.filter((call) => call.method === 'blockchain.scripthash.get_history')).toHaveLength(
    1,
  );
  expect(
    calls.filter((call) => call.method === 'getrawtransaction' && call.params[0] === TX_SPENDING),
  ).toHaveLength(1);
  expect(calls.every((call) => call.network === 'mainnet')).toBe(true);
  await expect(
    view.getByRole('button', { name: `Go to spending transaction ${TX_SPENDING}`, exact: true }),
  ).toBeVisible();
});

test('a complete empty index observation leaves spending status unknown without history lookup', async ({
  page,
}) => {
  const calls = await mockIndexedBitcoin(page, 'empty');
  await loadFunding(page);
  const view = page.locator('.transaction-view');
  await view.getByRole('button', { name: 'Check output 0 for spends', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '0 spending transactions found; 0 added' }),
  ).toBeVisible();
  await expect(view).toContainText('Spend status unknown');
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  expect(calls.filter((call) => call.method === 'gettxspendingprevout')).toHaveLength(1);
  expect(calls.some((call) => call.target === 'electrum')).toBe(false);
});
