import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

const password = 'public-small-amount-fixture';
const UNKNOWN = 'c'.repeat(64);

async function openFixture(page: Page) {
  const workspace = newWorkspace('Small amounts fixture', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.transactions[TX_FUNDING].vout[0].value = 300 / 100_000_000;
  workspace.transactions[TX_SPENDING].vout[0].value = 300 / 100_000_000;
  workspace.transactions[TX_SPENDING].vout[1].value = 1_000 / 100_000_000;
  workspace.transactions[TX_SPENDING].vin.push({ txid: UNKNOWN, vout: 0 });
  workspace.annotations[`out:${TX_SPENDING}:0`] = {
    label: 'Small selected output',
    note: '',
    icon: '',
    bookmarked: false,
  };
  workspace.view = {
    ...workspace.view,
    leftTab: 'entities',
    selectionId: `tx:${TX_SPENDING}`,
    transactionFlow: { open: true, transactionId: TX_SPENDING },
    dimensions: 2,
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
            publicName: 'Small amounts fixture',
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
  await expect(page.getByLabel('Hide small amounts in flow')).toBeVisible();
}

test('independent amount filters retain selections and unknown inputs, collapse and survive locking', async ({
  page,
}) => {
  await openFixture(page);
  const flow = page.locator('.transaction-view');
  const input = (index: number) =>
    flow.getByRole('button', { name: new RegExp(`^Input ${index}:`) });
  const output = (index: number) =>
    flow.getByRole('button', { name: new RegExp(`^Output ${index}:`) });
  const graphFilter = page.getByLabel('Hide small amounts in graph');
  const flowFilter = page.getByLabel('Hide small amounts in flow');
  await graphFilter.selectOption('1000');
  await expect(flowFilter).toHaveValue('0');
  await expect(input(0)).toBeVisible();
  await expect(output(0)).toBeVisible();
  await flowFilter.selectOption('1000');
  await expect(flow).toHaveAttribute('open', '');
  await expect(input(0)).toHaveCount(0);
  await expect(input(2)).toBeVisible(); // Missing amount is unknown, not small.
  await expect(output(0)).toHaveCount(0);
  await expect(output(1)).toHaveCount(0); // Greater than excludes the exact boundary.
  await expect(graphFilter.locator('option:checked')).toHaveText('> 0.00 001 000 BTC');
  await expect(
    flow.getByRole('button', { name: 'Show 1 amount-filtered inputs', exact: true }),
  ).toBeVisible();
  await expect(
    flow.getByRole('button', { name: 'Show 2 amount-filtered outputs', exact: true }),
  ).toBeVisible();
  await page.locator(`.entity-row[title="out:${TX_SPENDING}:0"]`).click();
  await expect(output(0)).toBeVisible();
  await expect(output(0)).toContainText('Selected · outside filter');
  await expect(output(0)).toHaveAttribute('aria-pressed', 'true');
  await flowFilter.selectOption('546');
  await expect(graphFilter).toHaveValue('1000');
  await expect(flow).toHaveAttribute('open', ''); // Editing the summary control must not collapse it.
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(flowFilter).toHaveValue('546');
  await expect(graphFilter).toHaveValue('1000');
  await expect(output(0)).toHaveAttribute('aria-pressed', 'true');
  await flow.getByRole('button', { name: 'Show 1 amount-filtered inputs', exact: true }).click();
  await expect(flowFilter).toHaveValue('0');
  await expect(graphFilter).toHaveValue('1000');
  await expect(input(0)).toBeVisible();
  await expect(output(0)).not.toContainText('Selected · outside filter');
  await flowFilter.selectOption('10000');
  await flow.locator('summary').getByText('Transaction flow', { exact: true }).click();
  await expect(flowFilter).toHaveCount(0);
  await expect(graphFilter).toBeVisible();
  await flow.locator('summary').getByText('Transaction flow', { exact: true }).click();
  await expect(flowFilter).toHaveValue('10000');
  await expect(graphFilter).toHaveValue('1000');
});

test('amount controls and entity metadata stay readable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  const flowFilter = page.getByLabel('Hide small amounts in flow');
  await flowFilter.selectOption('1000');
  await expect(page.getByLabel('Hide small amounts in graph')).toHaveValue('0');
  await expect(flowFilter).toBeInViewport({ ratio: 1 });
  const box = await flowFilter.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(32);
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath('small-amount-flow-phone.png') });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  const row = page.locator(`.entity-row[title="tx:${TX_SPENDING}"]`);
  await row.scrollIntoViewIfNeeded();
  const font = await row
    .locator('small')
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(font).toBeGreaterThanOrEqual(11);
  await page.screenshot({ path: test.info().outputPath('small-amount-entities-phone.png') });
});

test('Entities can match the canvas while filtered observations remain recoverable', async ({
  page,
}) => {
  await openFixture(page);
  const visibility = page.getByLabel('Entity visibility');
  const smallRow = page.locator(`.entity-row[title="out:${TX_SPENDING}:0"]`);
  await page.getByLabel('Hide small amounts in graph').selectOption('1000');
  await expect(smallRow).toBeVisible();
  await visibility.selectOption('graph');
  await expect(smallRow).toHaveCount(0);
  await expect(page.locator('.entity-browser')).toContainText('on graph');
  await page.getByLabel('Hide small amounts in flow').selectOption('100000');
  await expect(smallRow).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(visibility).toHaveValue('graph');
  await expect(smallRow).toHaveCount(0);
  await visibility.selectOption('all');
  await expect(smallRow).toBeVisible();
  await visibility.selectOption('graph');
  await page.getByLabel('Hide small amounts in graph').selectOption('0');
  await expect(smallRow).toBeVisible();
  await expect(page.getByLabel('Hide small amounts in flow')).toHaveValue('100000');
});
