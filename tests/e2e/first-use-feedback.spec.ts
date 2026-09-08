import { expect, test } from '@playwright/test';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_FUNDING } from '../fixtures/bitcoin';
import { openFixtureWorkspace } from '../fixtures/open-workspace';

async function setup(page: import('@playwright/test').Page) {
  const calls = await mockBitcoin(page);
  const workspace = newWorkspace('Public feedback review', 'mainnet');
  workspace.transactions = { [TX_FUNDING]: structuredClone(transactions[TX_FUNDING]) };
  workspace.view.selectionId = `tx:${TX_FUNDING}`;
  await openFixtureWorkspace(page, workspace, 'public-feedback-password');
  return calls;
}

test('workspace actions dismiss with Escape, outside click and keyboard focus leaving', async ({
  page,
}) => {
  await setup(page);
  const trigger = page.getByRole('button', { name: 'Workspace menu', exact: true });
  const popup = page.getByRole('group', { name: 'Workspace actions', exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Workspace details', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('button', { name: 'Export encrypted workspace', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByLabel('Transaction, output, or address').click();
  await expect(popup).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(popup).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Export encrypted workspace backup', exact: true }),
  ).toBeFocused();
});

test('invalid lookup shows actionable inline feedback without requests or changing the graph', async ({
  page,
}) => {
  const calls = await setup(page);
  const input = page.getByLabel('Transaction, output, or address');
  await input.fill('hello world');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#lookup-error')).toContainText('64-character transaction ID');
  await expect(page.locator('#lookup-error')).toBeInViewport();
  expect(calls).toEqual([]);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await input.fill('not an address');
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill(TX_FUNDING);
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#lookup-error')).toHaveCount(0);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
});

test('mobile keeps network and previous-level context visible and exports are explicit', async ({
  page,
}, testInfo) => {
  await setup(page);
  await expect(page.getByRole('button', { name: 'Hide panels', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit graph', exact: true })).toHaveText('Fit');
  const exported = page.getByRole('button', {
    name: 'Export encrypted workspace backup',
    exact: true,
  });
  await expect(exported).toHaveAttribute('title', 'Export encrypted workspace backup');
  await page.screenshot({ path: testInfo.outputPath('feedback-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.connection-network')).toHaveText('mainnet');
  await expect(page.locator('.connection-network')).toBeVisible();
  const previous = page.getByLabel('Prefetch previous levels');
  await expect(previous.locator('option:checked')).toHaveText('Previous: off');
  await expect(previous).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Hide panels', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export BIP329 labels · plaintext', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Workspace actions', exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('feedback-mobile.png') });
});
