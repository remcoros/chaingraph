import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { newWorkspace } from '../../src/domain/workspace';
import { deriveAddresses } from '../../src/lib/wallet';
import { encryptWorkspace } from '../../src/lib/crypto';
import { openFixtureWorkspace } from '../fixtures/open-workspace';
import { mockNetworkDiscovery, PUBLIC_ZPUB } from '../fixtures/bitcoin';

// Synthetic observations with a public wallet, not an on-chain transaction claim.
const parent = 'c'.repeat(64);
const txid = '001a406789abcdef'.repeat(4);
const message = 'Public memo <img src=x onerror=alert(1)> café ' + 'Bitcoin data. '.repeat(12);
const payload = Buffer.from(message).toString('hex');
const textScript = `6a4c${(payload.length / 2).toString(16)}${payload}`;

test('Wallet script outputs match Graph disclosures', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const workspace = newWorkspace('Synthetic script output fixture', 'mainnet');
  const [own] = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1);
  const walletId = '10000000-0000-4000-8000-000000000028';
  workspace.wallets = [
    {
      id: walletId,
      name: 'Public fixture wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#27c4a7',
      addresses: [{ ...own, history: [{ tx_hash: txid, height: 800000 }] }],
      scanComplete: true,
    },
  ];
  workspace.transactions = {
    [parent]: {
      txid: parent,
      vin: [{ coinbase: '00' }],
      vout: [
        {
          n: 0,
          value: 1,
          scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(own.address)) },
        },
      ],
    },
    [txid]: {
      txid,
      vin: [{ txid: parent, vout: 0 }],
      vout: [textScript, '51', '6a03ff0041', '6a0341', '6a'].map((hex, n) => ({
        n,
        value: 0,
        scriptPubKey: { hex },
      })),
      blockHeight: 800000,
      blocktime: 1690168629,
    },
  };
  workspace.annotations[`tx:${txid}`] = {
    label: 'Public data transaction',
    note: '',
    icon: '',
    bookmarked: false,
  };
  workspace.annotations[`out:${txid}:0`] = {
    label: 'Public memo',
    note: '',
    icon: '📝',
    bookmarked: false,
  };
  workspace.tags = [
    {
      id: '10000000-0000-4000-8000-000000000029',
      name: 'Memo',
      color: '#718ec2',
      nodeIds: [`out:${txid}:0`],
    },
  ];
  workspace.view = {
    ...workspace.view,
    workbench: 'wallet',
    selectedWallet: walletId,
    dimensions: 2,
  };
  await mockNetworkDiscovery(page, { networks: ['testnet4'] });
  const calls: string[] = [];
  await page.route('**/api/rpc', async (route) => {
    calls.push(route.request().postDataJSON().method);
    await route.fulfill({ status: 400, json: { error: 'Outside fixture' } });
  });
  await openFixtureWorkspace(page, workspace, 'public-script-fixture');
  await page
    .getByRole('navigation', { name: 'Wallet sections' })
    .getByRole('button', { name: 'Transactions', exact: true })
    .click();
  await page.locator('.wallet-row-button').filter({ hasText: 'Public data transaction' }).click();
  const flow = page.getByRole('figure', { name: 'Wallet transaction flow' });
  await expect(flow).toBeVisible();
  const outputs = flow.locator('.wallet-flow-column').nth(1);
  await flow.scrollIntoViewIfNeeded();
  await mkdir('artifacts/wallet-polish', { recursive: true });
  if (!process.env.WALLET_POLISH_BASELINE) {
    await writeFile(
      'artifacts/wallet-polish/synthetic-script-outputs.chaingraph',
      JSON.stringify({
        id: workspace.id,
        publicName: workspace.name,
        savedAt: new Date().toISOString(),
        envelope: await encryptWorkspace({ ...workspace, demo: true }, 'public-script-fixture'),
      }),
    );
  }
  if (process.env.WALLET_POLISH_BASELINE) return;
  const memo = outputs.locator('.wallet-flow-node').first();
  await expect(memo).toContainText('Unspendable');
  await expect(memo).not.toContainText('Unknown');
  await expect(memo).toContainText('📝');
  await expect(memo.locator('.wallet-flow-tag')).toHaveText('Memo');
  await expect(outputs.locator('.wallet-flow-node').nth(1)).toContainText('Script output');
  const data = memo.locator('.op-return-data');
  await expect(data.locator('summary')).toHaveAttribute('title', message);
  await data.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(data.locator('pre')).toHaveText(message);
  await expect(data.locator('img')).toHaveCount(0);
  await data.getByRole('button', { name: 'Copy OP_RETURN data', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(message);
  await memo.getByRole('button', { name: 'Copy outpoint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${txid}:0`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await outputs.getByRole('button', { name: 'Expand outputs', exact: true }).click();
  await expect(outputs.locator('.wallet-flow-node')).toHaveCount(5);
  for (const [index, display] of [
    [2, '0xff0041'],
    [3, '0x0341'],
    [4, '(empty data)'],
  ] as const) {
    const special = outputs.locator('.wallet-flow-node').nth(index).locator('.op-return-data');
    await special.locator('summary').click();
    await expect(special.locator('pre')).toHaveText(display);
    if (index === 3) await expect(special.locator('.warning')).toContainText('Truncated push data');
  }
  await outputs.getByRole('button', { name: 'Collapse outputs', exact: true }).click();
  await expect(outputs.locator('.wallet-flow-node')).toHaveCount(2);
  await memo.getByRole('button', { name: `Show output ${txid}:0 on graph`, exact: true }).click();
  const graph = page.locator('.transaction-view');
  if ((await graph.getAttribute('open')) === null) await graph.locator('summary').first().click();
  const graphData = graph.locator('.transaction-row.is-selected .op-return-data');
  await expect(graphData.locator('summary')).toHaveAttribute('title', message);
  await graphData.locator('summary').click();
  await expect(graphData.locator('pre')).toHaveText(message);
  await expect(page.locator('.selection-heading')).toContainText('Unspendable output');
  await page.getByRole('button', { name: 'Back to Wallet', exact: true }).click();
  await expect(memo).toContainText('OP_RETURN');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
