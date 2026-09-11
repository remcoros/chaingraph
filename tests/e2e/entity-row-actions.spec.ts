import { expect, test } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import {
  mockBitcoin,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
  RECEIVE_ADDRESS,
} from '../fixtures/bitcoin';

test('entity row actions hide and remove their own target without changing the selected transaction', async ({
  page,
}) => {
  const password = 'public-entity-row-actions';
  const workspace = newWorkspace('Entity row action fixture', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.watchedAddresses = [RECEIVE_ADDRESS];
  workspace.view = {
    ...workspace.view,
    showAddresses: true,
    selectionId: `tx:${TX_FUNDING}`,
    leftTab: 'entities',
    transactionFlow: { open: false },
  };
  workspace.annotations[`tx:${TX_FUNDING}`] = {
    label: 'Selected funding',
    note: '',
    icon: '',
    bookmarked: false,
  };
  workspace.annotations[`tx:${TX_SPENDING}`] = {
    label: 'Spending review',
    note: 'Preserve this note unless removal is confirmed.',
    icon: '',
    bookmarked: false,
  };
  workspace.annotations[`addr:${RECEIVE_ADDRESS}`] = {
    label: 'Watched address',
    note: 'Public fixture watch',
    icon: '',
    bookmarked: false,
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
            publicName: 'Entity row action fixture',
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
  const spending = page
    .locator('.entity-list-entry')
    .filter({ has: page.locator(`.entity-row[title="tx:${TX_SPENDING}"]`) });
  await expect(spending).toContainText('(2 in / 2 out)');
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  await spending.locator('.entity-row').scrollIntoViewIfNeeded();
  await expect(spending.locator('.entity-row-actions')).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(spending.locator('.entity-row button')).toHaveCount(0);
  await spending
    .getByRole('button', { name: 'Hide Spending review from graph', exact: true })
    .click();
  await expect(spending).toHaveCount(0);
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Selected funding');
  await page.getByLabel('Entity visibility').selectOption('all');
  await spending
    .getByRole('button', { name: 'Show Spending review in graph', exact: true })
    .click();
  await expect(
    spending.getByRole('button', { name: 'Hide Spending review from graph', exact: true }),
  ).toBeVisible();
  await spending
    .getByRole('button', { name: 'Remove Spending review from workspace', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', { name: 'Remove transaction?', exact: true });
  await expect(confirmation).toContainText('Spending review');
  await expect(confirmation).toContainText('1 annotated entity');
  await confirmation.getByRole('button', { name: 'Keep in workspace', exact: true }).click();
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Selected funding');
  await spending
    .getByRole('button', { name: 'Remove Spending review from workspace', exact: true })
    .click();
  await confirmation.getByRole('button', { name: 'Remove transaction', exact: true }).click();
  await expect(spending).toHaveCount(0);
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Selected funding');
  await expect(page.locator(`.entity-row[title="tx:${TX_FUNDING}"]`)).toBeVisible();
  const output = page
    .locator('.entity-list-entry')
    .filter({ has: page.locator(`.entity-row[title="out:${TX_FUNDING}:0"]`) });
  await expect(output.locator('.entity-row-remove')).toHaveCount(0);
  const watched = page
    .locator('.entity-list-entry')
    .filter({ has: page.locator(`.entity-row[title="addr:${RECEIVE_ADDRESS}"]`) });
  await watched.getByRole('button', { name: 'Stop watching Watched address', exact: true }).click();
  const watchConfirmation = page.getByRole('dialog', {
    name: 'Stop watching address?',
    exact: true,
  });
  await expect(watchConfirmation).toContainText('Loaded transaction data remains');
  await watchConfirmation
    .getByRole('button', { name: 'Stop watching address', exact: true })
    .click();
  await expect(watched.locator('.entity-row-remove')).toHaveCount(0);
  await expect(page.locator(`.entity-row[title="tx:${TX_FUNDING}"]`)).toBeVisible();
});
