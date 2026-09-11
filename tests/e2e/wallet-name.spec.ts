import { expect, test, type Page } from '@playwright/test';
import { newWorkspace, parseWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { deriveAddresses } from '../../src/lib/wallet';
import { mockNetworkDiscovery, PUBLIC_ZPUB } from '../fixtures/bitcoin';

const password = 'public-wallet-name-fixture';

async function unlock(page: Page) {
  await page.locator('.saved-row').filter({ hasText: 'Wallet name fixture' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function seed(page: Page) {
  const workspace = newWorkspace('Wallet name fixture', 'mainnet');
  workspace.wallets = [
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Original wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#27c4a7',
      addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 2),
    },
  ];
  workspace.view = {
    ...workspace.view,
    workbench: 'wallet',
    selectedWallet: workspace.wallets[0].id,
  };
  parseWorkspace(workspace);
  const entry = {
    id: workspace.id,
    publicName: workspace.name,
    savedAt: new Date().toISOString(),
    envelope: await encryptWorkspace(workspace, password),
  };
  await page.addInitScript((entry) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    if (!localStorage.getItem('chaingraph.encrypted-workspaces.v1'))
      localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify([entry]));
  }, entry);
  await mockNetworkDiscovery(page);
  await page.route('**/api/rpc', (route) => route.fulfill({ json: { result: [] } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await unlock(page);
  return workspace;
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`wallet name autosaves without changing derivation at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const original = await seed(page);
    const walletPage = page.getByRole('region', { name: 'Wallet workspace', exact: true });
    const edit = walletPage.getByRole('button', { name: 'Edit wallet name', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog', { name: 'Edit wallet name', exact: true });
    const name = dialog.getByLabel('Wallet name', { exact: true });
    const key = dialog.getByLabel('Extended public key (read-only)', { exact: true });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Original wallet');
    await expect(key).not.toHaveValue(PUBLIC_ZPUB);
    await expect(key).toHaveAttribute('readonly', '');
    await dialog.getByRole('button', { name: 'Show extended public key' }).click();
    await expect(key).toHaveValue(PUBLIC_ZPUB);
    await dialog.getByRole('button', { name: 'Hide extended public key' }).click();
    await expect(key).not.toHaveValue(PUBLIC_ZPUB);
    await name.fill('');
    await expect(dialog.getByRole('alert')).toContainText('The previous name is kept');
    await expect(walletPage.getByLabel('Selected wallet')).toContainText('Original wallet');
    await name.fill('Renamed wallet');
    await name.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(edit).toBeFocused();
    await expect(walletPage.getByLabel('Selected wallet')).toContainText('Renamed wallet');

    // Lock immediately after editing and inspect the authenticated stored payload.
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
    await expect(page.locator('.saved-row').filter({ hasText: original.name })).toBeVisible();
    const stored = await page.evaluate(() =>
      localStorage.getItem('chaingraph.encrypted-workspaces.v1')!,
    );
    expect(stored).not.toContain('Renamed wallet');
    expect(stored).not.toContain(PUBLIC_ZPUB);
    const saved = (await decryptWorkspace(JSON.parse(stored)[0].envelope, password)) as Workspace;
    expect(saved.wallets[0]).toEqual({ ...original.wallets[0], name: 'Renamed wallet' });
    await unlock(page);
    await expect(walletPage.getByLabel('Selected wallet')).toContainText('Renamed wallet');
    await edit.click();
    await expect(key).not.toHaveValue(PUBLIC_ZPUB);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    // The Graph sidebar opens the same editor and restores its pencil's focus.
    await page
      .getByRole('navigation', { name: 'Workbench', exact: true })
      .getByRole('button', { name: 'Graph', exact: true })
      .click();
    if (viewport.width < 600)
      await page.getByRole('button', { name: 'Browse', exact: true }).click();
    const sidebarEdit = page.getByRole('button', {
      name: 'Edit wallet name: Renamed wallet',
      exact: true,
    });
    await sidebarEdit.click();
    await expect(name).toHaveValue('Renamed wallet');
    await expect(key).not.toHaveValue(PUBLIC_ZPUB);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(sidebarEdit).toBeFocused();
  });
}
