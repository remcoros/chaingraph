import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

async function openFixture(page: Page) {
  const password = 'public-utxo-status-check';
  const workspace = newWorkspace('UTXO status fixture', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.view = {
    ...workspace.view,
    selectionId: `out:${TX_FUNDING}:0`,
    leftTab: 'entities',
    transactionFlow: { open: false },
  };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([
          {
            id,
            publicName: 'UTXO status fixture',
            savedAt: new Date().toISOString(),
            envelope,
          },
        ]),
      );
    },
    { id: workspace.id, envelope },
  );
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check current UTXO status', exact: true }),
  ).toBeEnabled();
}
const positive = {
  bestblock: 'd'.repeat(64),
  confirmations: 101,
  coinbase: true,
  value: transactions[TX_FUNDING].vout[0].value,
  scriptPubKey: transactions[TX_FUNDING].vout[0].scriptPubKey,
};

test('UTXO checks distinguish unspent and absent observations, retry failures, and preserve loaded evidence', async ({
  page,
}) => {
  await mockBitcoin(page);
  let attempt = 0;
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.method !== 'gettxout') return route.fallback();
    expect(call).toEqual({
      network: 'mainnet',
      target: 'core',
      method: 'gettxout',
      params: [TX_FUNDING, 0, true],
    });
    attempt++;
    if (attempt === 2)
      return route.fulfill({
        status: 503,
        json: { error: 'Synthetic unsafe-detail-host.internal' },
      });
    return route.fulfill({ json: { result: attempt === 1 ? positive : null } });
  });
  await openFixture(page);
  await page.clock.install();
  const check = page.locator('.selection-top').getByRole('button', {
    name: 'Check current UTXO status',
    exact: true,
  });
  const toast = page.locator('.toast');
  const status = page.getByRole('region', { name: 'Current UTXO status', exact: true });
  const evidence = page.locator('.selection-evidence');
  await page
    .getByLabel('Node notes', { exact: true })
    .fill('Keep this annotation through status checks.');
  await check.click();
  await expect(toast).toContainText('Unspent at check');
  await expect(toast).toContainText('Mempool included');
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(evidence).not.toHaveAttribute('open');
  await page.clock.fastForward(8_100);
  await expect(toast).toHaveCount(0);
  await evidence.locator('summary').click();
  await expect(status).toBeVisible();
  await expect(status).toContainText('Unspent at check');
  await expect(status.getByRole('button')).toHaveCount(0);
  await expect(status.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
  await expect(page.locator('.spending-note')).toContainText('1 spending transaction is loaded');
  await expect(
    page.getByRole('button', { name: 'Find spending transactions', exact: true }),
  ).toBeEnabled();
  await evidence.locator('summary').click();
  await check.click();
  await expect(toast).toContainText('UTXO status check failed. Try again.');
  await expect(page.locator('body')).not.toContainText('unsafe-detail-host');
  await toast.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(toast).toHaveCount(0);
  await check.click();
  await expect(toast).toContainText('Not in current UTXO set');
  await expect(toast).toContainText('does not identify a spending transaction');
  await evidence.locator('summary').click();
  await expect(status).toContainText('Not in current UTXO set');
  await expect(
    page.getByRole('button', { name: 'Find spending transactions', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'Keep this annotation through status checks.',
  );
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});

test('changing the selected output discards a delayed UTXO response', async ({ page }) => {
  await mockBitcoin(page);
  let release!: () => void;
  let pending = false;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.method !== 'gettxout') return route.fallback();
    if (call.params[0] === TX_FUNDING) {
      pending = true;
      await wait;
      await route.fulfill({ json: { result: positive } }).catch(() => {}); // A canceled fetch may already have closed its route.
      return;
    }
    return route.fulfill({ json: { result: null } });
  });
  await openFixture(page);
  const check = page.locator('.selection-top').getByRole('button', {
    name: 'Check current UTXO status',
    exact: true,
  });
  const toast = page.locator('.toast');
  await check.click();
  await expect.poll(() => pending).toBe(true);
  await expect(check).toBeDisabled();
  await expect(check).toHaveAttribute('aria-busy', 'true');
  await page.locator(`.entity-row[title="out:${TX_SPENDING}:0"]`).click();
  const status = page.getByRole('region', { name: 'Current UTXO status', exact: true });
  await expect(check).toBeEnabled();
  await check.click();
  await expect(toast).toContainText('Not in current UTXO set');
  const latestNotice = await toast.innerText();
  release();
  await page.waitForTimeout(150);
  await expect(toast).toHaveText(latestNotice);
  await expect(toast).not.toContainText('Unspent at check');
  await page.locator('.selection-evidence > summary').click();
  await expect(status).toContainText('Not in current UTXO set');
  await page.locator(`.entity-row[title="out:${TX_FUNDING}:0"]`).click();
  await expect(status).toHaveCount(0);
  await expect(check).toBeEnabled();
});
