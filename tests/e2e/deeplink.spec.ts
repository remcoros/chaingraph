import { expect, test, type Page } from '@playwright/test';
import { buildGraph } from '../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../src/Core/Workspace/createWorkspace';
import { createWorkspacePersistence } from '../../src/Core/Workspace/Persistence';
import type { Workspace } from '../../src/Core/Workspace/workspace';

const linkedTxid = 'c'.repeat(64);
const password = 'deeplink-test-password';

function deeplinkWorkspace(): Workspace {
  const w = createWorkspace('Deeplink fixture', 'testnet4');
  w.demo = false;
  w.chainData.transactions[linkedTxid] = {
    txid: linkedTxid,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1, scriptPubKey: { type: 'witness_v0_keyhash' } }],
    status: { kind: 'confirmed' as const, confirmations: 3 },
  };
  w.view.graphNodeIds = buildGraph(w).nodes.map((node) => node.id);
  return w;
}

async function seedSavedWorkspace(page: Page, workspace: Workspace) {
  const exported = await createWorkspacePersistence().exportFile(workspace, password);
  const envelope: unknown = JSON.parse(exported.contents);
  await page.addInitScript(
    ({ id, name, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      if (localStorage.getItem('chaingraph.encrypted-workspaces.v1') === null)
        localStorage.setItem(
          'chaingraph.encrypted-workspaces.v1',
          JSON.stringify([{ id, publicName: name, savedAt: new Date().toISOString(), envelope }]),
        );
    },
    { id: workspace.id, name: workspace.name, envelope },
  );
}

async function unlockSeededWorkspace(page: Page, name: string) {
  await page.locator('.saved-row').filter({ hasText: name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByTestId('graph-view')).toBeVisible();
}

test('a fragment reference adds to a workspace after unlock and clears the URL', async ({
  page,
}) => {
  await seedSavedWorkspace(page, deeplinkWorkspace());
  await page.goto(`/#?s=${linkedTxid}`);
  const banner = page.getByTestId('deep-link-banner');
  await expect(banner).toBeVisible();
  await expect(page).not.toHaveURL(/#/);
  await unlockSeededWorkspace(page, 'Deeplink fixture');
  await banner.getByTestId('deep-link-banner-ref').click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('a fragment reference on the home screen asks for a workspace and stays', async ({ page }) => {
  await seedSavedWorkspace(page, deeplinkWorkspace());
  await page.goto(`/#?s=${linkedTxid}`);
  const banner = page.getByTestId('deep-link-banner');
  await expect(banner).toBeVisible();
  await banner.getByTestId('deep-link-banner-ref').click();
  await expect(page.locator('.toast').filter({ hasText: 'workspace' })).toBeVisible();
  await expect(banner).toBeVisible();
});

test('a fragment reference can be dismissed without adding', async ({ page }) => {
  await seedSavedWorkspace(page, deeplinkWorkspace());
  await page.goto(`/#?s=${linkedTxid}`);
  const banner = page.getByTestId('deep-link-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Dismiss linked lookup' }).click();
  await expect(banner).toHaveCount(0);
});
