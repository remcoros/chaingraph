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

async function seed(page: Page) {
  const workspace = newWorkspace('Recovery and confirmation fixture', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.watchedAddresses = [RECEIVE_ADDRESS];
  workspace.view = {
    ...workspace.view,
    dimensions: 2,
    showAddresses: true,
    leftTab: 'entities',
    selectionId: `tx:${TX_FUNDING}`,
    transactionFlow: { open: false },
  };
  for (const id of [`tx:${TX_FUNDING}`, `tx:${TX_SPENDING}`, `addr:${RECEIVE_ADDRESS}`])
    workspace.annotations[id] = {
      label: 'Duplicate label',
      note: 'Public fixture note',
      icon: '',
      bookmarked: false,
    };
  const password = 'public recovery fixture password';
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([
          { id, publicName: 'Recovery fixture', savedAt: new Date().toISOString(), envelope },
        ]),
      );
    },
    { id: workspace.id, envelope },
  );
  await mockBitcoin(page, false);
  await page.goto('/');
  await page.locator('.saved-row').click();
  const modal = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await modal.getByLabel('Password', { exact: true }).fill(password);
  await modal.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
}
function row(page: Page, id: string) {
  return page
    .locator('.entity-list-entry')
    .filter({ has: page.locator(`.entity-row[title="${id}"]`) });
}

test('hidden address recovery survives disabling canvas address nodes', async ({ page }) => {
  await seed(page);
  const address = row(page, `addr:${RECEIVE_ADDRESS}`);
  await address
    .getByRole('button', { name: 'Hide Duplicate label from graph', exact: true })
    .click();
  await page.getByRole('button', { name: 'Show added address nodes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Show added address nodes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Filter graph entities', { exact: true }).fill('no match');
  await page.getByRole('button', { name: 'Browse 1 hidden entities', exact: true }).click();
  await expect(address).toBeVisible();
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await page.getByLabel('Entity visibility', { exact: true }).selectOption('all');
  await expect(address).toBeVisible();
  await address.locator('.entity-row').click();
  await expect(
    page.locator('.right-panel').getByText('Hidden from graph', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Center selection', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Show added address nodes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page
    .locator('.right-panel')
    .getByRole('button', { name: 'Show and center', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Show added address nodes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.right-panel').getByText('Hidden from graph', { exact: true }),
  ).toBeHidden();
});

test('confirmation identifies the canonical target when labels collide', async ({ page }) => {
  await seed(page);
  for (const target of [
    {
      id: `tx:${TX_SPENDING}`,
      value: TX_SPENDING,
      action: 'Remove Duplicate label from workspace',
      title: 'Remove transaction?',
      copy: 'Copy transaction ID to remove',
    },
    {
      id: `addr:${RECEIVE_ADDRESS}`,
      value: RECEIVE_ADDRESS,
      action: 'Stop watching Duplicate label',
      title: 'Stop watching address?',
      copy: 'Copy address to stop watching',
    },
  ]) {
    await row(page, target.id).getByRole('button', { name: target.action, exact: true }).click();
    const modal = page.getByRole('dialog', { name: target.title, exact: true });
    await expect(modal.getByText('Duplicate label', { exact: true })).toBeVisible();
    const identifier = modal.getByText(target.value, { exact: true });
    await expect(identifier).toBeVisible();
    expect(await identifier.evaluate((node) => getComputedStyle(node).userSelect)).toBe('all');
    await expect(modal.getByRole('button', { name: target.copy, exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Keep in workspace', exact: true }).click();
  }
});

test('restoring a hidden address explains disabled address display and offers an explicit action', async ({
  page,
}) => {
  await seed(page);
  const address = row(page, `addr:${RECEIVE_ADDRESS}`);
  await address
    .getByRole('button', { name: 'Hide Duplicate label from graph', exact: true })
    .click();
  await page.getByRole('button', { name: 'Show added address nodes', exact: true }).click();
  await page.getByLabel('Entity visibility', { exact: true }).selectOption('hidden');
  await address.getByRole('button', { name: 'Show Duplicate label in graph', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Address nodes are switched off');
  await expect(
    page.getByRole('button', { name: 'Show added address nodes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Enable address display', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Show added address nodes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Entity visibility', { exact: true }).selectOption('all');
  await expect(address).toBeVisible();
});
