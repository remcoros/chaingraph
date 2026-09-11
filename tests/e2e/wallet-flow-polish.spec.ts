import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { newWorkspace } from '../../src/domain/workspace';
import { deriveAddresses } from '../../src/lib/wallet';
import { openFixtureWorkspace } from '../fixtures/open-workspace';
import { encryptWorkspace } from '../../src/lib/crypto';
import { mockNetworkDiscovery, PUBLIC_ZPUB, type MockCall } from '../fixtures/bitcoin';

const parent = 'a'.repeat(64);
const payout = 'b'.repeat(64);
const source = bitcoinAddress.toBech32(new Uint8Array(20).fill(7), 0, 'bc');
const other = bitcoinAddress.toBech32(new Uint8Array(20).fill(8), 0, 'bc');
const script = (address: string) => ({ hex: bytesToHex(bitcoinAddress.toOutputScript(address)) });

test('synthetic 11-output payout preserves source and wallet', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const workspace = newWorkspace('Synthetic 11-output payout', 'mainnet');
  const [own] = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1);
  const walletId = '10000000-0000-4000-8000-000000000026';
  workspace.wallets = [
    {
      id: walletId,
      name: 'Public fixture wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#27c4a7',
      addresses: [{ ...own, history: [{ tx_hash: payout, height: 800000 }] }],
      scanComplete: true,
      scannedAt: '2026-09-09T10:00:00Z',
    },
  ];
  workspace.transactions = {
    [parent]: {
      txid: parent,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 2, scriptPubKey: script(source) }],
      blockHeight: 799999,
      blocktime: 1690155901,
    },
    [payout]: {
      txid: payout,
      vin: [{ txid: parent, vout: 0 }],
      vout: Array.from({ length: 11 }, (_, n) => ({
        n,
        value: n === 10 ? 0.25 : 0.1,
        scriptPubKey: script(n === 10 ? own.address : n === 9 ? source : other),
      })),
      blockHeight: 800000,
      blocktime: 1690168629,
    },
  };
  const annotation = (label: string, icon = '') => ({ label, icon, note: '', bookmarked: false });
  workspace.annotations = {
    [`addr:${source}`]: annotation('Payout source', '🏦'),
    [`out:${payout}:10`]: annotation('My withdrawal', '💰'),
    [`tx:${payout}`]: annotation('Exchange payout'),
  };
  workspace.tags = [
    {
      id: '10000000-0000-4000-8000-000000000027',
      name: 'Withdrawal',
      color: '#718ec2',
      nodeIds: [`out:${payout}:10`],
    },
  ];
  workspace.view = {
    ...workspace.view,
    dimensions: 2,
    workbench: 'wallet',
    selectedWallet: walletId,
    lockToSelection: false,
  };
  if (!process.env.WALLET_POLISH_BASELINE) {
    // A local-only manual review fixture, with live lookups disabled.
    const envelope = await encryptWorkspace({ ...workspace, demo: true }, 'public-fixture');
    await mkdir('artifacts/wallet-polish', { recursive: true });
    await writeFile(
      'artifacts/wallet-polish/synthetic-payout.chaingraph',
      JSON.stringify(envelope),
    );
    await writeFile(
      'artifacts/wallet-polish/preview.html',
      `<!doctype html><meta name="viewport" content="width=device-width"><title>Wallet flow review</title>
        <style>body{font:16px system-ui;background:#141b1e;color:#e8ecef;max-width:640px;margin:60px auto;padding:20px;line-height:1.6}a{color:#b8e87a}button{font:inherit;padding:8px 12px;cursor:pointer}</style>
        <h1>Wallet flow review</h1><p>Synthetic 11-output payout using a public test wallet. Live lookups are disabled for this fixture.</p>
        <p>Unlock with <strong>public-fixture</strong>, then choose <strong>Sources → Payout source</strong>. The source-matching output and wallet payout should both be visible.</p>
        <button id="open">Add fixture and open Chaingraph</button><p><a href="/">Open app without adding a fixture</a></p>
        <script>document.getElementById('open').onclick=()=>{const key='chaingraph.encrypted-workspaces.v1';const entries=JSON.parse(localStorage.getItem(key)||'[]');const entry=${JSON.stringify({ id: workspace.id, publicName: workspace.name, savedAt: new Date().toISOString(), envelope })};if(!entries.some(item=>item.id===entry.id)){entries.push(entry);localStorage.setItem(key,JSON.stringify(entries));}localStorage.setItem('chaingraph.tour.seen','1');location.href='/';};</script>`,
    );
  }
  await mockNetworkDiscovery(page);
  const calls: MockCall[] = [];
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    calls.push(call);
    const result =
      call.method === 'blockchain.scripthash.listunspent'
        ? [{ tx_hash: payout, tx_pos: 10, height: 800000, value: 25000000 }]
        : call.method === 'getrawtransaction'
          ? workspace.transactions[call.params[0] as string]
          : undefined;
    return result === undefined
      ? route.fulfill({ status: 400, json: { error: 'Outside fixture' } })
      : route.fulfill({ json: { result } });
  });
  await openFixtureWorkspace(page, workspace, 'public-fixture');
  await page
    .getByRole('navigation', { name: 'Wallet sections' })
    .getByRole('button', { name: 'Sources', exact: true })
    .click();
  await page.locator('.wallet-row-button').filter({ hasText: 'Payout source' }).click();
  const flow = page.getByRole('figure', { name: 'Wallet transaction flow' });
  await expect(flow).toBeVisible();
  const output = flow.locator('.wallet-flow-column').nth(1);
  await expect(output.locator('.is-selected')).toContainText('Editing address');
  await flow.scrollIntoViewIfNeeded();
  if (!process.env.WALLET_POLISH_BASELINE) {
    await expect(output).toContainText('My withdrawal');
    await expect(output).toContainText('Withdrawal');
    await expect(output.locator('.ownership-wallet')).toHaveCount(1);
    await expect(output.locator('.wallet-flow-node')).toHaveCount(2);
    await expect(flow.locator('.wallet-flow-transaction-node')).toContainText('#800000');
    await expect(flow.locator('.wallet-flow-transaction-node')).toContainText(
      'Transaction (1 in/11 out)',
    );
    await expect(flow.locator('.wallet-flow-transaction-node code')).toHaveText(
      'bbbbbbb...bbbbbbb',
    );
    await expect(flow.locator('.wallet-flow-transaction-node')).toContainText('GMT');
    await output.getByRole('button', { name: 'Expand outputs', exact: true }).click();
    await expect(output.locator('.wallet-flow-node')).toHaveCount(11);
    await output.getByRole('button', { name: 'Collapse outputs', exact: true }).click();
    await expect(output.locator('.wallet-flow-node')).toHaveCount(2);
    await expect(output).toContainText('My withdrawal');
  }
  const show = flow.getByRole('button', {
    name: `Show output ${payout}:9 on graph`,
    exact: true,
  });
  await show.click();
  await expect(
    page
      .getByRole('navigation', { name: 'Workbench', exact: true })
      .getByRole('button', { name: 'Graph', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const graphFlow = page.locator('.transaction-view');
  if ((await graphFlow.getAttribute('open')) === null)
    await graphFlow.locator('summary').click({ position: { x: 10, y: 12 } });
  await expect(graphFlow).toBeVisible();
  await expect(graphFlow.locator('.transaction-identity-select')).toContainText(
    'Creating transaction (1 in/11 out)',
  );
  await expect(graphFlow.locator('.transaction-view-identity time')).toHaveAttribute(
    'title',
    /2023-07-24 03:17:09 GMT/,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Back to Wallet', exact: true }).click();
  await expect(show).toBeFocused();
  if (!process.env.WALLET_POLISH_BASELINE) {
    await page
      .getByRole('group', { name: 'Edit entity metadata', exact: true })
      .getByRole('button', { name: 'Label', exact: true })
      .click();
    const editor = page.getByRole('dialog', { name: 'Label selected records' });
    await editor.getByLabel('Batch label').fill('Source annotation updated');
    await editor.getByRole('button', { name: 'Apply label' }).click();
    await expect(output.locator('.is-selected')).toContainText('Source annotation updated');
    await expect(output.locator('.ownership-wallet')).toContainText('My withdrawal');
    const disclosure = page.locator('.wallet-flow-disclosure');
    await disclosure.locator('summary').click();
    await expect(flow).toHaveCount(0);
    await disclosure.locator('summary').click();
    await expect(output.locator('.ownership-wallet')).toContainText('My withdrawal');
    await page
      .getByRole('navigation', { name: 'Wallet sections' })
      .getByRole('button', { name: 'UTXOs', exact: true })
      .click();
    await page.locator('.wallet-row-button').filter({ hasText: 'My withdrawal' }).click();
    await expect(flow.locator('.ownership-wallet.is-selected')).toContainText('Editing output');
    await expect(page.locator('.wallet-subject-card')).toContainText('#800000');
    await expect(page.locator('.wallet-subject-card time')).toHaveAttribute(
      'title',
      /2023-07-24 03:17:09 GMT/,
    );
    await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', {
      timeout: 20000,
    });
  }
  expect(calls.filter((call) => call.method === 'getrawtransaction')).toEqual([]);
});

test('bundled public wallet snapshot keeps transaction metadata and editable context coherent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockNetworkDiscovery(page);
  await page.route('**/api/rpc', (route) =>
    route.fulfill({ status: 400, json: { error: 'Cached snapshot review only' } }),
  );
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create Explore a public demo wallet workspace', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill('public-fixture');
  await dialog.getByLabel('Confirm password').fill('public-fixture');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Workbench', exact: true })
    .getByRole('button', { name: 'Wallet', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Wallet sections' })
    .getByRole('button', { name: 'Transactions', exact: true })
    .click();
  await page.getByLabel('Filter wallet records', { exact: true }).fill('Demo wallet');
  await page
    .locator('.wallet-row-button')
    .filter({ hasText: /Demo wallet (spending|funding) hop/ })
    .first()
    .click();
  const flow = page.getByRole('figure', { name: 'Wallet transaction flow' });
  await expect(flow.locator('.wallet-flow-transaction-node')).toContainText('Editing transaction');
  await expect(flow.locator('.wallet-flow-transaction-node')).toContainText('GMT');
  await page.setViewportSize({ width: 390, height: 844 });
  await flow.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
