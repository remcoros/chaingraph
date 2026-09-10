import { captureGraphPixels, type SampledCanvas } from '../fixtures/graph-pixels';
import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, TX_FUNDING } from '../fixtures/bitcoin';

async function coloredGraphPixels(page: Page) {
  await captureGraphPixels(page.locator('.graph-canvas canvas'));
  return page.locator('.graph-canvas canvas').evaluate(
    (canvas) =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const { pixels } = (canvas as SampledCanvas).testPixels;
          let colored = 0;
          for (let index = 0; index < pixels.length; index += 4)
            if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 60) colored++;
          resolve(colored);
        }),
      ),
  );
}

test('frames the first lookup and promptly reframes returning before a small graph settles', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const password = 'public-early-framing-fixture';
  const workspaces = [
    newWorkspace('Early frame A', 'mainnet'),
    newWorkspace('Early frame B', 'mainnet'),
  ];
  const entries = await Promise.all(
    workspaces.map(async (workspace) => ({
      id: workspace.id,
      publicName: workspace.name,
      savedAt: new Date().toISOString(),
      envelope: await encryptWorkspace(workspace, password),
    })),
  );
  await page.addInitScript((entries) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify(entries));
  }, entries);
  await mockBitcoin(page);
  await page.goto('/');
  const unlock = async (name: string) => {
    await page.locator('.saved-row').filter({ hasText: name }).click();
    const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
    await dialog.getByLabel('Password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(page.getByLabel('Transaction, output, or address')).toBeVisible();
  };
  await unlock('Early frame A');
  await page.getByLabel('Transaction, output, or address').fill(TX_FUNDING);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  // Tiny default-distance nodes occupy only a few pixels. The first useful fit
  // must happen before the normal 120-tick/final-fit cycle, without pressing Fit.
  await expect
    .poll(() => coloredGraphPixels(page), { timeout: 1500, intervals: [50, 100] })
    .toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await unlock('Early frame B');
  await page.locator('.workspace-tab').filter({ hasText: 'Early frame A' }).click();
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await expect
    .poll(() => coloredGraphPixels(page), { timeout: 1500, intervals: [50, 100] })
    .toBeGreaterThan(300);
  expect(errors).toEqual([]);
});
