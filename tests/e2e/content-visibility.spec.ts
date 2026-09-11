import { expect, test } from '@playwright/test';
import { largeWalletFixture } from '../fixtures/wallet-performance';
import { openFixtureWorkspace } from '../fixtures/open-workspace';

// `.wallet-row-button` uses `content-visibility: auto` to skip layout and paint
// for off-screen wallet review rows. That only behaves well while
// `contain-intrinsic-size` matches the real rendered height: a wrong estimate
// makes the scrollbar jump as unrendered rows are replaced by real ones.
// The committed estimate was measured here, so pin it.
const EXPECTED_INTRINSIC_HEIGHT = 92;

test('wallet review rows match their contain-intrinsic-size estimate', async ({ page }) => {
  test.setTimeout(120000);
  const workspace = largeWalletFixture(120, 2);
  workspace.name = 'Content visibility fixture';
  workspace.view.workbench = 'wallet';
  await openFixtureWorkspace(page, workspace, 'content-visibility-password');
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await expect(page.locator('.wallet-row-button').first()).toBeVisible({ timeout: 30000 });

  const measured = await page.evaluate(() => {
    const viewport = window.innerHeight;
    // Only rows intersecting the viewport are actually rendered; skipped rows
    // report the intrinsic placeholder instead of their real height.
    return [...document.querySelectorAll<HTMLElement>('.wallet-row-button')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.top < viewport && r.bottom > 0)
      .map((r) => Math.round(r.height));
  });

  expect(measured.length, 'no wallet review rows rendered').toBeGreaterThan(0);
  for (const height of measured) expect(height).toBe(EXPECTED_INTRINSIC_HEIGHT);
});
