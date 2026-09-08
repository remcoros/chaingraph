import { expect, test } from '@playwright/test';
import { mockBitcoin } from '../fixtures/bitcoin';

test('focus controls follow the side-panel breakpoint and selection lock shows its state', async ({
  page,
}) => {
  await mockBitcoin(page, false);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto('/');
  await page
    .getByRole('button', { name: /Explore the CoinJoin laboratory/ })
    .last()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Graph control layout');
  await dialog.getByLabel('Password', { exact: true }).fill('graph-control-layout');
  await dialog.getByLabel('Confirm password').fill('graph-control-layout');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
  const focus = page.getByRole('button', { name: 'Focus graph', exact: true });
  await expect(page.locator('.left-panel')).toBeVisible();
  await expect(page.locator('.right-panel')).toBeVisible();
  await expect(focus).toHaveText('Focus graph');
  await focus.click();
  await expect(page.locator('.left-panel')).toBeHidden();
  await expect(page.locator('.right-panel')).toBeHidden();
  const showPanels = page.getByRole('button', { name: 'Show panels', exact: true });
  await expect(showPanels).toHaveText('Show panels');
  for (const width of [999, 900, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.graph-focus-toggle')).toBeHidden();
    await page
      .locator('.mobile-switch')
      .getByRole('button', { name: 'Browse', exact: true })
      .click();
    await expect(page.locator('.left-panel')).toBeVisible();
    await page
      .locator('.mobile-switch')
      .getByRole('button', { name: 'Graph', exact: true })
      .click();
  }
  const lock = page.getByRole('button', { name: 'Lock to selection', exact: true });
  await expect(lock.locator('span')).toBeVisible();
  await expect(lock).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const off = await lock.evaluate((element) => getComputedStyle(element).borderColor);
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  expect(await lock.evaluate((element) => getComputedStyle(element).borderColor)).not.toBe(off);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(showPanels).toBeVisible();
  await showPanels.click();
  await expect(page.locator('.left-panel')).toBeVisible();
  await expect(page.locator('.right-panel')).toBeVisible();
});
