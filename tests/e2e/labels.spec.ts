import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin, TX_SPENDING, transactions } from '../fixtures/bitcoin';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';

const password = 'public-label-exchange-test';
const id = `tx:${TX_SPENDING}`;
async function importFile(page: Page, records: unknown[]) {
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import BIP329 labels', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'public-fixture.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from(records.map((record) => JSON.stringify(record)).join('\n')),
  });
}

test('BIP329 import preserves omitted labels and notes, honors clearing, and rejects private-shaped keys atomically', async ({
  page,
}) => {
  const workspace = newWorkspace('Public label exchange', 'mainnet');
  workspace.transactions[TX_SPENDING] = transactions[TX_SPENDING];
  workspace.annotations[id] = {
    label: 'Original label',
    note: 'Keep this note',
    icon: '★',
    bookmarked: true,
  };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([{ id, savedAt: new Date().toISOString(), envelope }]),
      );
    },
    { id: workspace.id, envelope },
  );
  await mockBitcoin(page);
  await page.goto('/');
  await page.locator('.saved-row').click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('transaction');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await page.locator('.entity-list').getByTitle(id, { exact: true }).click();
  await importFile(page, [{ type: 'tx', ref: TX_SPENDING }]);
  await expect(page.getByRole('status').filter({ hasText: 'Imported 0 labels.' })).toBeVisible();
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Original label');
  await importFile(page, [{ type: 'tx', ref: TX_SPENDING, label: '' }]);
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue('Keep this note');
  // BIP32 invalid-key vector: a public version surrounding private-shaped data.
  const invalid =
    'xpub661MyMwAqRbcEYS8w7XLSVeEsBXy79zSzH1J8vCdxAZningWLdN3zgtU6LBpB85b3D2yc8sfvZU521AAwdZafEz7mnzBBsz4wKY5fTtTQBm';
  await importFile(page, [
    { type: 'tx', ref: TX_SPENDING, label: 'Must not apply' },
    { type: 'xpub', ref: invalid, label: 'Invalid key' },
  ]);
  await expect(page.getByRole('alert')).toContainText('Invalid reference on line 2');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('');
  await expect(page.locator('.save-status')).toContainText('Encrypted · saved');
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!)[0].envelope,
  );
  const saved = (await decryptWorkspace(stored, password)) as Workspace;
  expect(saved.annotations[id]).toEqual({
    label: '',
    note: 'Keep this note',
    icon: '★',
    bookmarked: true,
  });
  expect(saved.annotations[`xpub:${invalid}`]).toBeUndefined();
});
