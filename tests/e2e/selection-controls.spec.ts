import { expect, test } from '@playwright/test';
import { mockBitcoin, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';
import { decryptWorkspace } from '../../src/lib/crypto';
import type { Workspace } from '../../src/domain/types';

test('selection lock and display options persist, and mobile panels ignore desktop focus mode', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const d = page.getByRole('dialog');
  const password = 'public-selection-controls';
  await d.getByLabel('Name (public)', { exact: true }).fill('Selection controls');
  await d.getByLabel('Password', { exact: true }).fill(password);
  await d.getByLabel('Confirm password').fill(password);
  await d.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByLabel('Prefetch previous levels')).toHaveValue('0');
  await expect(page.locator('.workspace-tab svg')).toHaveCount(0);
  await page.getByLabel('Transaction, output, or address').fill(TX_SPENDING);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  // Load the selected input's creator explicitly before exercising selection lock.
  await page
    .locator('.transaction-view')
    .getByRole('button', { name: /^Input 0:/ })
    .click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(6500);
  const lock = page.getByRole('button', { name: 'Lock to selection', exact: true });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await page.getByLabel('Entity type').selectOption('transaction');
  await page.locator('.entity-row').click();
  await expect(page.getByLabel('Node label')).toBeVisible();
  await page.getByLabel('Node label').fill('Followed selection');
  for (const name of ['Show labels', 'Show tags', 'Show icons'])
    await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  await expect
    .poll(
      async () => {
        const stored = await page.evaluate(() =>
          localStorage.getItem('chaingraph.encrypted-workspaces.v1')!,
        );
        const w = (await decryptWorkspace(JSON.parse(stored)[0].envelope, password)) as Workspace;
        const snapshot = w.view.graphSnapshot;
        const node = snapshot?.nodes.find((n) => n.id === `tx:${TX_FUNDING}`);
        if (!node || !snapshot) return false;
        return (
          Math.hypot(
            node.x - snapshot.camera.target.x,
            node.y - snapshot.camera.target.y,
            node.z - snapshot.camera.target.z,
          ) < 2 &&
          w.view.lockToSelection === true &&
          w.view.showLabels === false &&
          w.view.showTags === false &&
          w.view.showIcons === false
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const focus = page.getByRole('button', { name: 'Focus graph', exact: true });
  await focus.click();
  await expect(page.locator('.right-panel')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Show panels', exact: true })).toBeHidden();
  await page
    .locator('.mobile-switch')
    .getByRole('button', { name: 'Inspector', exact: true })
    .click();
  await expect(page.getByLabel('Node label')).toBeVisible();
  await expect(page.locator('.graph-stage')).toBeHidden();
  await page.locator('.inspector-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill(TX_SPENDING);
  await page.locator('.entity-row').click();
  await expect(page.getByLabel('Node label')).toHaveValue('');
  await expect
    .poll(() => page.locator('.inspector-scroll').evaluate((element) => element.scrollTop))
    .toBe(0);
});
