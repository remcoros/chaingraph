import { expect, test, type Page } from '@playwright/test';
import { openLaboratoryFixture } from '../fixtures/open-workspace';

const dialogFor = (page: Page) => page.getByRole('dialog', { name: 'Transaction activity' });
const triggerFor = (page: Page) => page.getByRole('button', { name: /^Activity/ });
async function open(page: Page, scenario: string) {
  await page.goto(`/tests/fixtures/transaction-activity.html?scenario=${scenario}`);
  await triggerFor(page).click();
  await expect(dialogFor(page)).toBeVisible();
}
async function checkBounds(page: Page) {
  const dialog = dialogFor(page);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  for (const button of await dialog.getByRole('button').all()) {
    await button.scrollIntoViewIfNeeded();
    expect(
      await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ).toBe(true);
  }
}

test('idle is quiet and history discovery still identifies its cancellable action', async ({
  page,
}) => {
  await open(page, 'idle');
  await expect(triggerFor(page)).toHaveText('Activity');
  await expect(dialogFor(page)).toContainText('No transactions loading.');
  await expect(dialogFor(page).getByRole('table')).toHaveCount(0);
  await expect(dialogFor(page).getByRole('button', { name: 'Recent results' })).toHaveCount(0);
  await expect(dialogFor(page).getByRole('button', { name: 'Cancel current action' })).toHaveCount(
    0,
  );
  await page.screenshot({ path: test.info().outputPath('idle-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(triggerFor(page)).toBeFocused();

  await open(page, 'history');
  await expect(triggerFor(page)).toHaveText('ActivityWorking');
  await expect(dialogFor(page)).toContainText('Checking address history…');
  await expect(dialogFor(page)).toContainText('No transactions loading.');
  await dialogFor(page).getByRole('button', { name: 'Cancel current action' }).click();
  await expect(page.getByRole('status', { name: 'Action cancelled' })).toHaveText('true');
});

test('recent results clear independently and cancellation preserves a shared live request', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'active');
  const dialog = dialogFor(page);
  await expect(triggerFor(page)).toContainText('3 loading · 5 waiting');
  await expect(dialog.getByRole('row', { name: 'Wallet / address refresh 2 5' })).toBeVisible();
  await expect(dialog.getByRole('row', { name: 'Input details 1 0' })).toBeVisible();
  const recent = dialog.getByRole('button', { name: 'Recent results' });
  await expect(recent).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByText('4 loaded', { exact: true })).toBeHidden();
  await recent.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('4 loaded', { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('0 failed');
  await expect(dialog).not.toContainText('0 cancelled');
  await dialog.getByRole('button', { name: 'Clear recent results' }).click();
  await expect(dialog.getByRole('button', { name: 'Close transaction activity' })).toBeFocused();
  await expect(recent).toHaveCount(0);
  await expect(triggerFor(page)).toContainText('3 loading · 5 waiting');
  await dialog.getByRole('button', { name: 'Cancel current action' }).click();
  await expect(triggerFor(page)).toHaveText('Activity1 loading');
  expect(await page.evaluate(() => window.activityFixture.sharedAborted())).toBe(false);
  await expect(dialog.getByRole('row', { name: 'Input details 1 0' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel current action' })).toHaveCount(0);
  await page.evaluate(() => window.activityFixture.finishShared());
  await expect(triggerFor(page)).toHaveText('Activity');
  await expect(dialog).toContainText('No transactions loading.');
  await page.keyboard.press('Escape');
  await expect(triggerFor(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('failures stay visible with history closed and long actions fit narrow screens', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1280, 390, 240]) {
    await page.setViewportSize({ width, height: 800 });
    for (const scenario of ['failed', 'long']) {
      await open(page, scenario);
      const dialog = dialogFor(page);
      await expect(dialog.getByRole('button', { name: 'Recent results' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      if (scenario === 'failed') {
        await expect(dialog.getByRole('status')).toContainText('1 load failed');
        await expect(dialog.getByRole('status')).toContainText('Retry from the original view.');
      }
      await checkBounds(page);
      await page.screenshot({ path: test.info().outputPath(`${scenario}-${width}.png`) });
      await dialog.getByRole('button', { name: 'Recent results' }).click();
      await checkBounds(page);
      await dialog.getByRole('button', { name: 'Clear recent results' }).focus();
      await page.keyboard.press('Tab');
      await expect(
        dialog.getByRole('button', { name: 'Close transaction activity' }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(triggerFor(page)).toBeFocused();
    }
  }
});

test('the popup opens in the real workspace and returns keyboard focus', async ({ page }) => {
  await page.route('**/api/networks', (route) =>
    route.fulfill({ json: { networks: ['testnet4'] } }),
  );
  await page.route('**/api/status?*', (route) =>
    route.fulfill({ json: { network: 'testnet4', connected: false } }),
  );
  await page.route('**/api/rpc', (route) =>
    route.fulfill({ status: 503, json: { error: 'Synthetic offline service' } }),
  );
  await openLaboratoryFixture(page, 'Activity review fixture', 'public-fixture-password');
  await triggerFor(page).click();
  await expect(dialogFor(page)).toContainText('No transactions loading.');
  await checkBounds(page);
  await page.screenshot({ path: test.info().outputPath('workspace-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(triggerFor(page)).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await triggerFor(page).click();
  await checkBounds(page);
  await page.screenshot({ path: test.info().outputPath('workspace-mobile.png') });
});
