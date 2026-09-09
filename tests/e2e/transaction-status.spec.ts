import { expect, test } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

test('saved block heights and explicit mempool observations are distinct from unknown transaction status', async ({
  page,
}) => {
  const password = 'public-transaction-status-fixture';
  const unknown = 'c'.repeat(64);
  const workspace = newWorkspace('Public transaction status fixture', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.transactions[TX_FUNDING].blockHeight = 800123;
  workspace.transactions[TX_FUNDING].blocktime = 1690168629;
  workspace.transactions[TX_SPENDING].confirmations = 0;
  workspace.transactions[TX_SPENDING].mempool = true;
  workspace.transactions[unknown] = {
    ...structuredClone(transactions[TX_SPENDING]),
    txid: unknown,
    confirmations: 0,
  };
  workspace.view.leftTab = 'entities';
  workspace.view.selectionId = `tx:${TX_FUNDING}`;
  workspace.view.transactionFlow = { open: true };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([
          {
            id,
            publicName: 'Public transaction status fixture',
            savedAt: new Date().toISOString(),
            envelope,
          },
        ]),
      );
    },
    { id: workspace.id, envelope },
  );
  await mockBitcoin(page, false);
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  for (const [id, status] of [
    [TX_FUNDING, '#800123'],
    [TX_SPENDING, 'Unconfirmed'],
    [unknown, 'Status unknown'],
  ]) {
    const row = page.locator(`.entity-row[title="tx:${id}"]`);
    await expect(row.locator('.entity-chain-status')).toContainText(status);
    await row.click();
    await expect(page.locator('.transaction-view > summary small')).toHaveText(status);
    const chainStatus = page
      .locator('.selection-facts > div')
      .filter({ has: page.locator('dt', { hasText: /^Chain status$/ }) });
    await expect(chainStatus.locator('dd')).toContainText(status);
    if (id === TX_FUNDING) {
      await expect(page.locator('.transaction-identity-select')).toContainText(
        'Transaction (1 in/2 out)',
      );
      await expect(chainStatus.locator('time')).toContainText('24 Jul 2023 · 03:17 GMT');
      await expect(page.locator('.transaction-view-identity time')).toHaveAttribute(
        'title',
        /03:17:09 GMT/,
      );
    } else {
      await expect(chainStatus.locator('time')).toHaveCount(0);
      await expect(page.locator('.transaction-view-identity time')).toHaveCount(0);
    }
  }
  await expect(page.locator('.selection-heading')).not.toContainText('Unconfirmed');
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('transaction-status-desktop.png') });
});
