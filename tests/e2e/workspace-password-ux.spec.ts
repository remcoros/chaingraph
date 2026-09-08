import { expect, test } from '@playwright/test';
import { mockBitcoin } from '../fixtures/bitcoin';

for (const width of [1440, 390]) {
  test(`workspace password validation stays inline at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockBitcoin(page);
    await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
    await page.goto('/');
    await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
    const password = dialog.getByLabel('Password', { exact: true });
    await expect(
      dialog.getByText('At least 8 characters. Use a long, unique passphrase.'),
    ).toBeVisible();
    const backgroundScroll = await page.locator('main.welcome').evaluate((el) => el.scrollTop);
    await page.evaluate(() => {
      document.addEventListener(
        'invalid',
        () => (document.documentElement.dataset.nativeInvalid = 'yes'),
        true,
      );
    });
    await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Use at least 8 characters');
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(await page.locator('main.welcome').evaluate((el) => el.scrollTop)).toBe(
      backgroundScroll,
    );
    expect(await page.locator('html').getAttribute('data-native-invalid')).toBeNull();

    await password.fill('public-password-review');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(password).not.toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(
      dialog.getByRole('button', { name: 'Hide password', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await dialog.getByLabel('Confirm password').fill('different-password');
    await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Passwords do not match.');
    await expect(dialog.getByLabel('Confirm password')).toBeFocused();
    await dialog.getByLabel('Confirm password').fill('public-password-review');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByLabel('Confirm password')).not.toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: 'Show confirmation', exact: true }).click();
    await expect(dialog.getByLabel('Confirm password')).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide confirmation', exact: true }).click();
    expect(await page.locator('main.welcome').evaluate((el) => el.scrollTop)).toBe(
      backgroundScroll,
    );
    await page.screenshot({ path: testInfo.outputPath(`password-validation-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'New workspace', exact: true }).last(),
    ).toBeFocused();
  });
}

test('created workspaces lock on reload and unlock with accessible password controls', async ({
  page,
}, testInfo) => {
  await mockBitcoin(page);
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const create = page.getByRole('dialog', { name: 'Create a workspace' });
  await create.getByLabel('Name (public)', { exact: true }).fill('Password UX review');
  await create.getByLabel('Password', { exact: true }).fill('public-password-review');
  await create.getByLabel('Confirm password').fill('public-password-review');
  await create.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1') ?? '[]').length,
      ),
    )
    .toBe(1);
  await page.reload();
  await page.locator('.saved-row').filter({ hasText: 'Password UX review' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  const password = unlock.getByLabel('Password', { exact: true });
  await expect(password).toBeFocused();
  await expect(unlock).toContainText(
    'Workspaces lock on reload. Chaingraph never stores your password.',
  );
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(unlock.getByRole('alert')).toHaveText('Enter your workspace password.');
  await password.fill('public-password-review');
  await unlock.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await unlock.getByRole('button', { name: 'Hide password', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('unlock-password-controls.png') });
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(unlock).toHaveCount(0);
  await expect(page.getByLabel('Transaction, output, or address')).toBeVisible();
});
