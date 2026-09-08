import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_SPENDING } from '../fixtures/bitcoin';

const password = 'public-analysis-controls-fixture';
async function prepare(page: Page, empty = false) {
  const entries = await Promise.all(
    ['Analysis A', 'Analysis B'].map(async (name) => {
      const workspace = newWorkspace(name, 'mainnet');
      if (!empty) workspace.transactions = structuredClone(transactions);
      workspace.view = {
        ...workspace.view,
        ...(empty ? {} : { selectionId: `tx:${TX_SPENDING}` }),
        leftTab: 'entities',
        // Legacy files must land in the full Analysis workbench, not an empty side panel.
        rightTab: 'analysis',
        transactionFlow: { open: false },
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
  const calls = await mockBitcoin(page, false);
  await page.goto('/');
  return calls;
}
async function unlock(page: Page, name: string) {
  await page.locator('.saved-row').filter({ hasText: name }).click();
  const modal = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await modal.getByLabel('Password').fill(password);
  await modal.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.analysis-workbench')).toBeVisible();
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Workbench', exact: true });

test('legacy Analysis view opens the full workbench and controls survive ordinary navigation', async ({
  page,
}) => {
  const calls = await prepare(page);
  await unlock(page, 'Analysis A');
  await expect(nav(page).getByRole('button', { name: 'Analysis', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const analysis = page.locator('.analysis-workbench');
  await analysis
    .getByLabel('Scan scope', { exact: true })
    .selectOption({ label: 'Loaded workspace' });
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(analysis.locator('.scan-result-list button').first()).toBeVisible();
  await nav(page).getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await expect(
    page.locator('.right-panel .panel-tabs').getByRole('button', { name: /^Analysis/ }),
  ).toHaveCount(0);
  await nav(page).getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(analysis.getByLabel('Scan scope', { exact: true })).toHaveValue('workspace');
  await expect(analysis.locator('.scan-result-list button').first()).toBeVisible();
  expect(calls).toHaveLength(0);
});

test('each unlocked workspace keeps its scope and locking clears temporary analysis controls', async ({
  page,
}) => {
  await prepare(page);
  await unlock(page, 'Analysis A');
  await page.getByLabel('Scan scope', { exact: true }).selectOption({ label: 'Loaded workspace' });
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await unlock(page, 'Analysis B');
  await expect(page.getByLabel('Scan scope', { exact: true })).toHaveValue('context');
  await page.locator('.workspace-tab[title="Analysis A"]').click();
  await expect(page.getByLabel('Scan scope', { exact: true })).toHaveValue('workspace');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.workspace-tab[title="Analysis A"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await unlock(page, 'Analysis A');
  await expect(page.getByLabel('Scan scope', { exact: true })).toHaveValue('context');
});

test('an empty loaded workspace gives a clear no-findings explanation without requests', async ({
  page,
}) => {
  const calls = await prepare(page, true);
  await unlock(page, 'Analysis A');
  const analysis = page.locator('.analysis-workbench');
  await expect(analysis).toContainText(/loaded workspace/i);
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(analysis).toContainText('No findings in this scan.');
  await expect(analysis).toContainText('No loaded transactions in this scope.');
  expect(calls).toHaveLength(0);
});

test('an invalid optional setting reports that tool error while the rest of the scan completes', async ({
  page,
}) => {
  const calls = await prepare(page);
  await unlock(page, 'Analysis A');
  const analysis = page.locator('.analysis-workbench');
  await analysis.getByText('Optional settings', { exact: true }).click();
  await analysis.getByRole('spinbutton', { name: /^Minimum equal outputs/ }).fill('1001');
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  await analysis.locator('.scan-coverage > summary').click();
  const reports = analysis.locator('.scan-coverage > ul > li');
  await expect(reports.filter({ hasText: 'Equal-output detection' })).toContainText('Error');
  await expect(reports.filter({ hasText: 'Common-input ownership' })).toContainText('Ran');
  await expect(analysis.locator('.scan-result-list button').first()).toBeVisible();
  expect(calls).toHaveLength(0);
});
