import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { newWorkspace } from '../../src/domain/workspace';
import { outputNodeId, type Workspace } from '../../src/domain/types';
import { deriveAddresses } from '../../src/lib/wallet';
import { openFixtureWorkspace } from '../fixtures/open-workspace';
import {
  mockNetworkDiscovery,
  PUBLIC_ZPUB,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
} from '../fixtures/bitcoin';

const password = 'public-usability-fixture';
const shots = 'artifacts/ui-review/improvements';
const nav = (page: Page, mode: string) =>
  page
    .getByRole('navigation', { name: 'Workbench', exact: true })
    .getByRole('button', { name: mode, exact: true });

function walletWorkspace() {
  const w = newWorkspace('Public usability fixture', 'mainnet');
  const receive = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 2);
  const change = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 1, 0, 1);
  w.wallets = [receive, change].map((addresses, index) => ({
    id: `30000000-0000-4000-8000-00000000000${index + 1}`,
    name: index ? 'Reserve wallet' : 'Daily wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh' as const,
    color: '#27c4a7',
    addresses: addresses.map((address) => ({
      ...address,
      history: index
        ? []
        : [
            { tx_hash: TX_FUNDING, height: 899900 },
            { tx_hash: TX_SPENDING, height: 899901 },
          ],
    })),
  }));
  w.transactions = structuredClone(transactions);
  for (const tx of Object.values(w.transactions))
    for (const output of tx.vout) delete output.scriptPubKey.address;
  w.view = { ...w.view, workbench: 'wallet', dimensions: 2, selectedWallet: w.wallets[0].id };
  return w;
}

async function prepareWallet(page: Page, w: Workspace) {
  await mockNetworkDiscovery(page);
  const calls: string[] = [];
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    calls.push(call.method);
    if (call.method === 'blockchain.scripthash.listunspent')
      return route.fulfill({
        json: {
          result:
            call.params[0] === w.wallets[0].addresses[0].scripthash
              ? [{ tx_hash: TX_SPENDING, tx_pos: 0, height: 899901, value: 149990000 }]
              : [],
        },
      });
    return route.fulfill({ status: 400, json: { error: 'Unsupported public fixture request' } });
  });
  await openFixtureWorkspace(page, w, password);
  await mkdir(shots, { recursive: true });
  await expect(page.getByLabel('Wallet coverage')).toContainText('1 unspent');
  return calls;
}

test('wallet checks survive Graph handoff, remain exact, and clear on wallet switch and lock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const w = walletWorkspace();
  const calls = await prepareWallet(page, w);
  await page.getByRole('button', { name: 'Label', exact: true }).click();
  await page
    .getByLabel('Batch label')
    .fill('Household reserve: repairs and replacement fund from September withdrawal');
  await page.getByRole('button', { name: 'Apply label', exact: true }).click();
  await page.screenshot({ path: `${shots}/wallet-laptop.png` });
  await page.getByRole('button', { name: 'Show in Graph', exact: true }).click();
  const inspector = page.locator('.inspector-scroll');
  await expect(inspector).toContainText('Unspent at wallet check');
  await expect(page.locator('.transaction-view')).toContainText('Unspent at wallet check');
  await expect(inspector).not.toContainText('Spend status unknown');
  const checkedCalls = calls.filter(
    (method) => method === 'blockchain.scripthash.listunspent',
  ).length;
  await page.getByRole('button', { name: 'Back to Wallet', exact: true }).click();
  await expect(page.getByLabel('Wallet coverage')).toContainText('1 unspent');
  expect(calls.filter((method) => method === 'blockchain.scripthash.listunspent')).toHaveLength(
    checkedCalls,
  );
  await page.getByLabel('Selected wallet').selectOption(w.wallets[1].id);
  await expect(page.getByLabel('Wallet coverage')).toContainText('0 unspent');
  await nav(page, 'Graph').click();
  await expect(inspector).not.toContainText('Unspent at wallet check');
  await nav(page, 'Wallet').click();
  await page.getByLabel('Selected wallet').selectOption(w.wallets[0].id);
  await expect(page.getByLabel('Wallet coverage')).toContainText('1 unspent');
  await page.getByRole('button', { name: 'Show in Graph', exact: true }).click();
  await expect(inspector).toContainText('Unspent at wallet check');
  await page.screenshot({ path: `${shots}/graph-wallet-evidence.png` });
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.locator('.saved-row').filter({ hasText: w.name }).click();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(inspector).toBeVisible();
  await expect(inspector).not.toContainText('Unspent at wallet check');
});

test('script-only wallet receipts and constrained metadata remain usable', async ({ page }) => {
  const w = walletWorkspace();
  await prepareWallet(page, w);
  await nav(page, 'Graph').click();
  await page.getByRole('button', { name: /Daily wallet.*used addresses/ }).click();
  const count = page
    .locator('.inspector-scroll .details > div')
    .filter({ hasText: 'Loaded received outputs' });
  await expect(count.locator('dd')).toHaveText('3');
  await nav(page, 'Wallet').click();
  await page.setViewportSize({ width: 800, height: 800 });
  await page.screenshot({ path: `${shots}/wallet-800.png` });
  await page.setViewportSize({ width: 640, height: 800 });
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByLabel('Entity notes').fill('Public note kept when navigating away immediately.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeFocused();
  await page.screenshot({ path: `${shots}/wallet-640.png` });
  await page.getByRole('button', { name: 'Show in Graph', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.getByLabel('Node notes')).toHaveValue(
    'Public note kept when navigating away immediately.',
  );
});

test('Analysis opens compact supporting evidence without inventing an amount or fetching data', async ({
  page,
}) => {
  const w = newWorkspace('Public compact finding', 'mainnet');
  w.transactions = structuredClone(transactions);
  const missing = '9'.repeat(64);
  w.transactions[TX_FUNDING].vin = [{ txid: missing, vout: 3 }];
  w.inputContext = { [TX_FUNDING]: [0, 1] };
  w.findings = [
    {
      id: 'compact-input-finding',
      algorithm: 'cioh-v2',
      kind: 'hypothesis',
      title: 'Public missing-input hypothesis',
      description: 'A loaded input reference, with an unknown value.',
      txids: [TX_FUNDING],
      nodeIds: [outputNodeId(missing, 3)],
      createdAt: new Date().toISOString(),
    },
  ];
  w.view = { ...w.view, workbench: 'analysis', dimensions: 2, transactionFlow: { open: false } };
  await mockNetworkDiscovery(page);
  const calls: string[] = [];
  await page.route('**/api/rpc', (route) => {
    calls.push(route.request().postDataJSON().method);
    return route.fulfill({ status: 400, json: { error: 'Unexpected fixture request' } });
  });
  await openFixtureWorkspace(page, w, password);
  await page.getByRole('button', { name: 'Show on graph', exact: true }).click();
  await expect(page.locator('.inspector-scroll')).toContainText('aaaaaaa...aaaaaaa');
  await expect(
    page
      .locator('.transaction-view')
      .getByRole('button', { name: 'Load missing input details (1)', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.transaction-view')).toContainText('Unknown value');
  await expect(
    page.getByText(
      'The requested entity cannot be opened directly. Showing its supporting transaction.',
    ),
  ).toBeVisible();
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Back to Analysis', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Selected finding' })).toContainText(
    'Public missing-input hypothesis',
  );
  await page.getByRole('button', { name: 'Isolate', exact: true }).click();
  await expect(page.locator('.inspector-scroll')).toContainText('aaaaaaa...aaaaaaa');
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
  expect(calls).toEqual([]);
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/analysis-input-handoff.png` });
});

test('compact Inspector keeps creating and spending links inside the panel', async ({ page }) => {
  const w = walletWorkspace();
  w.transactions[TX_FUNDING].blockHeight = 899900;
  w.transactions[TX_FUNDING].blocktime = 1690168629;
  w.view = { ...w.view, workbench: 'graph', selectionId: outputNodeId(TX_FUNDING, 0) };
  await mockNetworkDiscovery(page);
  await page.route('**/api/rpc', (route) =>
    route.fulfill({ status: 400, json: { error: 'Unsupported fixture request' } }),
  );
  await openFixtureWorkspace(page, w, password);
  const inspector = page.locator('.inspector-scroll');
  await expect(
    inspector.getByRole('button', { name: 'Creating tx: aaaaaaa...aaaaaaa', exact: true }),
  ).toBeVisible();
  const spending = inspector.getByRole('button', {
    name: 'Spending tx: bbbbbbb...bbbbbbb',
    exact: true,
  });
  await expect(spending).toBeVisible();
  await expect(
    inspector.locator('.selection-facts').getByText('Block', { exact: true }),
  ).toBeVisible();
  await mkdir('artifacts/ui-review/feedback', { recursive: true });
  for (const width of [1366, 800]) {
    await page.setViewportSize({ width, height: 768 });
    if (width === 800) await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await expect(spending).toBeVisible();
    const clipped = await inspector
      .locator('.related-transactions button')
      .evaluateAll((buttons) =>
        buttons.some((button) => button.scrollWidth > button.clientWidth + 1),
      );
    expect(clipped).toBe(false);
    await page.screenshot({ path: `artifacts/ui-review/feedback/inspector-${width}.png` });
  }
  await spending.click();
  await expect(inspector.locator('.selection-facts code[title]')).toHaveAttribute(
    'title',
    TX_SPENDING,
  );
});

test('wallet context defaults to latest, preserves a choice, and explains an empty relation', async ({
  page,
}) => {
  const w = walletWorkspace();
  w.transactions[TX_FUNDING].blockHeight = 899900;
  w.transactions[TX_SPENDING].blockHeight = 899901;
  const unused = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 2, 1)[0];
  w.wallets[0].addresses.push({
    ...unused,
    history: [{ tx_hash: '9'.repeat(64), height: 899902 }],
  });
  await prepareWallet(page, w);
  await page.getByRole('button', { name: 'Addresses', exact: true }).click();
  const rows = page.locator('.wallet-review-records').getByRole('listitem');
  const addressRow = (address: string) =>
    rows
      .filter({ has: page.locator(`.wallet-item-title[title="${address}"]`) })
      .locator('.wallet-review-record-body');
  await addressRow(w.wallets[0].addresses[0].address).click();
  const chooser = page.getByLabel('Transaction context', { exact: true });
  await expect(chooser).toHaveValue(TX_SPENDING);
  await expect(page.locator('.wallet-review-flow')).toBeVisible();
  await chooser.selectOption(TX_FUNDING);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByLabel('Entity notes').fill('Public note while inspecting the older transaction.');
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveValue(TX_FUNDING);
  await addressRow(unused.address).click();
  const empty = page.locator('.wallet-flow-empty');
  await expect(empty).toContainText('No related transaction found in loaded data.');
  await expect(empty).toContainText('Some wallet history is not loaded.');
  await expect(empty.locator('svg')).toBeVisible();
  await expect(page.locator('.wallet-review-flow')).toHaveCount(0);
  await mkdir('artifacts/ui-review/feedback', { recursive: true });
  await page.screenshot({ path: 'artifacts/ui-review/feedback/wallet-no-related.png' });
  await addressRow(w.wallets[0].addresses[0].address).click();
  await expect(chooser).toHaveValue(TX_SPENDING);
  await expect(page.locator('.wallet-review-flow')).toBeVisible();
});
