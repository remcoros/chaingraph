import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockBitcoin } from '../fixtures/bitcoin';

test('shared graph boundary preserves reviewed workbench controls on desktop and mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockBitcoin(page, false);
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the CoinJoin laboratory/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Open the CoinJoin laboratory' });
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Graph boundary laboratory');
  await dialog.getByLabel('Password', { exact: true }).fill('public-test-only-passphrase');
  await dialog.getByLabel('Confirm password').fill('public-test-only-passphrase');
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await page
    .getByRole('dialog', { name: 'Guided tour' })
    .getByRole('button', { name: 'Skip tour' })
    .click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await page.waitForTimeout(7000);
  await expect(page.locator('.graph-legend')).toContainText('Drag to pan');
  await expect(page.getByLabel('Size nodes by')).toBeVisible();
  await mkdir('docs/experiments/graph-boundary', { recursive: true });
  await page.screenshot({ path: 'docs/experiments/graph-boundary/desktop-workbench.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('.mobile-switch')
    .getByRole('button', { name: 'Wallets', exact: true })
    .click();
  await expect(page.locator('canvas')).toBeHidden();
  await page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await page.waitForTimeout(800);
  await expect(page.getByLabel('Size nodes by')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'docs/experiments/graph-boundary/mobile-workbench.png' });
  expect(errors).toEqual([]);
});
