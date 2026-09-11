import { expect, test } from '@playwright/test';
import type { Workspace } from '../../src/domain/types';
import { outputNodeId } from '../../src/domain/types';
import { mockBitcoin } from '../fixtures/bitcoin';
import { encryptWorkspace } from '../../src/lib/crypto';

// Real public observations from bundled snapshots. No live rescans or ownership claims.
for (const id of [
  'mainnet-wabisabi',
  'mainnet-equal-outputs',
  'mainnet-large-value-path',
  'mainnet-public-wallet',
]) {
  test(`${id} supports readable scoped analysis and graph isolation`, async ({ page }) => {
    const calls = await mockBitcoin(page, false);
    await page.goto('/');
    // Load through Vite, matching the browser's JSON module handling.
    const workspace: Workspace = await page.evaluate(async (templateId) => {
      const modulePath = '/src/domain/workspaceTemplates.ts';
      const { createTemplateWorkspace } = await import(modulePath);
      return createTemplateWorkspace(templateId);
    }, id);
    const root = workspace.transactions[workspace.view.transactionFlow!.transactionId!];
    const input = root.vin.find(
      (item) => item.txid && item.vout !== undefined && workspace.transactions[item.txid],
    );
    expect(input, 'the curated example supplies loaded input context').toBeDefined();
    const anchor = outputNodeId(input!.txid!, input!.vout!);
    workspace.view.selectionId = anchor;
    workspace.view.transactionFlow = { open: false, transactionId: root.txid };
    workspace.view.leftTab = 'entities';
    if (id === 'mainnet-public-wallet') {
      workspace.view.selectedWallet = workspace.wallets[0].id;
      workspace.view.selectionId = undefined;
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const password = 'public-curated-workbench-example';
    const envelope = await encryptWorkspace(workspace, password);
    await page.evaluate(
      async ({ id, name, envelope }) => {
        const modulePath = '/src/lib/envelopeStorage.ts';
        const { indexedEnvelopeStorage } = await import(modulePath);
        const envelopeRef = `indexeddb:${id}`;
        await indexedEnvelopeStorage(indexedDB).write([{ reference: envelopeRef, envelope }]);
        localStorage.setItem('chaingraph.tour.seen', '1');
        localStorage.setItem(
          'chaingraph.encrypted-workspaces.v1',
          JSON.stringify([
            { id, publicName: name, savedAt: new Date().toISOString(), envelopeRef },
          ]),
        );
      },
      { id: workspace.id, name: workspace.name, envelope },
    );
    await page.reload();
    await page.locator('.saved-row').filter({ hasText: workspace.name }).click();
    const dialog = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
    await dialog.getByLabel('Password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(dialog).toBeHidden();
    const navigation = page.getByRole('navigation', { name: 'Workbench', exact: true });
    await navigation.getByRole('button', { name: 'Analysis', exact: true }).click();
    const analysis = page.locator('.analysis-workbench');
    const scope = analysis.getByRole('combobox', { name: 'Scan scope', exact: true });
    await scope.selectOption('context');
    await expect(scope).toHaveValue('context');
    // This journey verifies the bundled observations without requesting missing input data.
    await analysis
      .getByRole('checkbox', { name: 'Load missing input data before scanning', exact: true })
      .uncheck();
    if (id === 'mainnet-public-wallet')
      await expect(analysis.locator('.scan-scope')).toContainText('Wallet');
    else await expect(analysis.locator('.scan-scope')).toContainText('Output');
    await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
    await expect(analysis.locator('.scan-result-list button').first()).toBeVisible();
    await expect(analysis.locator('.scan-detail')).toContainText('Interpretation and limits');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(analysis.getByRole('button', { name: 'Scan', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await analysis.getByRole('button', { name: 'Isolate', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Analysis', exact: true }).click();
    await expect(analysis.locator('.scan-detail')).toBeVisible();
    expect(calls, 'analysis and isolation use only bundled public data').toEqual([]);
  });
}
