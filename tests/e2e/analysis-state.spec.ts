import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import {
  mockBitcoin,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
  RECEIVE_ADDRESS,
} from '../fixtures/bitcoin';

const password = 'public-analysis-controls-fixture';
async function prepare(page: Page) {
  const entries = await Promise.all(
    ['Analysis A', 'Analysis B'].map(async (name) => {
      const workspace = newWorkspace(name, 'mainnet');
      workspace.transactions = structuredClone(transactions);
      workspace.view = {
        ...workspace.view,
        selectionId: `tx:${TX_SPENDING}`,
        leftTab: 'entities',
        rightTab: 'analysis',
        showAddresses: true,
        transactionFlow: { open: true },
      };
      return {
        id: workspace.id,
        publicName: name,
        savedAt: new Date().toISOString(),
        envelope: await encryptWorkspace(workspace, password),
      };
    }),
  );
  await page.addInitScript((entries) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify(entries));
  }, entries);
  await mockBitcoin(page, false);
  await page.goto('/');
}
async function unlock(page: Page, name: string) {
  await page.locator('.saved-row').filter({ hasText: name }).click();
  const modal = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await modal.getByLabel('Password').fill(password);
  await modal.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByLabel('Analysis scope')).toBeVisible();
}
const analysis = (page: Page) =>
  page.locator('.right-panel .panel-tabs').getByRole('button', { name: /^Analysis/ });
const commonInput = (page: Page) =>
  page
    .locator('.analysis-tool')
    .filter({ has: page.getByRole('heading', { name: 'Common-input ownership', exact: true }) });

test('analysis controls survive inspecting a transaction and last-run settings remain distinct', async ({
  page,
}) => {
  await prepare(page);
  await unlock(page, 'Analysis A');
  await page.getByLabel('Analysis scope').selectOption('selection');
  await page.getByLabel('Search analysis tools').fill('Common-input');
  const tool = commonInput(page);
  await tool.getByText('Parameters and method', { exact: true }).click();
  await tool.getByLabel('Skip equal-output candidates').uncheck();
  await tool.getByLabel('Equal-output skip threshold').fill('4');
  await tool.getByRole('button', { name: 'Run analysis' }).click();
  await expect(tool.locator('.analysis-run-report')).toContainText('Last run · 1 transaction');
  await expect(tool.locator('.analysis-run-report')).toContainText(
    'Run scope: Selected transaction',
  );
  await page.getByLabel('Search findings').fill('temporary result query');
  await page.getByLabel('Evidence', { exact: true }).selectOption('hypothesis');
  await page
    .getByRole('button', { name: `Select displayed transaction ${TX_SPENDING}`, exact: true })
    .click();
  await expect(page.getByLabel('Node notes', { exact: true })).toBeVisible();
  await analysis(page).click();
  await expect(page.getByLabel('Analysis scope')).toHaveValue('selection');
  await expect(page.getByLabel('Search analysis tools')).toHaveValue('Common-input');
  await expect(tool.getByLabel('Skip equal-output candidates')).not.toBeChecked();
  await expect(tool.getByLabel('Equal-output skip threshold')).toHaveValue('4');
  await expect(page.getByLabel('Search findings')).toHaveValue('temporary result query');
  await expect(page.getByLabel('Evidence', { exact: true })).toHaveValue('hypothesis');
  await tool.getByLabel('Equal-output skip threshold').fill('5');
  await expect(tool.locator('.analysis-settings-changed')).toBeVisible();
  await tool.getByText('Last-run parameters', { exact: true }).click();
  await expect(tool.locator('.analysis-last-run-settings')).toContainText(
    'Equal-output skip threshold4',
  );
  await tool.locator('.analysis-run-report').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('analysis-last-run-settings.png') });
  await tool.getByRole('button', { name: 'Run analysis' }).click();
  await expect(tool.locator('.analysis-settings-changed')).toHaveCount(0);
  await expect(tool.locator('.analysis-run-report')).toContainText('Last run · 1 transaction');
  await expect(tool.locator('.analysis-last-run-settings')).toContainText(
    'Equal-output skip threshold5',
  );
  await page.locator(`.entity-row[title="tx:${TX_FUNDING}"]`).click();
  await analysis(page).click();
  await expect(tool.locator('.analysis-settings-changed')).toContainText(
    'Controls changed since this run',
  );
  await expect(page.getByLabel('Analysis scope')).toHaveValue('selection');
  await page.locator(`.entity-row[title="addr:${RECEIVE_ADDRESS}"]`).click();
  await analysis(page).click();
  await expect(page.getByLabel('Analysis scope')).toHaveValue('selection');
  await expect(tool.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
  await expect(page.locator('.analysis-panel')).toContainText(
    'Select a transaction to run this scope',
  );
  await page.getByLabel('Analysis scope').selectOption('graph');
  await tool.getByRole('button', { name: 'Run analysis' }).click();
  await expect(tool.locator('.analysis-run-report')).toContainText('Last run · 2 transactions');
  await page.getByLabel('Entity type').selectOption('transaction');
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await expect(tool.locator('.analysis-settings-changed')).toBeVisible();
  await expect(tool.locator('.analysis-run-report')).toContainText('Last run · 2 transactions');
});

test('unlocked workspaces retain independent analysis controls and locking clears temporary controls', async ({
  page,
}) => {
  await prepare(page);
  await unlock(page, 'Analysis A');
  await page.getByLabel('Analysis scope').selectOption('selection');
  await page.getByLabel('Search analysis tools').fill('Common-input');
  await commonInput(page).getByText('Parameters and method', { exact: true }).click();
  await commonInput(page).getByLabel('Equal-output skip threshold').fill('7');
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await unlock(page, 'Analysis B');
  await expect(page.getByLabel('Analysis scope')).toHaveValue('graph');
  await expect(page.getByLabel('Search analysis tools')).toHaveValue('');
  await page.getByLabel('Search analysis tools').fill('Equal-output detection');
  await page.locator('.workspace-tab[title="Analysis A"]').click();
  await expect(page.getByLabel('Search analysis tools')).toHaveValue('Common-input');
  await expect(page.getByLabel('Analysis scope')).toHaveValue('selection');
  await expect(commonInput(page).getByLabel('Equal-output skip threshold')).toHaveValue('7');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await unlock(page, 'Analysis A');
  await expect(page.getByLabel('Analysis scope')).toHaveValue('graph');
  await expect(page.getByLabel('Search analysis tools')).toHaveValue('');
  await page.locator('.workspace-tab[title="Analysis B"]').click();
  await expect(page.getByLabel('Search analysis tools')).toHaveValue('Equal-output detection');
});
