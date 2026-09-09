import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Transaction, Wallet, Workspace } from '../../src/domain/types';
import { analysisTools } from '../../src/domain/analysis';
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
  await expect(reviewList(page)).toContainText('Source');
  await expect(reviewList(page)).toContainText('Counterparty');
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
  await page.getByRole('button', { name: /Select all 2 results/ }).click();
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
  // Applying the batch closes its editor; membership is visible on the rows.
  await expect(tagEditor).toBeHidden();
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
  await expect(page.locator('.wallet-review-status-line')).toContainText('reviewed');

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
  await page.getByRole('button', { name: /Select all 2 results/ }).click();
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

// RUX-002: a deferral is not a completed review.
test('Review later keeps refreshed activity discoverable across views and a reload', async ({
  page,
}) => {
  await seed(page);
  await waitForUtxoCheck(page);
  const chain = await mockChain(page);
  chain.newActivity = true;
  await page.getByRole('button', { name: 'Refresh wallet' }).click();
  await expect(page.locator('.wallet-coverage')).toContainText('3 unspent', { timeout: 20000 });
  await reviewList(page).getByRole('listitem').filter({ hasText: 'New receipt' }).click();
  await expect(detail(page)).toContainText('New activity since your last review');
  await detail(page).getByRole('button', { name: 'Review later' }).click();

  // Deferred work moves out of To review into its own view, without completion.
  await expect(reviewList(page)).not.toContainText('New receipt');
  await page.getByLabel('Review filter').selectOption('later');
  await expect(reviewList(page)).toContainText('New receipt');
  await page.getByLabel('Review filter').selectOption('all');
  await expect(reviewList(page)).toContainText('Review later');
  await page.getByLabel('Review filter').selectOption('decided');
  // Nothing is completed, so the deferred item must not appear as reviewed.
  await expect(reviewList(page)).toHaveCount(0);
  await expect(page.locator('.wallet-empty-note')).toContainText('Nothing has been reviewed yet');
  await page.getByLabel('Review filter').selectOption('open');
  await expect(reviewList(page)).not.toContainText('New receipt');

  // Records agrees: deferred work has its own filter and is not completed.
  await page.getByRole('button', { name: /Records/ }).click();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await page.getByLabel('Review state filter').selectOption('open');
  await expect(page.locator('.wallet-review-records')).not.toContainText(TX_NEW.slice(0, 12));
  await page.getByLabel('Review state filter').selectOption('later');
  await expect(page.locator('.wallet-review-records')).toContainText(TX_NEW.slice(0, 12));
  await page.getByLabel('Review state filter').selectOption('decided');
  await expect(page.locator('.wallet-review-records')).not.toContainText(TX_NEW.slice(0, 12));

  // Locking flushes the encrypted save, so persistence is checked on real storage.
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await expect(page.locator('.saved-row').first()).toBeVisible();
  const workspace = await saved(page);
  expect(workspace.wallets[0].unreviewedTransactionIds).toContain(TX_NEW);
  expect(
    Object.entries(workspace.walletReviews ?? {}).filter(
      ([key, value]) => key.includes('|new-activity|') && value.status === 'later',
    ),
  ).toHaveLength(1);

  await page.reload();
  await unlock(page, 'Old public wallet');
  await page.getByLabel('Review filter').selectOption('later');
  await expect(reviewList(page)).toContainText('New receipt', { timeout: 20000 });
  await expect(reviewList(page)).toContainText('Review later');
});

// RUX-004: batch editors are mutually exclusive and return focus after applying.
test('batch editors never stack and the icon palette stays keyboard usable', async ({ page }) => {
  await seed(page);
  await waitForUtxoCheck(page);
  await page.getByRole('button', { name: /Records/ }).click();
  await page.getByRole('button', { name: /Select all 2 results/ }).click();
  const bar = page.getByRole('group', { name: 'Batch metadata editing' });
  const tagButton = bar.getByRole('button', { name: 'Tag', exact: true });
  await tagButton.click();
  const tagEditor = page.getByRole('dialog', { name: 'Tag selected records' });
  await tagEditor.getByLabel('Find or create tag').fill('Savings');
  await tagEditor.getByRole('button', { name: 'Create and assign' }).click();
  // Applying the batch closes the editor and returns focus to its trigger.
  await expect(tagEditor).toBeHidden();
  await expect(tagButton).toBeFocused();

  await tagButton.click();
  await expect(tagEditor).toBeVisible();
  await bar.getByRole('button', { name: /^Set icon/ }).click();
  const palette = page.getByRole('dialog', { name: 'Choose node icon' });
  await expect(palette).toBeVisible();
  await expect(tagEditor).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(1);

  // The palette grid is reachable and arrow keys move within it.
  await page.keyboard.press('ArrowRight');
  await expect(palette.getByRole('button', { name: 'Diamond' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

// RUX-005: Inspect reveals the Inspector, so focus must land there, not on a hidden canvas.
test('keyboard Inspect on a phone focuses the revealed Inspector', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await waitForUtxoCheck(page);
  await reviewList(page).getByRole('listitem').first().click();
  const invoker = detail(page).getByRole('button', { name: 'Inspect', exact: true });
  await invoker.focus();
  await page.keyboard.press('Enter');
  await expect(workbench(page, 'Graph')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.right-panel')).toBeVisible();
  const landed = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName ?? 'NONE',
      inPanel: !!active && !!document.querySelector('.right-panel')?.contains(active),
    };
  });
  expect(landed.tag).not.toBe('BODY');
  expect(landed.inPanel).toBe(true);
  // The accepted return contract still restores the exact invoker.
  const back = page.getByRole('button', { name: 'Back to Wallet' });
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(invoker).toBeFocused();
});

// RUX-P02: queue rows keep real button semantics inside their list items.
test('review rows expose button semantics with a pressed state', async ({ page }) => {
  await seed(page);
  await waitForUtxoCheck(page);
  const rows = reviewList(page).getByRole('listitem');
  const firstButton = rows.first().getByRole('button');
  const secondButton = rows.nth(1).getByRole('button');
  await expect(firstButton).toHaveCount(1);
  // The queue opens on its first row, so the pressed state must track selection.
  await expect(firstButton).toHaveAttribute('aria-pressed', 'true');
  await expect(secondButton).toHaveAttribute('aria-pressed', 'false');
  await secondButton.click();
  await expect(secondButton).toHaveAttribute('aria-pressed', 'true');
  await expect(firstButton).toHaveAttribute('aria-pressed', 'false');
});

for (const phone of [false, true]) {
  test(`cached wallet navigation preserves Undo and findings, new evidence invalidates them (${phone ? 'phone' : 'desktop'})`, async ({
    page,
  }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    const { chain } = await seed(page, (workspace) => {
      workspace.findings = analysisTools.flatMap((tool) => tool.run(workspace));
      expect(workspace.findings.length).toBeGreaterThan(0);
      workspace.inputContext = { [TX_MID]: [0] };
      workspace.contextTransactionIds = [TX_MID];
    });
    await waitForUtxoCheck(page);
    await reviewList(page).getByRole('listitem').first().click();
    await detail(page).getByRole('button', { name: 'Label', exact: true }).click();
    const labelEditor = page.getByRole('dialog', { name: 'Label selected records' });
    await labelEditor.getByLabel('Batch label').fill('Cached coin label');
    await labelEditor.getByRole('button', { name: 'Apply label' }).click();
    const checkUndo = async (enabled: boolean, apply = false) => {
      if (phone) await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
      const undo = phone ? page.locator('.mobile-workspace-undo') : page.locator('.workspace-undo');
      if (enabled) await expect(undo).toBeEnabled();
      else await expect(undo).toBeDisabled();
      if (apply) await undo.click();
      else if (phone) await page.keyboard.press('Escape');
    };
    await checkUndo(true);
    const callsBeforeInspect = chain.calls.length;
    await detail(page).getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Cached coin label');
    await checkUndo(true);
    expect(chain.calls).toHaveLength(callsBeforeInspect);
    await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
    let stored = await saved(page);
    expect(stored.findings.every((finding) => !finding.stale)).toBe(true);
    expect(stored.inputContext?.[TX_MID]).toBeUndefined();
    expect(stored.contextTransactionIds ?? []).not.toContain(TX_MID);
    await checkUndo(true, true);
    await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('');
    await page.getByLabel('Node notes', { exact: true }).fill('Keep this note while navigating');
    const tabs = page.locator('.right-panel .panel-tabs');
    await tabs.getByRole('button', { name: 'Transactions', exact: true }).click();
    const callsBeforeTransaction = chain.calls.length;
    await page
      .getByRole('button', { name: `Select wallet transaction ${TX_MID}`, exact: true })
      .click();
    await checkUndo(true);
    expect(chain.calls).toHaveLength(callsBeforeTransaction);
    await workbench(page, 'Analysis').click();
    await expect(page.locator('.analysis-workbench')).not.toContainText('Needs rerun');
    await workbench(page, 'Graph').click();
    await page.getByLabel('Transaction, output, or address', { exact: true }).fill(TX_NEW);
    await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
    await expect(page.locator('.statusbar')).toContainText('4 transactions');
    await checkUndo(false);
    await workbench(page, 'Analysis').click();
    await expect(page.locator('.analysis-workbench')).toContainText('Needs rerun');
    await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
    stored = await saved(page);
    expect(stored.findings.every((finding) => finding.stale)).toBe(true);
    expect(stored.annotations[`out:${TX_MID}:0`].note).toBe('Keep this note while navigating');
    expect(stored.transactions[TX_NEW]).toBeDefined();
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`wallet polish keeps metadata visible and editors reachable (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await seed(page);
    await waitForUtxoCheck(page);
    await screenshot(page, `polish-${viewport.name}-initial`);
    await reviewList(page).getByRole('listitem').nth(1).getByRole('button').click();
    const initialCount = await reviewList(page).getByRole('listitem').count();
    const bar = detail(page).getByRole('group', { name: 'Edit entity metadata' });
    await bar.getByRole('button', { name: 'Label', exact: true }).click();
    let editor = page.getByRole('dialog', { name: 'Label selected records' });
    await expect(editor.getByLabel('Batch label')).toHaveValue('Exchange A withdrawal');
    await editor.getByLabel('Batch label').fill('Cold storage');
    const apply = editor.getByRole('button', { name: 'Apply label' });
    const box = await apply.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(viewport.height);
    expect(
      await apply.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
      }),
    ).toBe(true);
    await screenshot(page, `polish-${viewport.name}-label-editor`);
    await apply.click();
    await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText('Cold storage');
    await expect(reviewList(page)).toContainText('Cold storage');
    await expect(reviewList(page).getByRole('listitem')).toHaveCount(initialCount);
    await bar.getByRole('button', { name: 'Label', exact: true }).click();
    editor = page.getByRole('dialog', { name: 'Label selected records' });
    await expect(editor.getByLabel('Batch label')).toHaveValue('Cold storage');
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Tag', exact: true }).click();
    const tag = page.getByRole('dialog', { name: 'Tag selected records' });
    await tag.getByLabel('Find or create tag').fill('Long-term savings');
    await tag.getByRole('button', { name: 'Create and assign' }).click();
    await expect(detail(page)).toContainText('Long-term savings');
    await expect(reviewList(page)).toContainText('Long-term savings');
    for (const name of ['Savings', 'Cold storage']) {
      await bar.getByRole('button', { name: /^Set icon/ }).click();
      await page
        .getByRole('dialog', { name: 'Choose node icon' })
        .getByRole('button', { name, exact: true })
        .click();
    }
    await expect(detail(page).getByRole('heading', { level: 2 })).toContainText('❄️');
    await expect(reviewList(page)).toContainText('❄️');
    if (viewport.name === 'desktop') {
      await detail(page)
        .getByRole('button', { name: 'Analyze', exact: true })
        .scrollIntoViewIfNeeded();
      const actions = await detail(page)
        .getByRole('button', { name: 'Analyze', exact: true })
        .boundingBox();
      const panel = await page.locator('.wallet-workbench').boundingBox();
      expect(actions!.y + actions!.height).toBeLessThanOrEqual(panel!.y + panel!.height);
    }
    await screenshot(page, `polish-${viewport.name}-metadata`);
    if (viewport.name === 'phone')
      await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo workspace change' }).first()).toBeEnabled();
  });
}

test('wallet records support range selection, additive toggles and an explicit hidden batch scope', async ({
  page,
}) => {
  await seed(page);
  await waitForUtxoCheck(page);
  await page.getByRole('button', { name: /Records/ }).click();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  const rows = page.locator('.wallet-review-records').getByRole('listitem');
  const bodies = rows.getByRole('button', { name: /^Select record/ });
  const checks = rows.getByRole('checkbox');
  await expect(rows).toHaveCount(3);
  await bodies.first().click();
  await bodies.nth(2).click({ modifiers: ['Shift'] });
  await expect(checks).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(checks.nth(i)).toBeChecked();
  await bodies.nth(1).click({ modifiers: ['Control'] });
  await expect(checks.nth(1)).not.toBeChecked();
  const bar = page.getByRole('group', { name: 'Batch metadata editing' });
  await expect(bar).toContainText('2 transactions selected');
  await page.getByLabel('Filter wallet records').fill(TX_OLD);
  await expect(page.locator('.wallet-review-records').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText(/1 selected record outside/)).toBeVisible();
  await expect(bar).toContainText('2 transactions selected');
  await bar.getByRole('button', { name: 'Label', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Label selected records' });
  await editor.getByLabel('Batch label').fill('Selected transfers');
  await editor.getByRole('button', { name: 'Apply label' }).click();
  await page.getByLabel('Filter wallet records').fill('');
  await expect(rows.filter({ hasText: 'Selected transfers' })).toHaveCount(2);
  await expect(rows.nth(1)).not.toContainText('Selected transfers');
  await bar.getByRole('button', { name: 'Clear selection' }).click();
  // Checkbox ranges include the intermediate rows and remain keyboard accessible.
  await checks.first().click();
  await checks.nth(2).click({ modifiers: ['Shift'] });
  for (let i = 0; i < 3; i++) await expect(checks.nth(i)).toBeChecked();
  await checks.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(checks.nth(1)).not.toBeChecked();
  await screenshot(page, 'polish-records-range-selection');
  await page.getByRole('button', { name: 'Addresses', exact: true }).click();
  await expect(bar).toBeHidden();
});

test('queue selection batches metadata, defers to untouched work and reopens into To review', async ({
  page,
}) => {
  await seed(page);
  await waitForUtxoCheck(page);
  const rows = reviewList(page).getByRole('listitem');
  // Shift range starts at the ordinary selected review row, not only at a checkbox.
  await rows.first().getByRole('button').click();
  await rows
    .nth(1)
    .getByRole('button')
    .click({ modifiers: ['Shift'] });
  const bar = page.getByRole('group', { name: 'Batch metadata editing' });
  await expect(bar).toContainText('2 entities selected');
  await expect(detail(page)).toBeHidden();
  await bar.getByRole('button', { name: 'Label', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Label selected records' });
  await editor.getByLabel('Batch label').fill('Wallet savings');
  await editor.getByLabel('Replace existing labels').check();
  await editor.getByRole('button', { name: 'Apply label' }).click();
  await expect(rows.filter({ hasText: 'Wallet savings' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Review selected later', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(detail(page)).toContainText('Source');
  await expect(reviewList(page)).not.toContainText('Wallet savings');
  await page.getByLabel('Review filter').selectOption('later');
  await expect(rows).toHaveCount(2);
  await expect(
    detail(page).getByRole('button', { name: 'Return to review', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await detail(page).getByRole('button', { name: 'Return to review', exact: true }).click();
  await expect(page.getByLabel('Review filter')).toHaveValue('open');
  await expect(detail(page)).toContainText('Wallet savings');
  await detail(page).getByRole('button', { name: 'Mark reviewed', exact: true }).click();
  await page.getByLabel('Review filter').selectOption('decided');
  await expect(
    detail(page).getByRole('button', { name: 'Mark reviewed', exact: true }),
  ).toHaveCount(0);
  await detail(page).getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(page.getByLabel('Review filter')).toHaveValue('open');
  await expect(detail(page)).toContainText('Wallet savings');
});

for (const kind of ['Label', 'Tag'] as const) {
  test(`wallet ${kind} editor closes when keyboard navigation leaves the workbench`, async ({
    page,
  }) => {
    await seed(page);
    await waitForUtxoCheck(page);
    await detail(page).getByRole('button', { name: kind, exact: true }).click();
    await expect(page.locator('.wallet-metadata-popover')).toBeVisible();
    // A focus-driven activation has no outside pointerdown to dismiss the editor.
    await workbench(page, 'Analysis').focus();
    await page.keyboard.press('Enter');
    await expect(workbench(page, 'Analysis')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.wallet-metadata-popover')).toHaveCount(0);
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('.wallet-metadata-popover')),
    ).toBe(false);
    await workbench(page, 'Wallet').click();
    await expect(page.locator('.wallet-metadata-popover')).toHaveCount(0);
  });
}

for (const phone of [false, true]) {
  test(`wallet review context distinguishes wallet outputs from counterparties (${phone ? 'phone' : 'desktop'})`, async ({
    page,
  }) => {
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await seed(page);
    await waitForUtxoCheck(page);
    const filter = page.getByLabel('Review filter');
    await expect(filter.locator('option[value="open"]')).toHaveText('To review (4)');
    await expect(filter.locator('option[value="later"]')).toHaveText('Review later (0)');
    await expect(filter.locator('option[value="decided"]')).toHaveText('Reviewed (0)');
    await expect(filter.locator('option[value="all"]')).toHaveText('All items (4)');
    const flow = detail(page).getByRole('figure', { name: 'Wallet transaction flow' });
    await expect(flow).toBeVisible();
    await expect(detail(page).locator('.wallet-context-badge')).toHaveText('Your wallet output');
    await expect(flow.locator('.ownership-wallet')).toHaveCount(2);
    await expect(flow.locator('.ownership-external')).toHaveCount(1);
    await expect(flow.locator('.is-selected')).toContainText('60,000,000 sats');
    await reviewList(page).getByRole('listitem').first().getByRole('button').click();
    await screenshot(page, `wallet-context-${phone ? 'phone' : 'desktop'}`);
    const input = flow.getByRole('button', { name: `Inspect input ${TX_OLD}:0`, exact: true });
    await input.click();
    await expect(page.getByLabel('Node label', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Wallet', exact: true }).click();
    await expect(input).toBeFocused();
    await reviewList(page)
      .getByRole('listitem')
      .filter({ hasText: 'Counterparty' })
      .getByRole('button')
      .click();
    await expect(detail(page).locator('.wallet-context-badge')).toHaveText('Possible counterparty');
    await expect(flow.locator('.is-selected')).toHaveClass(/ownership-external/);
    await expect(flow.locator('.is-selected')).toContainText('No wallet match');
    await screenshot(page, `wallet-counterparty-${phone ? 'phone' : 'desktop'}`);
    await expect(
      detail(page).getByRole('region', { name: 'Selected entity metadata' }),
    ).toContainText('shop or recipient');
    await detail(page).getByRole('button', { name: 'Mark reviewed', exact: true }).click();
    await expect(filter.locator('option[value="open"]')).toHaveText('To review (3)');
    await expect(filter.locator('option[value="decided"]')).toHaveText('Reviewed (1)');
    await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Add a wallet', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });
}

test('related selection uses exact addresses and transactions within the current results', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    workspace.transactions[TX_MID].vout.push({
      n: 2,
      value: 0.001,
      scriptPubKey: { hex: script(EXTERNAL) },
    });
  });
  await waitForUtxoCheck(page);
  const rows = reviewList(page).getByRole('listitem');
  await expect(rows).toHaveCount(5);
  await rows.filter({ hasText: 'Counterparty' }).first().getByRole('button').click();
  await page.getByRole('button', { name: 'Select related', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Select related results' });
  await expect(menu.getByRole('button', { name: 'Same address 2' })).toBeEnabled();
  await expect(menu.getByRole('button', { name: 'Same transaction 3' })).toBeEnabled();
  await menu.getByRole('button', { name: 'Same address 2' }).click();
  const bar = page.getByRole('group', { name: 'Batch metadata editing' });
  await expect(bar).toContainText('2 entities selected');
  await expect(rows.filter({ hasText: 'Counterparty' }).getByRole('checkbox')).toHaveCount(2);
  await expect(rows.first().getByRole('checkbox')).not.toBeChecked();
  await bar.getByRole('button', { name: 'Label', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Label selected records' });
  await editor.getByLabel('Batch label').fill('Neighborhood shop');
  await editor.getByRole('button', { name: 'Apply label' }).click();
  await expect(rows.filter({ hasText: 'Neighborhood shop' })).toHaveCount(2);
  await expect(rows.first()).not.toContainText('Neighborhood shop');
  await page.getByRole('button', { name: 'Select all 5 results', exact: true }).click();
  await expect(bar).toContainText('5 entities selected');
  await screenshot(page, 'wallet-related-selection');
});

test('compact wallet flow keeps a late selected output visible and expands a bounded list', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    for (let n = 2; n < 9; n++)
      workspace.transactions[TX_MID].vout.push({
        n,
        value: 0.001,
        scriptPubKey: { hex: script(EXTERNAL) },
      });
    workspace.annotations[`out:${TX_MID}:8`] = {
      label: 'Final shop payment',
      note: '',
      icon: '',
      bookmarked: false,
    };
  });
  await waitForUtxoCheck(page);
  await reviewList(page)
    .getByRole('listitem')
    .filter({ hasText: 'Final shop payment' })
    .getByRole('button')
    .click();
  const flow = detail(page).getByRole('figure', { name: 'Wallet transaction flow' });
  await expect(flow.locator('.is-selected')).toContainText('Final shop payment');
  await expect(flow.locator('.wallet-flow-node')).toHaveCount(3);
  await flow.getByRole('button', { name: 'All 9', exact: true }).click();
  await expect(flow.locator('.wallet-flow-node')).toHaveCount(10);
  const outputColumn = flow.locator('.wallet-flow-column').last();
  await expect(outputColumn.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
  const entries = outputColumn.locator('.wallet-flow-entries');
  const first = outputColumn.locator('.wallet-flow-node').first();
  const top = (await entries.boundingBox())!.y;
  expect((await first.boundingBox())!.y).toBeGreaterThanOrEqual(top);
  await outputColumn.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(flow.locator('.wallet-flow-node')).toHaveCount(3);
  await expect(flow.locator('.is-selected')).toContainText('Final shop payment');
});
