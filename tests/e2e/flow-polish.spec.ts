import { openLaboratoryFixture } from '../fixtures/open-workspace';
import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin } from '../fixtures/bitcoin';

async function openFlowFixture(page: Page) {
  await mockBitcoin(page, false);
  await openLaboratoryFixture(page, 'Flow interaction review', 'flow-interaction-review');
}

test('transaction card and its annotation toolbar have separate keyboard actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFlowFixture(page);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-row')).toContainText('Synthetic CoinJoin 1');
  await page.locator('.entity-row').click();
  const view = page.locator('.transaction-view');
  await view.getByRole('button', { name: /^Output 0:/ }).click();
  const card = view.getByRole('button', { name: /^Select displayed transaction / });
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('button')).toHaveCount(0);
  await view
    .getByRole('button', { name: 'Edit displayed transaction annotation', exact: true })
    .click();
  await expect(page.getByLabel('Node label')).toBeFocused();
  await page.getByLabel('Node label').fill('Collaborative transaction');
  await expect(card).toContainText('Collaborative transaction');
  await view.getByRole('button', { name: 'Edit displayed transaction icon', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose node icon' })).toBeVisible();
  await page.keyboard.press('Escape');
  await view.getByRole('button', { name: 'Edit displayed transaction tags', exact: true }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Find or create tag', exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: 'test-results/flow-toolbar-desktop.png' });
});

test('expanded output controls remain at the top while browsing a large transaction', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFlowFixture(page);
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-row')).toContainText('Synthetic CoinJoin 1');
  await page.locator('.entity-row').click();
  await page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }).click();
  const view = page.locator('.transaction-view');
  await view.getByRole('button', { name: 'Show all 150 outputs', exact: true }).click();
  await view.getByRole('button', { name: /^Output 149:/ }).click();
  const collapse = view.getByRole('button', { name: 'Collapse outputs', exact: true });
  await expect(collapse).toBeInViewport({ ratio: 1 });
  const bounds = await collapse.boundingBox();
  const panelBounds = await view.boundingBox();
  expect(bounds!.y).toBeLessThan(panelBounds!.y + 90);
  await collapse.click();
  await expect(view.getByRole('button', { name: /^Output 149:/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(view.getByRole('button', { name: /^Output 149:/ })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/flow-controls-mobile.png' });
});

test('long transaction labels stay inside the junction card on desktop and phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openFlowFixture(page);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-row')).toContainText('Synthetic CoinJoin 1');
  await page.locator('.entity-row').click();
  const flow = page.locator('.transaction-view');
  await flow
    .getByRole('button', { name: 'Edit displayed transaction annotation', exact: true })
    .click();
  const longLabel =
    'Exchange deposit following a collaborative transaction with several counterparties and a deliberately long investigation label';
  await page.getByLabel('Node label').fill(longLabel);
  const label = flow.locator('.transaction-identity-label');
  await expect(label).toHaveAttribute('title', longLabel);
  const geometry = () =>
    label.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const card = element.closest('.transaction-view-identity')!.getBoundingClientRect();
      return {
        inside: bounds.left >= card.left && bounds.right <= card.right,
        width: bounds.width,
        height: bounds.height,
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
  expect(await geometry()).toMatchObject({ inside: true, overflow: 0 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(label).toBeVisible();
  expect(await geometry()).toMatchObject({ inside: true, overflow: 0 });
  const rowAction = flow.getByRole('button', { name: 'Edit output 0 annotation', exact: true });
  const actionBounds = await rowAction.boundingBox();
  expect(actionBounds!.width).toBeGreaterThanOrEqual(32);
  expect(actionBounds!.height).toBeGreaterThanOrEqual(32);
  await page.screenshot({ path: 'test-results/flow-long-label-mobile.png' });
});
