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
  const showTagBounds = await exchange.getByRole('button', { name: 'Show on graph' }).boundingBox();
  const addTagBounds = await exchange
    .getByRole('button', { name: 'Add selection', exact: true })
    .boundingBox();
  expect(Math.abs(showTagBounds!.y - addTagBounds!.y)).toBeLessThan(1);
  expect(showTagBounds!.height).toBeLessThanOrEqual(30);
  expect(addTagBounds!.height).toBeLessThanOrEqual(30);

  await exchange.getByRole('button', { name: 'Show on graph' }).click();
  await expect(page.getByLabel('Graph visibility', { exact: true })).toContainText('Exchange');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.locator('.transaction-row.is-selected .entity-badges')).toContainText(
    'Exchange',
  );
  await page.getByLabel('Node notes', { exact: true }).fill('Unsaved draft survives tag updates');
  const selectedTags = page.getByRole('region', { name: 'Tags and wallet matches' });
  await selectedTags.getByRole('button', { name: 'Add or choose tags' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose tags' });
  await expect(picker.getByLabel('Find or create tag')).toBeFocused();
  const assignmentGeometry = () =>
    picker
      .locator('.tag-assignment')
      .first()
      .evaluate((row) => {
        const checkbox = row.querySelector('input')!.getBoundingClientRect();
        const dot = row.querySelector('.tag-dot')!.getBoundingClientRect();
        const text = row.querySelector('span:last-child')!.getBoundingClientRect();
        return {
          ordered: checkbox.right < dot.left && dot.right < text.left,
          aligned: Math.abs((checkbox.top + checkbox.bottom) / 2 - (dot.top + dot.bottom) / 2) < 2,
          height: row.getBoundingClientRect().height,
        };
      });
  expect(await assignmentGeometry()).toMatchObject({ ordered: true, aligned: true });
  expect((await assignmentGeometry()).height).toBeLessThan(60);

  await picker.getByRole('button', { name: 'Address + outputs', exact: true }).click();
  await picker.getByLabel('Find or create tag').fill('Shop');
  await picker.getByRole('button', { name: 'Color 3', exact: true }).click();
  await picker.getByLabel('Find or create tag').press('Enter');
  await expect(picker.getByRole('checkbox', { name: /Shop/ })).toBeChecked();
  await picker.getByLabel('Find or create tag').fill('shop');
  await expect(picker.getByRole('button', { name: /Create tag/ })).toHaveCount(0);
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
  await page.screenshot({ path: test.info().outputPath('tags-desktop.png') });
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
  expect(await assignmentGeometry()).toMatchObject({ ordered: true, aligned: true });
  const inheritedShop = picker.getByRole('checkbox', { name: /Shop/ });
  await expect(inheritedShop).not.toBeChecked();
  await expect(picker).toContainText('Applied to address too');
  await inheritedShop.check();
  await picker.getByRole('button', { name: 'Address + outputs', exact: true }).click();
  await expect(inheritedShop).toBeChecked();
  await expect(picker).toContainText('Applied to this output too');
  await inheritedShop.uncheck();
  await page.keyboard.press('Escape');
  await expect(
    selectedTags.getByRole('button', { name: 'Edit assignment for Shop' }),
  ).toBeVisible();
  await selectedTags.getByRole('button', { name: 'Add or choose tags' }).click();
  await expect(picker.getByRole('checkbox', { name: /Shop/ })).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('tags-mobile.png') });
  await page.keyboard.press('Escape');
});
