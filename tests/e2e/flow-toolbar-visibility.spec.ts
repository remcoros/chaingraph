import { expect, test } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_SPENDING } from '../fixtures/bitcoin';

test('mobile annotated transaction keeps quick tools inside the flow viewport', async ({
  page,
}) => {
  const password = 'public-mobile-flow-tools';
  const workspace = newWorkspace('Mobile flow tools', 'mainnet');
  workspace.transactions = transactions;
  workspace.view.selectionId = `tx:${TX_SPENDING}`;
  workspace.view.mobilePanel = 'graph';
  workspace.annotations[`tx:${TX_SPENDING}`] = {
    label: 'Public testnet payment',
    note: '',
    icon: '',
    bookmarked: false,
  };
  workspace.tags = [
    { id: crypto.randomUUID(), name: 'Review', color: '#68d4b7', nodeIds: [`tx:${TX_SPENDING}`] },
  ];
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([
          { id, publicName: 'Mobile flow tools', savedAt: new Date().toISOString(), envelope },
        ]),
      );
    },
    { id: workspace.id, envelope },
  );
  await mockBitcoin(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  const flow = page.locator('.transaction-view');
  await expect(flow).toBeVisible();
  const tools = flow.getByRole('group', { name: 'Transaction annotation tools', exact: true });
  const inside = () =>
    tools.evaluate((element) => {
      const panel = element.closest('.transaction-view')!.getBoundingClientRect();
      const tools = element.getBoundingClientRect();
      return tools.top >= panel.top && tools.bottom <= panel.bottom;
    });
  await expect.poll(inside).toBe(true);
  for (const action of await tools.getByRole('button').all()) {
    const bounds = await action.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(32);
    expect(bounds!.height).toBeGreaterThanOrEqual(32);
  }
  await page.screenshot({ path: test.info().outputPath('mobile-flow-tools-visible.png') });
});
