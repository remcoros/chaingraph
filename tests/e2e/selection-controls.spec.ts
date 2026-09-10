import { PerspectiveCamera, Vector3 } from 'three';
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
  const readSaved = async () => {
    const stored = await page.evaluate(() =>
      localStorage.getItem('chaingraph.encrypted-workspaces.v1')!,
    );
    return (await decryptWorkspace(JSON.parse(stored)[0].envelope, password)) as Workspace;
  };
  await expect
    .poll(async () => (await readSaved()).view, { timeout: 15000 })
    .toMatchObject({
      selectionId: `tx:${TX_FUNDING}`,
      lockToSelection: true,
      showLabels: false,
      showTags: false,
      showIcons: false,
    });
  const canvas = page.locator('.graph-canvas canvas');
  const selectedScreenPoint = async () => {
    const snapshot = (await readSaved()).view.graphSnapshot!;
    const node = snapshot.nodes.find((n) => n.id === `tx:${TX_FUNDING}`)!;
    const bounds = (await canvas.boundingBox())!;
    const camera = new PerspectiveCamera(50, bounds.width / bounds.height, 0.1, 1e8);
    camera.position.copy(snapshot.camera.position);
    camera.up.copy(snapshot.camera.up);
    camera.lookAt(new Vector3().copy(snapshot.camera.target));
    camera.updateMatrixWorld();
    const point = new Vector3(node.x, node.y, snapshot.dimensions === 2 ? 0 : node.z).project(
      camera,
    );
    return {
      x: bounds.x + ((point.x + 1) * bounds.width) / 2,
      y: bounds.y + ((1 - point.y) * bounds.height) / 2,
    };
  };
  // Focus centers the selection horizontally and reserves screen space above it
  // for navigation. A fixed distance in world units depends on zoom and viewport.
  await expect
    .poll(
      async () => {
        const bounds = (await canvas.boundingBox())!;
        return (await selectedScreenPoint()).x - (bounds.x + bounds.width / 2);
      },
      { timeout: 15000 },
    )
    .toBeCloseTo(0, 0);
  const bounds = (await canvas.boundingBox())!;
  const navigation = (await page.locator('.graph-navigation-overlay').boundingBox())!;
  const selectedPoint = await selectedScreenPoint();
  expect(selectedPoint.y).toBeGreaterThan(navigation.y + navigation.height);
  expect(selectedPoint.y).toBeGreaterThanOrEqual(bounds.y + bounds.height / 2);
  expect(selectedPoint.y).toBeLessThan(bounds.y + bounds.height * 0.75);
  const focus = page.getByRole('button', { name: 'Hide panels', exact: true });
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
