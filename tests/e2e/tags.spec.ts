import { expect, test } from '@playwright/test';
import {
  mockBitcoin,
  RECEIVE_ADDRESS,
  TX_FUNDING,
  TX_SPENDING,
  transactions,
} from '../fixtures/bitcoin';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';

const password = 'public-tag-fixture-password';
test('tags group imported labels and addresses without changing annotation drafts, and survive encrypted reopen', async ({
  page,
}) => {
  const workspace = newWorkspace('Public tag fixture', 'mainnet');
  workspace.transactions = transactions;
  workspace.annotations[`out:${TX_FUNDING}:0`] = {
    label: 'Exchange',
    note: 'Imported note',
    icon: '',
    bookmarked: false,
  };
  workspace.annotations[`out:${TX_SPENDING}:0`] = {
    label: 'Exchange',
    note: '',
    icon: '',
    bookmarked: false,
  };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      if (!localStorage.getItem('chaingraph.encrypted-workspaces.v1'))
        localStorage.setItem(
          'chaingraph.encrypted-workspaces.v1',
          JSON.stringify([
            { id, publicName: 'Public tag fixture', savedAt: new Date().toISOString(), envelope },
          ]),
        );
    },
    { id: workspace.id, envelope },
  );
  const calls = await mockBitcoin(page, false);
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByText('Group existing labels', { exact: true }).click();
  await page.getByRole('button', { name: 'Create tags from labels', exact: true }).click();
  const exchange = page
    .locator('.tag-card')
    .filter({ has: page.getByRole('heading', { name: 'Exchange', exact: true }) });
  await expect(exchange).toContainText('2 loaded entities');
  await exchange.getByRole('button', { name: 'Show on graph' }).click();
  await expect(page.locator('.group-filter')).toContainText('Exchange');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.locator('.transaction-row.is-selected .entity-badges')).toContainText(
    'Exchange',
  );
  await page.getByLabel('Node notes', { exact: true }).fill('Unsaved draft survives tag updates');
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  await page.getByLabel('Tag name', { exact: true }).fill('Shop');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'Unsaved draft survives tag updates',
  );
  const selectedTags = page.getByRole('region', { name: 'Tags and wallet matches' });
  await selectedTags.locator('summary').click();
  await selectedTags.getByLabel('Tag assignment scope').selectOption('address');
  await selectedTags.getByRole('checkbox', { name: /Shop/ }).check();
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'Unsaved draft survives tag updates',
  );
  await page.getByRole('button', { name: 'Save annotation', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('Encrypted · saved');
  const stored = await page.evaluate(() =>
    localStorage.getItem('chaingraph.encrypted-workspaces.v1')!,
  );
  expect(stored).not.toContain('Unsaved draft survives tag updates');
  expect(stored).not.toContain(RECEIVE_ADDRESS);
  const saved = (await decryptWorkspace(JSON.parse(stored)[0].envelope, password)) as Workspace;
  expect(saved.tags?.find((tag) => tag.name === 'Shop')?.nodeIds).toContain(
    `addr:${RECEIVE_ADDRESS}`,
  );
  expect(saved.annotations[`out:${TX_FUNDING}:0`].label).toBe('Exchange');
  expect(calls).toHaveLength(0);
  await page.reload();
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(
    page
      .locator('.tag-card')
      .filter({ has: page.getByRole('heading', { name: 'Shop', exact: true }) }),
  ).toContainText('2 loaded entities');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.graph-stage canvas')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('tags-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Wallets' }).click();
  await expect(page.getByRole('button', { name: 'New tag', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: test.info().outputPath('tags-mobile.png') });
});
