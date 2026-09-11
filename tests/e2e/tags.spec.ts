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
test('inline tags group imported labels and addresses without disrupting notes, and survive encrypted reopen', async ({
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
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByText('Group existing labels', { exact: true }).click();
  await page.getByRole('button', { name: 'Create tags from labels', exact: true }).click();
  const exchange = page
    .locator('.tag-card')
    .filter({ has: page.getByRole('heading', { name: 'Exchange', exact: true }) });
  await expect(exchange).toContainText('2 loaded entities');
  await exchange.getByRole('button', { name: 'Show on graph' }).click();
  await expect(
    page.getByRole('button', { name: 'Remove filter: Tag: Exchange', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.locator('.transaction-row.is-selected .entity-badges')).toContainText(
    'Exchange',
  );
  await page.getByLabel('Node notes', { exact: true }).fill('Unsaved draft survives tag updates');
  const selectedTags = page.getByRole('region', { name: 'Tags', exact: true });
  await selectedTags.getByRole('button', { name: 'Add or choose tags' }).click();
  const picker = page.getByRole('dialog', { name: 'Tag selected records' });
  await expect(picker.getByLabel('Find or create tag')).toBeFocused();
  const expectNoHorizontalOverflow = async () => {
    expect(await picker.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    expect(
      await page
        .locator('.metadata-popover')
        .evaluate((popup) => popup.scrollWidth <= popup.clientWidth),
    ).toBe(true);
  };
  await expectNoHorizontalOverflow();

  await picker.getByRole('button', { name: 'Address + outputs', exact: true }).click();
  await picker.getByLabel('Find or create tag').fill('Shop');
  await picker.getByRole('button', { name: 'Color 3', exact: true }).click();
  await picker.getByLabel('Find or create tag').press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(selectedTags.getByRole('button', { name: 'Add or choose tags' })).toBeFocused();
  await selectedTags.getByRole('button', { name: 'Add or choose tags' }).click();
  await expect(picker.getByRole('button', { name: 'This output', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: 'Address + outputs', exact: true }).click();
  await expect(
    picker.getByRole('button', { name: 'Add Shop to selected records', exact: true }),
  ).toBeDisabled();
  await picker.getByLabel('Find or create tag').fill('shop');
  await expect(picker.getByRole('button', { name: 'Create and assign' })).toHaveCount(0);
  await picker.getByLabel('Find or create tag').press('Enter');
  await page.keyboard.press('Escape');
  await expect(selectedTags.getByRole('button', { name: 'Add or choose tags' })).toBeFocused();
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'Unsaved draft survives tag updates',
  );
  await expect(page.locator('.save-status')).toContainText('Encrypted · saved');
  const stored = await page.evaluate(() =>
    localStorage.getItem('chaingraph.encrypted-workspaces.v1')!,
  );
  expect(stored).not.toContain('Unsaved draft survives tag updates');
  expect(stored).not.toContain(RECEIVE_ADDRESS);
  const saved = (await decryptWorkspace(JSON.parse(stored)[0].envelope, password)) as Workspace;
  expect(saved.tags?.filter((tag) => tag.name.toLowerCase() === 'shop')).toHaveLength(1);
  expect(saved.tags?.find((tag) => tag.name === 'Shop')?.color).toBe('#9c9aed');
  expect(saved.tags?.find((tag) => tag.name === 'Shop')?.nodeIds).toContain(
    `addr:${RECEIVE_ADDRESS}`,
  );
  expect(saved.annotations[`out:${TX_FUNDING}:0`].label).toBe('Exchange');
  expect(saved.annotations[`out:${TX_FUNDING}:0`].note).toBe('Unsaved draft survives tag updates');
  expect(calls).toHaveLength(0);
  await page.reload();
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(
    page
      .locator('.tag-card')
      .filter({ has: page.getByRole('heading', { name: 'Shop', exact: true }) }),
  ).toContainText('2 loaded entities');
  const shop = page
    .locator('.tag-card')
    .filter({ has: page.getByRole('heading', { name: 'Shop', exact: true }) });
  await shop.getByRole('button', { name: 'Edit tag Shop', exact: true }).click();
  await shop.getByLabel('Tag description').fill('Counterparty description saves as it changes.');
  await shop.getByLabel('Tag name').fill('Exchange');
  await expect(
    page.getByRole('alert').filter({ hasText: 'A tag with this name already exists.' }),
  ).toBeVisible();
  await shop.getByLabel('Tag name').fill('Shop');
  await shop.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(shop).toContainText('Counterparty description saves as it changes.');
  await expect(page.getByRole('button', { name: 'Save tag', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.graph-stage canvas')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse' }).click();
  await expect(page.getByRole('button', { name: 'New tag', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('output');
  await page.getByLabel('Filter graph entities').fill(`${TX_FUNDING}:0`);
  await page.locator('.entity-list .entity-row').first().click();
  await page.locator('.mobile-switch').getByRole('button', { name: 'Inspector' }).click();
  await selectedTags.getByRole('button', { name: 'Add or choose tags' }).click();
  await expect(picker).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow();
  const addShop = picker.getByRole('button', { name: 'Add Shop to selected records', exact: true });
  const removeShop = picker.getByRole('button', {
    name: 'Remove Shop from selected records',
    exact: true,
  });
  await expect(addShop).toBeEnabled();
  await expect(removeShop).toBeDisabled();
  await expect(picker).toContainText('Applied to address too');
  await addShop.click();
  await expect(picker.getByLabel('Find or create tag')).toBeFocused();
  await expect(addShop).toBeDisabled();
  await expect(removeShop).toBeEnabled();
  await picker.getByRole('button', { name: 'Address + outputs', exact: true }).click();
  await expect(addShop).toBeDisabled();
  await expect(removeShop).toBeEnabled();
  await expect(picker).toContainText('Applied to this output too');
  await removeShop.click();
  await expect(picker.getByLabel('Find or create tag')).toBeFocused();
  await expect(addShop).toBeEnabled();
  await expect(removeShop).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(
    selectedTags.getByRole('button', { name: 'Edit assignment for Shop' }),
  ).toBeVisible();
  await selectedTags.getByRole('button', { name: 'Add or choose tags' }).click();
  await expect(picker.getByRole('button', { name: 'This output', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(addShop).toBeDisabled();
  await expect(removeShop).toBeEnabled();
  await expectNoHorizontalOverflow();
  await page.keyboard.press('Escape');
});
