import { expect, test, type Page } from '@playwright/test';
import { WORKSPACE_TEMPLATES } from '../../src/domain/workspaceTemplates';
import { decryptWorkspace } from '../../src/lib/crypto';
import type { Workspace } from '../../src/domain/types';
import { parseWorkspace } from '../../src/domain/workspace';
import { mockBitcoin } from '../fixtures/bitcoin';

const PASSWORD = 'public-template-test-password';
const STORAGE = 'chaingraph.encrypted-workspaces.v1';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
});

async function prepare(page: Page, templateName: string) {
  await page.getByRole('button', { name: `Create ${templateName} workspace`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password').fill(PASSWORD);
  return dialog;
}
async function savedWorkspaces(page: Page): Promise<Workspace[]> {
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  const envelopes = await page.evaluate(async (key) => {
    const entries = JSON.parse(localStorage.getItem(key) ?? '[]') as {
      envelope?: unknown;
      envelopeRef?: string;
    }[];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chaingraph.encrypted-envelopes.v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await Promise.all(
        entries.map(
          (entry) =>
            entry.envelope ??
            new Promise<unknown>((resolve, reject) => {
              const request = db
                .transaction('envelopes', 'readonly')
                .objectStore('envelopes')
                .get(entry.envelopeRef!);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
    } finally {
      db.close();
    }
  }, STORAGE);
  return Promise.all(
    envelopes.map(async (envelope) => parseWorkspace(await decryptWorkspace(envelope, PASSWORD))),
  );
}

for (const template of WORKSPACE_TEMPLATES) {
  test(`${template.id} creates an annotated, ordinary encrypted copy with no initial RPC`, async ({
    page,
  }) => {
    const calls = await mockBitcoin(page, { networks: [template.network] });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('.workspace-template-open')).toHaveCount(2);
    const dialog = await prepare(page, template.name);
    await expect(dialog.getByLabel('Name (public)', { exact: true })).toHaveValue(template.name);
    await expect(dialog.getByLabel('Workspace description')).toHaveValue(template.description);
    await expect(dialog.getByLabel('Bitcoin network')).toHaveValue(template.network);
    await expect(dialog.getByLabel('Bitcoin network')).toHaveAttribute('readonly');
    await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.transaction-flow')).toBeVisible();
    const [copy] = await savedWorkspaces(page);
    expect(copy.name).toBe(template.name);
    expect(copy.network).toBe(template.network);
    expect(copy.demo).toBe(false);
    expect(copy.tags!.length).toBeGreaterThan(0);
    expect(
      Object.values(copy.annotations).some((a) => a.label && a.note && a.icon && a.bookmarked),
    ).toBe(true);
    expect(Object.keys(copy.transactions).length).toBeGreaterThan(1);
    const storage = await page.evaluate((key) => localStorage.getItem(key), STORAGE);
    expect(storage).not.toContain(template.description);
    expect(storage).not.toContain(PASSWORD);
    expect(storage).not.toContain('OP_RETURN text');
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('template copies retain edits after lock, and Help creates an independent workspace on another network', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.goto('/');
  const template = WORKSPACE_TEMPLATES[1];
  const dialog = await prepare(page, template.name);
  const name = dialog.getByLabel('Name (public)', { exact: true });
  await name.click();
  await name.pressSequentially('My message study');
  await expect(name).toHaveValue('My message study');
  await dialog.getByLabel('Workspace description').fill('Private example description');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Node label', { exact: true }).fill('My data output');
  await page.getByLabel('Node notes', { exact: true }).fill('Private observation retained');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.locator('.saved-row').filter({ hasText: 'My message study' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('My data output');
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'Private observation retained',
  );
  for (const next of [template, WORKSPACE_TEMPLATES[2]]) {
    await page.getByRole('button', { name: 'Help and samples', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Example workspaces', exact: true }).click();
    const create = await prepare(page, next.name);
    await create.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(create).not.toBeVisible();
  }
  const copies = await savedWorkspaces(page);
  expect(copies).toHaveLength(3);
  expect(new Set(copies.map((copy) => copy.id)).size).toBe(3);
  expect(copies.find((copy) => copy.name === 'My message study')?.description).toBe(
    'Private example description',
  );
  expect(copies.find((copy) => copy.name === template.name)?.description).toBe(
    template.description,
  );
  expect(copies.filter((copy) => copy.network === 'testnet4')).toHaveLength(1);
});

test('unsupported examples stay hidden and creation works with configured but disconnected nodes', async ({
  page,
}) => {
  const calls = await mockBitcoin(page, { networks: ['testnet4'], connected: false });
  await page.goto('/');
  await expect(page.locator('.workspace-template-network')).toHaveText(['Testnet4', 'Testnet4']);
  await page.getByRole('button', { name: 'Help and samples', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Example workspaces', exact: true }).click();
  const examples = page.getByRole('dialog', { name: 'Example workspaces' });
  await expect(examples.locator('.workspace-template-network')).toHaveText([
    'Testnet4',
    'Testnet4',
  ]);
  await examples.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const dialog = await prepare(page, WORKSPACE_TEMPLATES[2].name);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  expect((await savedWorkspaces(page))[0].network).toBe('testnet4');
  expect(calls).toEqual([]);
});

test('failed discovery offers no example cards', async ({ page }) => {
  await page.route('**/api/networks', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Help and samples', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Example workspaces', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.workspace-template')).toHaveCount(0);
});

test('creation locks the fields while loading and cancellation does not leave a workspace', async ({
  page,
}) => {
  await mockBitcoin(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/src/lib/templateWorkspace.worker.ts*', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto('/');
  const dialog = await prepare(page, WORKSPACE_TEMPLATES[1].name);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(dialog.getByLabel('Password', { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Name (public)', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  release();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.workspace-tab')).toHaveCount(0);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]').length, STORAGE),
  ).toBe(0);
  await page.unroute('**/src/lib/templateWorkspace.worker.ts*');
  const retry = await prepare(page, WORKSPACE_TEMPLATES[1].name);
  await retry.getByRole('button', { name: 'Create workspace', exact: true }).click();
  expect(await savedWorkspaces(page)).toHaveLength(1);
});

test('a failed template download leaves the form retryable', async ({ page }) => {
  await mockBitcoin(page);
  await page.route('**/src/lib/templateWorkspace.worker.ts*', (route) => route.abort());
  await page.goto('/');
  const dialog = await prepare(page, WORKSPACE_TEMPLATES[1].name);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not load the example workspace');
  await expect(dialog.getByLabel('Password', { exact: true })).toBeEnabled();
  await expect(page.locator('.workspace-tab')).toHaveCount(0);
  await page.unroute('**/src/lib/templateWorkspace.worker.ts*');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  expect(await savedWorkspaces(page)).toHaveLength(1);
});

test('mobile examples keep their close control visible and cancellation restores keyboard focus', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Example workspaces', exact: true }).click();
  const examples = page.getByRole('dialog', { name: 'Example workspaces' });
  const last = examples.getByRole('button', {
    name: 'Create Explore 53 outputs workspace',
    exact: true,
  });
  await last.scrollIntoViewIfNeeded();
  await expect(
    examples.getByRole('button', { name: 'Close dialog', exact: true }),
  ).toBeInViewport();
  await last.click();
  const create = page.getByRole('dialog', { name: 'Create a workspace' });
  await expect(create.getByLabel('Name (public)', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(create).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Help and samples', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
