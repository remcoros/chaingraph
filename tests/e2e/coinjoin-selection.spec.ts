import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Transaction } from '../../src/domain/types';
import { WORKSPACE_TEMPLATES } from '../../src/domain/workspaceTemplates';
import { mockBitcoin } from '../fixtures/bitcoin';

test('a real WabiSabi input opens its creating CoinJoin without downloading its other input ancestry', async ({
  page,
}, testInfo) => {
  const template = WORKSPACE_TEMPLATES.find((entry) => entry.id === 'mainnet-wabisabi')!;
  const snapshot = JSON.parse(
    readFileSync(
      new URL('../../src/domain/templateData/mainnet-wabisabi.json', import.meta.url),
      'utf8',
    ),
  ) as { roots: string[]; transactions: Record<string, Transaction> };
  const root = snapshot.transactions[snapshot.roots[0]];
  const input = root.vin[0];
  const parent = snapshot.transactions[input.txid!];
  expect(root.vin).toHaveLength(327);
  expect(root.vout).toHaveLength(279);
  expect(parent.vin.length).toBeGreaterThan(100);
  expect(parent.vin.some((vin) => vin.txid && !snapshot.transactions[vin.txid])).toBe(true);
  const calls = await mockBitcoin(page, { networks: ['mainnet'] });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
  await page.goto('/');
  await page
    .getByRole('button', { name: `Create ${template.name} workspace`, exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill('public-coinjoin-navigation-fixture');
  await dialog.getByLabel('Confirm password').fill('public-coinjoin-navigation-fixture');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const flow = page.locator('.transaction-view');
  await expect(
    flow.getByRole('button', { name: `Select displayed transaction ${root.txid}` }),
  ).toBeVisible();
  const count = `${Object.keys(snapshot.transactions).length} transactions`;
  await expect(page.locator('.statusbar')).toContainText(count);
  await flow
    .getByRole('button', { name: `Input 0: ${input.txid}:${input.vout}`, exact: true })
    .click();
  await expect(
    flow.getByRole('button', { name: `Input 0: ${input.txid}:${input.vout}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Open creating transaction', exact: true }).click();
  await expect(
    flow.getByRole('button', { name: `Select displayed transaction ${parent.txid}` }),
  ).toBeVisible();
  await expect(flow.getByRole('button', { name: /^Load all input details/ })).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText(count);
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  // Unsupported requests fail in this fixture. Selection must use bundled chain
  // facts, even when the selected input comes from another large CoinJoin.
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('wabisabi-parent-navigation.png') });
});
