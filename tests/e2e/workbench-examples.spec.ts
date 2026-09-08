import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
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
  test(`${id} supports readable scoped analysis and an explicit loaded trace branch`, async ({
    page,
  }) => {
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
    if (id === 'mainnet-public-wallet')
      await expect(analysis.locator('.scan-scope')).toContainText('Wallet');
    else await expect(analysis.locator('.scan-scope')).toContainText('Output');
    await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
    await expect(analysis.locator('.scan-result-list button').first()).toBeVisible();
    await expect(analysis.locator('.scan-detail')).toContainText('Interpretation and limits');
    await mkdir('artifacts/simple-workbenches', { recursive: true });
    await page.screenshot({
      path: `artifacts/simple-workbenches/${id}-analysis-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(analysis.getByRole('button', { name: 'Scan', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/simple-workbenches/${id}-analysis-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (id === 'mainnet-public-wallet') {
      await navigation.getByRole('button', { name: 'Graph', exact: true }).click();
      await page.getByRole('button', { name: 'Entities', exact: true }).click();
      await page.getByLabel('Entity type').selectOption('output');
      await page.getByLabel('Filter graph entities').fill(`${input!.txid!}:${input!.vout!}`);
      await page.locator(`.entity-row[title="${anchor}"]`).click();
    }
    await navigation.getByRole('button', { name: 'Trace', exact: true }).click();
    const trace = page.getByRole('region', { name: 'Trace workbench', exact: true });
    await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
    const choices = trace.getByRole('region', { name: 'Choose continuation', exact: true });
    await expect(choices).toContainText('Choose a next output');
    if (id === 'mainnet-wabisabi' || id === 'mainnet-equal-outputs') {
      await expect(choices).toContainText('Ambiguous continuation');
      await expect(choices).toContainText('CoinJoin');
    }
    await expect(trace.getByLabel('Trace branch', { exact: true })).toHaveValue('');
    await expect(
      trace.getByRole('button', { name: 'Follow selected branch', exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `artifacts/simple-workbenches/${id}-trace-desktop.png`,
      fullPage: true,
    });
    // This explicitly chosen test branch is a recorded output, never an inferred satoshi path.
    const chosen = root.vout[0];
    await trace
      .getByLabel('Trace branch', { exact: true })
      .selectOption(outputNodeId(root.txid, chosen.n));
    await trace.getByRole('button', { name: 'Follow selected branch', exact: true }).click();
    await expect(trace.locator('.trace-current > .trace-id[title]')).toHaveAttribute(
      'title',
      `${root.txid}:${chosen.n}`,
    );
    await trace.getByRole('button', { name: 'Scan backward', exact: true }).click();
    await expect(choices).toContainText(
      'Bitcoin does not identify which input funded this particular output.',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/simple-workbenches/${id}-trace-mobile.png`,
      fullPage: true,
    });
    expect(calls, 'bundled public data supplies every observed hop').toEqual([]);
  });
}
