import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Transaction, Wallet, Workspace } from '../../src/domain/types';
import { newWorkspace, parseWorkspace } from '../../src/domain/workspace';
import { deriveAddresses } from '../../src/lib/wallet';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { mockNetworkDiscovery, PUBLIC_ZPUB, type MockCall } from '../fixtures/bitcoin';

const password = 'public-wallet-review-fixture';
const receive = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 3);
const change = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 1, 0, 1);
const derived = [...receive, ...change];
// A public non-wallet destination used as the counterparty in fixture payments.
const EXTERNAL = bitcoinAddress.toBech32(new Uint8Array(20).fill(7), 0, 'bc');
const script = (address: string) => bytesToHex(bitcoinAddress.toOutputScript(address));
const TX_OLD = '1'.repeat(64);
const TX_MID = '2'.repeat(64);
const TX_SECOND = '3'.repeat(64);
const TX_NEW = '4'.repeat(64);
const UTXO_MID = `out:${TX_MID}:0`;
const UTXO_SECOND = `out:${TX_SECOND}:0`;
const SOURCE_OLD = `out:${TX_OLD}:0`;

const transactions: Record<string, Transaction> = {
  [TX_OLD]: {
    txid: TX_OLD,
    vin: [{ txid: '9'.repeat(64), vout: 3 }],
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: script(receive[0].address) } }],
    blockHeight: 700000,
    confirmations: 200000,
  },
  [TX_MID]: {
    txid: TX_MID,
    vin: [{ txid: TX_OLD, vout: 0 }],
    vout: [
      { n: 0, value: 0.6, scriptPubKey: { hex: script(receive[1].address) } },
      { n: 1, value: 0.39, scriptPubKey: { hex: script(EXTERNAL) } },
    ],
    blockHeight: 800000,
    confirmations: 100000,
  },
  [TX_SECOND]: {
    txid: TX_SECOND,
    vin: [{ txid: '8'.repeat(64), vout: 1 }],
    vout: [{ n: 0, value: 0.25, scriptPubKey: { hex: script(receive[2].address) } }],
    blockHeight: 850000,
    confirmations: 50000,
  },
  [TX_NEW]: {
    txid: TX_NEW,
    vin: [{ txid: '7'.repeat(64), vout: 0 }],
    vout: [{ n: 0, value: 0.05, scriptPubKey: { hex: script(change[0].address) } }],
    blockHeight: 900000,
    confirmations: 1,
  },
};

const WALLET_ID = '30000000-0000-4000-8000-000000000001';
const SECOND_WALLET_ID = '30000000-0000-4000-8000-000000000002';

function history(withNewActivity: boolean) {
  const byAddress: Record<string, { tx_hash: string; height: number }[]> = {
    [receive[0].address]: [
      { tx_hash: TX_OLD, height: 700000 },
      { tx_hash: TX_MID, height: 800000 },
    ],
    [receive[1].address]: [{ tx_hash: TX_MID, height: 800000 }],
    [receive[2].address]: [{ tx_hash: TX_SECOND, height: 850000 }],
    [change[0].address]: withNewActivity ? [{ tx_hash: TX_NEW, height: 900000 }] : [],
  };
  return byAddress;
}

function unspent(withNewActivity: boolean) {
  const byAddress: Record<
    string,
    { tx_hash: string; tx_pos: number; height: number; value: number }[]
  > = {
    [receive[1].address]: [{ tx_hash: TX_MID, tx_pos: 0, height: 800000, value: 60_000_000 }],
    [receive[2].address]: [{ tx_hash: TX_SECOND, tx_pos: 0, height: 850000, value: 25_000_000 }],
    [change[0].address]: withNewActivity
      ? [{ tx_hash: TX_NEW, tx_pos: 0, height: 900000, value: 5_000_000 }]
      : [],
  };
  return byAddress;
}

/** Deterministic chain fixture. `state.newActivity` simulates a later refresh. */
async function mockChain(page: Page) {
  const state = { newActivity: false, calls: [] as MockCall[] };
  await mockNetworkDiscovery(page);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    state.calls.push(call);
    const byHash = <T>(map: Record<string, T>) =>
      Object.fromEntries(
        derived.map((address) => [address.scripthash, map[address.address] ?? []]),
      ) as Record<string, T>;
    let result: unknown;
    if (call.method === 'blockchain.scripthash.get_history')
      result = byHash(history(state.newActivity))[call.params[0] as string] ?? [];
    else if (call.method === 'blockchain.scripthash.listunspent')
      result = byHash(unspent(state.newActivity))[call.params[0] as string] ?? [];
    else if (call.method === 'getrawtransaction' || call.method === 'blockchain.transaction.get')
      result = transactions[call.params[0] as string];
    if (result === undefined)
      return route.fulfill({ status: 400, json: { error: 'Unsupported fixture request' } });
    return route.fulfill({ json: { result } });
  });
  return state;
}

function walletFixture(id: string, name: string, addresses = derived): Wallet {
  return {
    id,
    name,
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#27c4a7',
    addresses: addresses.map((address) => ({
      ...address,
      history: history(false)[address.address] ?? [],
    })),
    scannedAt: '2026-09-08T09:00:00.000Z',
    scanComplete: true,
    scanGap: 20,
    scanLimit: 200,
  };
}

async function seed(page: Page, customize?: (workspace: Workspace) => void) {
  const workspace = newWorkspace('Old public wallet', 'mainnet');
  workspace.wallets = [walletFixture(WALLET_ID, 'Old public wallet')];
  workspace.transactions = structuredClone(transactions);
  delete workspace.transactions[TX_NEW];
  // Sparse historical labels: one receipt already has context, the rest do not.
  workspace.annotations = {
    [UTXO_SECOND]: {
      label: 'Exchange A withdrawal',
      note: '',
      icon: '',
      bookmarked: false,
    },
  };
  workspace.view = {
    ...workspace.view,
    dimensions: 2,
    workbench: 'wallet',
    selectedWallet: WALLET_ID,
    lockToSelection: false,
  };
  customize?.(workspace);
  parseWorkspace(workspace);
  const entry = {
    id: workspace.id,
    publicName: workspace.name,
    savedAt: new Date().toISOString(),
    envelope: await encryptWorkspace(workspace, password),
  };
  await page.addInitScript((entry) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    if (!localStorage.getItem('chaingraph.encrypted-workspaces.v1'))
      localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify([entry]));
  }, entry);
  const chain = await mockChain(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await unlock(page, workspace.name);
  return { workspace, chain };
}

async function unlock(page: Page, name: string) {
  await page.locator('.saved-row').filter({ hasText: name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function saved(page: Page): Promise<Workspace> {
  const envelope = await page.evaluate(
    () => JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!)[0].envelope,
  );
  return (await decryptWorkspace(envelope, password)) as Workspace;
}

const workbench = (page: Page, name: 'Wallet' | 'Graph' | 'Analysis') =>
  page
    .getByRole('navigation', { name: 'Workbench', exact: true })
    .getByRole('button', { name, exact: true });
const reviewList = (page: Page) => page.getByRole('list', { name: 'Review queue' });
const detail = (page: Page) => page.getByRole('article', { name: 'Selected review item' });

async function waitForUtxoCheck(page: Page) {
  await expect(
    page.getByRole('list', { name: 'Wallet coverage' }).or(page.locator('.wallet-coverage')),
  ).toBeVisible();
  await expect(page.locator('.wallet-coverage')).toContainText('2 unspent', { timeout: 15000 });
}

async function screenshot(page: Page, name: string) {
  await mkdir('artifacts/wallet-review', { recursive: true });
  await page.screenshot({ path: `artifacts/wallet-review/${name}.png`, fullPage: true });
}

test('derives a resumable review queue from current coins and their sources', async ({ page }) => {
  await seed(page);
  await expect(workbench(page, 'Wallet')).toHaveAttribute('aria-pressed', 'true');
  await waitForUtxoCheck(page);
  await expect(page.locator('.wallet-coverage')).toContainText('85,000,000 sats');
  await expect(page.locator('.wallet-coverage')).toContainText('3 used of 4 discovered');

  // Unlabeled current coins come first, then the receipt that funded them.
  const rows = reviewList(page).getByRole('listitem');
  await expect(rows.first()).toContainText('Current UTXO');
  await expect(rows.first()).toContainText('60,000,000 sats');
  await expect(reviewList(page)).toContainText('Missing source label');
  await expect(reviewList(page)).toContainText('Unknown counterparty');
  // A labelled UTXO is still reviewable but never jumps ahead of unlabelled coins.
  await expect(rows.nth(1)).toContainText('Exchange A withdrawal');
  await screenshot(page, 'review-queue-desktop');

  await rows.first().click();
  await expect(detail(page)).toContainText('Unspent at the last check');
  await detail(page).getByRole('button', { name: 'Reviewed, source unknown' }).click();
  // The queue advances to the next open item and confirms the decision in place.
  await expect(page.locator('.wallet-review-status-line')).toContainText(
    'reviewed, source unknown',
  );
  await expect(reviewList(page)).not.toContainText('60,000,000 sats');
  await page.getByLabel('Review filter').selectOption('decided');
  await expect(reviewList(page)).toContainText('Source unknown');
  await page.getByLabel('Review filter').selectOption('open');

  // The decision is encrypted with the workspace and survives lock and reload.
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await expect(page.locator('.saved-row').first()).toBeVisible();
  const stored = await saved(page);
  const keys = Object.keys(stored.walletReviews ?? {});
  expect(keys).toHaveLength(1);
  expect(keys[0].startsWith(`${WALLET_ID}|current-utxo|`)).toBe(true);
  expect(stored.walletReviews![keys[0]].status).toBe('unknown');

  await page.reload();
  await unlock(page, 'Old public wallet');
  await expect(workbench(page, 'Wallet')).toHaveAttribute('aria-pressed', 'true');
  await waitForUtxoCheck(page);
  await page.getByLabel('Review filter').selectOption('decided');
  await expect(reviewList(page)).toContainText('Source unknown');
});

test('batch labels, tags and icons apply to the explicit selection in one undoable step', async ({
  page,
}) => {
  await seed(page);
  await waitForUtxoCheck(page);
  await page.getByRole('button', { name: /Records/ }).click();
  await expect(page.getByRole('button', { name: 'UTXOs', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: /Select 2 matching/ }).click();
  const bar = page.getByRole('group', { name: 'Batch metadata editing' });
  await expect(bar).toContainText('2 UTXOs selected');
  // Evidence-based guidance, not a score or a guarantee.
  await expect(bar).toContainText('1 of the selected outputs has no recorded source');

  await bar.getByRole('button', { name: 'Label' }).click();
  const labelEditor = page.getByRole('dialog', { name: 'Label selected records' });
  await expect(labelEditor).toContainText('1 of 2 records change');
  await labelEditor.getByLabel('Batch label').fill('Reviewed savings');
  await labelEditor.getByRole('button', { name: 'Apply label' }).click();
  await expect(page.locator('.wallet-review-records')).toContainText('Reviewed savings');
  // An existing label is preserved by default.
  await expect(page.locator('.wallet-review-records')).toContainText('Exchange A withdrawal');

  await bar.getByRole('button', { name: 'Tag', exact: true }).click();
  const tagEditor = page.getByRole('dialog', { name: 'Tag selected records' });
  await tagEditor.getByLabel('Find or create tag').fill('Savings');
  await tagEditor.getByRole('button', { name: 'Create and assign' }).click();
  await expect(tagEditor).toContainText('2 of 2 selected');
  await tagEditor.getByRole('button', { name: 'Close tag editor' }).click();
  // Tag membership is visible on the rows it was applied to.
  await expect(page.locator('.wallet-review-records')).toContainText('Savings');

  await bar.getByRole('button', { name: /^Set icon/ }).click();
  await page
    .getByRole('dialog', { name: 'Choose node icon' })
    .getByRole('button', { name: 'Savings' })
    .click();
  await screenshot(page, 'records-batch-desktop');

  let stored = await page.evaluate(() => document.title);
  expect(stored).toBeTruthy();
  await page.getByRole('button', { name: 'Undo workspace change' }).first().click();
  await expect(page.locator('.wallet-review-records')).not.toContainText('🏦');
  await page.getByRole('button', { name: 'Undo workspace change' }).first().click();
  await expect(page.locator('.wallet-review-records')).toContainText('Reviewed savings');
  await page.getByRole('button', { name: 'Undo workspace change' }).first().click();
  await expect(page.locator('.wallet-review-records')).not.toContainText('Reviewed savings');
  await expect(page.locator('.wallet-review-records')).toContainText('Exchange A withdrawal');
});

test('carries a record into Graph and Analysis and offers a way back', async ({ page }) => {
  await seed(page);
  await waitForUtxoCheck(page);
  await reviewList(page).getByRole('listitem').first().click();
  await detail(page).getByRole('button', { name: 'Show in Graph' }).click();
  await expect(workbench(page, 'Graph')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Back to Wallet' })).toBeVisible();
  await expect(page.locator('.right-panel')).toContainText(`${TX_MID.slice(0, 8)}`);

  await page.getByRole('button', { name: 'Back to Wallet' }).click();
  await expect(workbench(page, 'Wallet')).toHaveAttribute('aria-pressed', 'true');

  await detail(page).getByRole('button', { name: 'Analyze' }).click();
  await expect(workbench(page, 'Analysis')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.scan-scope')).toContainText('Output');
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.locator('.scan-run-note')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Wallet' }).click();
  await expect(workbench(page, 'Wallet')).toHaveAttribute('aria-pressed', 'true');
  // Returning keeps the queue and the previously selected item.
  await expect(detail(page)).toContainText('Current UTXO');
});

test('a refresh keeps decisions, flags new activity and stays inside one wallet', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    workspace.wallets.push(walletFixture(SECOND_WALLET_ID, 'Second public wallet', [receive[2]]));
  });
  await waitForUtxoCheck(page);
  const rows = reviewList(page).getByRole('listitem');
  await rows.first().click();
  await detail(page).getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(detail(page)).toContainText('Reviewed');

  const chain = await mockChain(page);
  chain.newActivity = true;
  await page.getByRole('button', { name: 'Refresh wallet' }).click();
  await expect(page.locator('.wallet-coverage')).toContainText('3 unspent', { timeout: 20000 });
  await expect(reviewList(page)).toContainText('New receipt');
  // Completed decisions survive the refresh.
  await page.getByLabel('Review filter').selectOption('decided');
  await expect(reviewList(page)).toContainText('Reviewed');
  await page.getByLabel('Review filter').selectOption('open');
  await screenshot(page, 'review-refresh-desktop');

  // A second wallet has its own queue; decisions never leak across wallets.
  await page.getByLabel('Selected wallet').selectOption({ label: 'Second public wallet' });
  await expect(page.locator('.wallet-coverage')).toContainText('1 used of 1 discovered');
  await page.getByRole('button', { name: /Records/ }).click();
  await expect(page.locator('.wallet-review-records')).not.toContainText(TX_MID.slice(0, 12));
});

test('stays usable on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await waitForUtxoCheck(page);
  await reviewList(page).getByRole('listitem').first().click();
  await expect(detail(page).getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
  await screenshot(page, 'review-queue-phone');
  await page.getByRole('button', { name: /Records/ }).click();
  await page.getByRole('button', { name: /Select 2 matching/ }).click();
  const bar = page.getByRole('group', { name: 'Batch metadata editing' });
  await bar.getByRole('button', { name: 'Label' }).click();
  const editor = page.getByRole('dialog', { name: 'Label selected records' });
  await expect(editor).toBeVisible();
  // The editor must be inside the visible viewport, not clipped by its panel.
  const box = await editor.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await screenshot(page, 'records-batch-phone');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
});

// The Wallet handoff reuses the accepted Analysis focus contract from 1efa564.
test('keyboard handoff reaches Graph and returns focus to the exact Wallet invoker', async ({
  page,
}) => {
  await seed(page);
  await waitForUtxoCheck(page);
  await reviewList(page).getByRole('listitem').first().click();
  const invoker = detail(page).getByRole('button', { name: 'Show in Graph' });
  await invoker.focus();
  await page.keyboard.press('Enter');
  await expect(workbench(page, 'Graph')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.graph-stage')).toBeVisible();
  // Focus moved into the Graph workspace rather than falling back to the body.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  const back = page.getByRole('button', { name: 'Back to Wallet' });
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(workbench(page, 'Wallet')).toHaveAttribute('aria-pressed', 'true');
  await expect(invoker).toBeFocused();
});
