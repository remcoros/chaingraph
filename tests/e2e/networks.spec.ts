import { expect, test, type Page } from '@playwright/test';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import type { Network } from '../../src/domain/types';
import {
  mockBitcoin,
  mockNetworkDiscovery,
  PUBLIC_ZPUB,
  TX_FUNDING,
  transactions,
  type MockCall,
} from '../fixtures/bitcoin';

const password = 'public-network-routing-fixture';
const sameTxid = 'f'.repeat(64);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
});

async function create(page: Page, network: Network, name: string, single = false) {
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Name (public)', { exact: true }).fill(name);
  if (single) {
    await expect(dialog.getByLabel('Bitcoin network')).toHaveValue(network);
    await expect(dialog.getByLabel('Bitcoin network')).toHaveAttribute('readonly');
  } else {
    await expect(dialog.getByLabel('Bitcoin network').locator('option')).toHaveText([
      'Mainnet',
      'Testnet4',
    ]);
    await dialog.getByLabel('Bitcoin network').selectOption(network);
  }
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByLabel('Confirm password').fill(password);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.locator('.workspace-tab').filter({ hasText: name })).toBeVisible();
}

async function add(page: Page, txid: string) {
  await page.getByLabel('Transaction, output, or address').fill(txid);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
}

for (const network of ['mainnet', 'testnet4'] as const) {
  test(`a ${network}-only backend makes workspace network read-only`, async ({ page }) => {
    const calls = await mockBitcoin(page, { networks: [network] });
    await page.goto('/');
    await create(page, network, `${network} only`, true);
    await expect(
      page.getByRole('button', { name: 'Connection details', exact: true }),
    ).toContainText(network);
    if (network === 'mainnet') {
      await add(page, TX_FUNDING);
      await expect(page.locator('.statusbar')).toContainText('1 transaction');
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((call) => call.network === network)).toBe(true);
    }
  });
}

test('two configured networks keep transaction confirmation snapshots and RPC calls in their own workspaces', async ({
  page,
}) => {
  await mockNetworkDiscovery(page);
  const calls: MockCall[] = [];
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    calls.push(call);
    expect(['mainnet', 'testnet4']).toContain(call.network);
    await route.fulfill({
      json: {
        result: {
          txid: sameTxid,
          vin: [{ coinbase: '00' }],
          confirmations: call.network === 'mainnet' ? 101 : 7,
          vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
        },
      },
    });
  });
  await page.goto('/');
  await create(page, 'mainnet', 'Mainnet investigation');
  await add(page, sameTxid);
  const evidence = page.locator('.selection-evidence');
  await evidence.locator(':scope > summary').click();
  await expect(evidence).toContainText('101 confirmations');
  await create(page, 'testnet4', 'Testnet investigation');
  await add(page, sameTxid);
  await expect(evidence).toContainText('7 confirmations');
  await page.locator('.workspace-tab').filter({ hasText: 'Mainnet investigation' }).click();
  await expect(evidence).toContainText('101 confirmations');
  await expect(evidence).not.toContainText('7 confirmations');
  expect(calls.map((call) => call.network)).toEqual(['mainnet', 'testnet4']);
});

test('an unavailable configured backend does not disable the other network', async ({ page }) => {
  const calls = await mockBitcoin(page, { connected: { mainnet: true, testnet4: false } });
  await page.goto('/');
  await create(page, 'testnet4', 'Unavailable testnet');
  await expect(page.getByRole('alert')).toContainText('testnet4 backend is unavailable.');
  await page.getByLabel('Transaction, output, or address').fill(TX_FUNDING);
  await expect(page.getByRole('button', { name: 'Add to graph', exact: true })).toBeDisabled();
  await create(page, 'mainnet', 'Available mainnet');
  await add(page, TX_FUNDING);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await expect(
    page.getByRole('alert').filter({ hasText: 'testnet4 backend is unavailable.' }),
  ).toHaveCount(0);
  await page.locator('.workspace-tab').filter({ hasText: 'Unavailable testnet' }).click();
  await expect(page.getByRole('alert')).toContainText('testnet4 backend is unavailable.');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => call.network === 'mainnet')).toBe(true);
});

test('a late offline status response does not replace the active network status', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  const held: (() => void)[] = [];
  page.on('close', () => held.splice(0).forEach((release) => release()));
  await page.route('**/api/status?network=testnet4', async (route) => {
    await new Promise<void>((resolve) => held.push(resolve));
    await route.fulfill({ json: { network: 'testnet4', connected: false } }).catch(() => {});
  });
  await page.goto('/');
  await create(page, 'testnet4', 'Pending testnet status');
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await create(page, 'mainnet', 'Current mainnet status');
  held.splice(0).forEach((release) => release());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('button', { name: 'Connection details', exact: true })).toContainText(
    'mainnet',
  );
  await add(page, TX_FUNDING);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  expect(calls.every((call) => call.network === 'mainnet')).toBe(true);
});

test('an imported unsupported workspace remains editable offline and reopens with its data', async ({
  page,
}) => {
  const calls = await mockBitcoin(page, { networks: ['mainnet'] });
  const workspace = newWorkspace('Unsupported testnet import', 'testnet4');
  workspace.transactions[sameTxid] = {
    txid: sameTxid,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  };
  workspace.view.selectionId = `tx:${sameTxid}`;
  workspace.annotations[`tx:${sameTxid}`] = {
    label: 'Retained transaction',
    note: 'Offline source note',
    icon: '',
    bookmarked: false,
  };
  const envelope = await encryptWorkspace(workspace, password);
  await page.goto('/');
  await page.locator('input[type=file][accept=".chaingraph,.json"]').setInputFiles({
    name: 'unsupported.chaingraph',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  const dialog = page.getByRole('dialog', { name: 'Open encrypted workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Backend does not support testnet4.');
  await expect(page.getByLabel('Node label')).toHaveValue('Retained transaction');
  await expect(page.locator('.transaction-view')).toContainText('100,000,000 sats');
  await page.getByLabel('Node notes').fill('Edited offline and retained');
  await page.getByLabel('Transaction, output, or address').fill(TX_FUNDING);
  await expect(page.getByRole('button', { name: 'Add to graph', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toBeVisible();
  await page.reload();
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(password);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Backend does not support testnet4.');
  await expect(page.getByLabel('Node notes')).toHaveValue('Edited offline and retained');
  expect(calls).toHaveLength(0);
});

test('failed network discovery prevents workspace creation and hides unavailable templates', async ({
  page,
}) => {
  const calls = await mockBitcoin(page, false);
  await page.route('**/api/networks', (route) =>
    route.fulfill({ status: 503, json: { error: 'Discovery unavailable' } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await expect(dialog).toContainText(
    'Cannot discover supported networks. Check the backend connection.',
  );
  await expect(
    dialog.getByRole('button', { name: 'Create workspace', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Create .+ workspace$/ })).toHaveCount(0);
  await expect(page.locator('.saved-row')).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

// Same public BIP84 account with testnet serialization. No private material is used.
function testnetPublicAccount() {
  const codec = base58check(sha256);
  const bytes = codec.decode(PUBLIC_ZPUB);
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 0x045f1cf6);
  return codec.encode(bytes);
}

async function addWallet(page: Page, name: string, key: string) {
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a wallet' });
  await dialog.getByLabel('Wallet name').fill(name);
  await dialog.getByLabel('Extended public key').fill(key);
  await dialog.getByRole('button', { name: 'Add wallet', exact: true }).click();
}

test('late wallet scan responses cannot cross workspace networks even for identical script hashes', async ({
  page,
}) => {
  await mockNetworkDiscovery(page);
  const calls: MockCall[] = [];
  let holdMainnet = true;
  const held: (() => void)[] = [];
  page.on('close', () => held.splice(0).forEach((release) => release()));
  const firstHash = '6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a';
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    calls.push(call);
    expect(['mainnet', 'testnet4']).toContain(call.network);
    if (
      holdMainnet &&
      call.network === 'mainnet' &&
      call.method === 'blockchain.scripthash.get_history'
    )
      await new Promise<void>((resolve) => held.push(resolve));
    const result =
      call.method === 'blockchain.scripthash.get_history'
        ? call.network === 'mainnet' && call.params[0] === firstHash
          ? [{ tx_hash: TX_FUNDING, height: 899900 }]
          : []
        : transactions[call.params[0] as keyof typeof transactions];
    // A route may already be cancelled when its former workspace is left.
    await route.fulfill({ json: { result } }).catch(() => {});
  });
  await page.goto('/');
  await create(page, 'mainnet', 'Mainnet wallet');
  await addWallet(page, 'Mainnet public account', PUBLIC_ZPUB);
  await create(page, 'testnet4', 'Testnet wallet');
  const vpub = testnetPublicAccount();
  await addWallet(page, 'Testnet public account', vpub);
  await page.locator('.workspace-tab').filter({ hasText: 'Mainnet wallet' }).click();
  await page.getByRole('button', { name: 'Scan wallet', exact: true }).click();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.locator('.workspace-tab').filter({ hasText: 'Testnet wallet' }).click();
  await expect(page.getByRole('button', { name: 'Scan wallet', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Scan wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh wallet', exact: true })).toBeEnabled();
  holdMainnet = false;
  held.splice(0).forEach((release) => release());
  await expect(page.locator('.statusbar')).toContainText('0 transactions');
  await page.locator('.workspace-tab').filter({ hasText: 'Mainnet wallet' }).click();
  await page.getByRole('button', { name: 'Scan wallet', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await page.locator('.workspace-tab').filter({ hasText: 'Testnet wallet' }).click();
  await expect(page.locator('.statusbar')).toContainText('0 transactions');
  const sameScript = calls.filter(
    (call) => call.method === 'blockchain.scripthash.get_history' && call.params[0] === firstHash,
  );
  expect(new Set(sameScript.map((call) => call.network))).toEqual(new Set(['mainnet', 'testnet4']));
  expect(
    calls
      .filter((call) => call.method === 'getrawtransaction')
      .every((call) => call.network === 'mainnet'),
  ).toBe(true);
  expect(JSON.stringify(calls)).not.toContain(PUBLIC_ZPUB);
  expect(JSON.stringify(calls)).not.toContain(vpub);
});
