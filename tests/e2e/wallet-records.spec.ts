import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from '../../src/domain/workspace';
import { deriveAddresses } from '../../src/lib/wallet';
import type { Wallet } from '../../src/domain/types';
import { openFixtureWorkspace } from '../fixtures/open-workspace';
import {
  mockBitcoin,
  PUBLIC_ZPUB,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
  type MockCall,
} from '../fixtures/bitcoin';

const PASSWORD = 'public-wallet-records-fixture';
const RECENT = 'c'.repeat(64);
const addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 2);
const recentTransaction = {
  ...transactions[TX_FUNDING],
  txid: RECENT,
  confirmations: 0,
  mempool: true,
};

function workspaceFixture(secondWallet = false) {
  const workspace = newWorkspace('Wallet navigation fixture', 'mainnet');
  const wallet: Wallet = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Public BIP84 wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#27c4a7',
    addresses: addresses.map((address) => ({
      ...address,
      history: [
        { tx_hash: TX_FUNDING, height: 899900 },
        { tx_hash: RECENT, height: 0 },
        { tx_hash: TX_SPENDING, height: 899901 },
      ],
    })),
    scanComplete: false,
    scannedAt: '2026-09-08T10:00:00.000Z',
  };
  workspace.wallets = [wallet];
  if (secondWallet)
    workspace.wallets.push({
      ...wallet,
      id: '10000000-0000-4000-8000-000000000002',
      name: 'Second public wallet',
      addresses: [{ ...addresses[1], history: [] }],
    });
  workspace.transactions = { [TX_FUNDING]: structuredClone(transactions[TX_FUNDING]) };
  workspace.view = {
    ...workspace.view,
    selectedWallet: wallet.id,
    leftTab: 'wallets',
    rightTab: 'inspect',
    transactionFlow: { open: false },
    lockToSelection: false,
  };
  return workspace;
}

async function fixtureRpc(page: Page) {
  const calls = await mockBitcoin(page);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    if (call.method !== 'getrawtransaction' || call.params[0] !== RECENT) return route.fallback();
    calls.push(call);
    return route.fulfill({ json: { result: recentTransaction } });
  });
  return calls;
}

const rightTab = (page: Page, name: string) =>
  page.locator('.right-panel .panel-tabs').getByRole('button', { name, exact: true });

async function expectWalletTabsReachable(page: Page) {
  const tabs = page.locator('.right-panel .panel-tabs');
  await expect(tabs.getByRole('button')).toHaveCount(4);
  // A wrapped tab header must contain both rows so panel content cannot cover them.
  await expect
    .poll(() =>
      tabs.evaluate((header) => {
        const bounds = header.getBoundingClientRect();
        return [...header.querySelectorAll('button')].every((button) => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return rect.top >= bounds.top && rect.bottom <= bounds.bottom && button.contains(hit);
        });
      }),
    )
    .toBe(true);
}

test('wallet history deduplicates addresses, orders newest first and keeps wallet navigation after loading and editing a transaction', async ({
  page,
}) => {
  const calls = await fixtureRpc(page);
  const workspace = workspaceFixture();
  await openFixtureWorkspace(page, workspace, PASSWORD);
  await rightTab(page, 'Transactions').click();
  const panel = page.getByRole('region', { name: 'Wallet transactions', exact: true });
  const rows = panel.locator('.wallet-record-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('aria-label', `Select wallet transaction ${RECENT}`);
  await expect(rows.nth(1)).toHaveAttribute(
    'aria-label',
    `Select wallet transaction ${TX_SPENDING}`,
  );
  await expect(rows.nth(2)).toHaveAttribute(
    'aria-label',
    `Select wallet transaction ${TX_FUNDING}`,
  );
  await expect(rows.first()).toContainText('Unconfirmed');
  await expect(rows.first()).toContainText('Load transaction');
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(rightTab(page, 'Transactions')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText('Public BIP84 wallet');
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  expect(
    calls.filter((call) => call.method === 'getrawtransaction').map((call) => call.params[0]),
  ).toContain(RECENT);
  await rightTab(page, 'Inspector').click();
  await page.getByLabel('Node label', { exact: true }).fill('Wallet receive to review');
  await page
    .getByLabel('Node notes', { exact: true })
    .fill('Preserve this wallet navigation note.');
  await rightTab(page, 'Transactions').click();
  await expect(rows.first()).toContainText('Wallet receive to review');
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toBeVisible();
  await page.reload();
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(panel).toContainText('Wallet receive to review');
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
  await rightTab(page, 'Inspector').click();
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'Preserve this wallet navigation note.',
  );
  expect(calls.every((call) => call.network === 'mainnet')).toBe(true);
});

test('UTXO records come from current address checks and refresh removes spent records without deleting loaded transactions', async ({
  page,
}, testInfo) => {
  await fixtureRpc(page);
  let spent = false;
  const checked: MockCall[] = [];
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    if (call.method !== 'blockchain.scripthash.listunspent') return route.fallback();
    checked.push(call);
    return route.fulfill({
      json: {
        result:
          !spent && call.params[0] === addresses[0].scripthash
            ? [{ tx_hash: TX_FUNDING, tx_pos: 0, height: 899900, value: 100_000_000 }]
            : [],
      },
    });
  });
  await openFixtureWorkspace(page, workspaceFixture(), PASSWORD);
  await expectWalletTabsReachable(page);
  await rightTab(page, 'UTXOs').click();
  const panel = page.getByRole('region', { name: 'Wallet UTXOs', exact: true });
  await expect(panel.locator('.wallet-record-row')).toHaveCount(1);
  await expect(panel).toContainText('Checked 2 / 2 addresses');
  await expect(panel).toContainText('Unspent at the last check');
  // Both cached outputs have no loaded spend, but only the server-observed one is listed.
  await expect(
    panel.getByRole('button', { name: `Select wallet UTXO ${TX_FUNDING}:1` }),
  ).toHaveCount(0);
  await panel.getByRole('button', { name: `Select wallet UTXO ${TX_FUNDING}:0` }).click();
  await expect(panel.locator('.wallet-record-row')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('wallet-utxos-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'UTXOs', exact: true }).click();
  await expectWalletTabsReachable(page);
  await expect(panel.locator('.wallet-record-row')).toBeInViewport({ ratio: 1 });
  await expect(panel.getByRole('button', { name: 'Refresh wallet UTXOs' })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: testInfo.outputPath('wallet-utxos-mobile.png') });
  spent = true;
  await panel.getByRole('button', { name: 'Refresh wallet UTXOs' }).click();
  await expect(panel).toContainText('No UTXOs found for the checked addresses.');
  await expect(panel.locator('.wallet-record-row')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await rightTab(page, 'Transactions').click();
  await expect(
    page.getByRole('button', { name: `Select wallet transaction ${TX_FUNDING}` }),
  ).toBeVisible();
  expect(checked).toHaveLength(4);
  expect(checked.every((call) => call.network === 'mainnet' && call.target === 'electrum')).toBe(
    true,
  );
  expect(new Set(checked.map((call) => call.params[0]))).toEqual(
    new Set(addresses.map((address) => address.scripthash)),
  );
});

test('failed address checks are visibly incomplete and can be retried without presenting an empty wallet balance', async ({
  page,
}) => {
  await fixtureRpc(page);
  let fail = true;
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    if (call.method !== 'blockchain.scripthash.listunspent') return route.fallback();
    if (fail && call.params[0] === addresses[0].scripthash)
      return route.fulfill({ status: 503, json: { error: 'Public fixture failure' } });
    return route.fulfill({
      json: {
        result:
          call.params[0] === addresses[0].scripthash
            ? [{ tx_hash: RECENT, tx_pos: 0, height: 0, value: 100_000_000 }]
            : [],
      },
    });
  });
  await openFixtureWorkspace(page, workspaceFixture(), PASSWORD);
  await rightTab(page, 'UTXOs').click();
  const panel = page.getByRole('region', { name: 'Wallet UTXOs', exact: true });
  await expect(panel).toContainText('1 failed; refresh to retry');
  await expect(panel).toContainText('addresses checked successfully so far');
  await expect(panel).not.toContainText('No UTXOs found for the checked addresses.');
  fail = false;
  await panel.getByRole('button', { name: 'Refresh wallet UTXOs' }).click();
  const row = panel.getByRole('button', { name: `Select wallet UTXO ${RECENT}:0` });
  await expect(row).toBeVisible();
  await expect(panel).not.toContainText('failed; refresh');
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await rightTab(page, 'Inspector').click();
  await expect(page.getByLabel('Node label', { exact: true })).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});

test('switching wallets cancels delayed UTXO checks and never displays the previous wallet response', async ({
  page,
}) => {
  await fixtureRpc(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = false;
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    if (call.method !== 'blockchain.scripthash.listunspent') return route.fallback();
    expect(call.network).toBe('mainnet');
    if (call.params[0] === addresses[0].scripthash) {
      pending = true;
      await gate;
      await route
        .fulfill({
          json: {
            result: [{ tx_hash: TX_FUNDING, tx_pos: 0, height: 899900, value: 100_000_000 }],
          },
        })
        .catch(() => {});
      return;
    }
    return route.fulfill({ json: { result: [] } });
  });
  await openFixtureWorkspace(page, workspaceFixture(true), PASSWORD);
  await rightTab(page, 'UTXOs').click();
  await expect.poll(() => pending).toBe(true);
  await page.locator('.wallet-row').filter({ hasText: 'Second public wallet' }).click();
  await rightTab(page, 'UTXOs').click();
  const panel = page.getByRole('region', { name: 'Wallet UTXOs', exact: true });
  await expect(panel).toContainText('Second public wallet');
  await expect(panel).toContainText('Checked 1 / 1 addresses');
  release();
  await expect(panel).toContainText('No UTXOs found for the checked addresses.');
  await expect(panel.locator('.wallet-record-row')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
});
