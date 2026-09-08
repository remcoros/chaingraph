import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace, decryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';
import { mockBitcoin, transactions, TX_FUNDING } from '../fixtures/bitcoin';

const password = 'public graph transition fixture';
async function seed(page: Page, migrate = false) {
  const first = newWorkspace('Camera workspace A', 'mainnet');
  first.transactions = structuredClone(transactions);
  first.view.selectionId = `tx:${TX_FUNDING}`;
  first.view.transactionFlow = { open: false, transactionId: TX_FUNDING };
  first.view.dimensions = 2;
  if (migrate)
    for (let index = 0; index < 125; index++)
      first.annotations[`tx:${(index + 1).toString(16).padStart(64, '0')}`] = {
        label: '',
        note: 'Public migration fixture '.repeat(360),
        icon: '',
        bookmarked: false,
      };
  const second = newWorkspace('Saved workspace B', 'mainnet');
  const records = await Promise.all(
    [first, second].map(async (workspace) => ({
      id: workspace.id,
      publicName: workspace.name,
      savedAt: new Date().toISOString(),
      envelope: await encryptWorkspace(workspace, password),
    })),
  );
  await page.addInitScript((entries) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify(entries));
    const host = window as unknown as { __delayNextSave?: boolean; __delayedSaveStarted?: boolean };
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
      if (
        host.__delayNextSave &&
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'encrypt-workspace'
      ) {
        host.__delayNextSave = false;
        host.__delayedSaveStarted = true;
        setTimeout(() => Reflect.apply(original, this, [message, ...rest]), 1500);
        return;
      }
      Reflect.apply(original, this, [message, ...rest]);
    };
  }, records);
  await mockBitcoin(page, false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await unlock(page, first.name);
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  if (!migrate) {
    await page.waitForTimeout(7500);
    await expect(page.locator('.save-status')).toContainText('Encrypted · saved');
  }
  return { first, second };
}
async function unlock(page: Page, name: string) {
  await page.locator('.saved-row').filter({ hasText: name }).click();
  const modal = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await modal.getByLabel('Password', { exact: true }).fill(password);
  await modal.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(modal).toBeHidden({ timeout: 15000 });
}
async function readSaved(page: Page, id: string): Promise<Workspace> {
  const envelope = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!).find(
        (entry: { id: string }) => entry.id === id,
      ).envelope,
    id,
  );
  return (await decryptWorkspace(envelope, password)) as Workspace;
}

test('beforeunload captures a pending camera gesture and prevents silently leaving', async ({
  page,
}) => {
  const { first } = await seed(page);
  const before = (await readSaved(page, first.id)).view.graphSnapshot!.camera;
  const bounds = (await page.locator('.graph-canvas canvas').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.8);
  await page.mouse.wheel(0, -250);
  const prevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.locator('.save-status')).toContainText('Encrypted · saved');
  await expect
    .poll(async () => (await readSaved(page, first.id)).view.graphSnapshot!.camera)
    .not.toEqual(before);
});

test('opening saved workspace B waits for the save started while leaving workspace A', async ({
  page,
}) => {
  const { first, second } = await seed(page);
  await page.evaluate(() => {
    (window as unknown as { __delayNextSave: boolean }).__delayNextSave = true;
  });
  await page.getByLabel('Node notes', { exact: true }).fill('Saved while leaving workspace A');
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __delayedSaveStarted?: boolean }).__delayedSaveStarted,
      ),
    )
    .toBe(true);
  await unlock(page, second.name);
  await expect(page.locator('.workspace-tab.active')).toContainText(second.name);
  await expect(
    page.getByRole('alert').filter({
      hasText: /autosave failed|saved workspace changed|another tab|encryption failed/i,
    }),
  ).toHaveCount(0);
  expect((await readSaved(page, first.id)).annotations[`tx:${TX_FUNDING}`].note).toBe(
    'Saved while leaving workspace A',
  );
  expect((await readSaved(page, second.id)).name).toBe(second.name);
});

test('an already open unlock dialog follows an unchanged workspace entry migrated by another save', async ({
  page,
}) => {
  const { first, second } = await seed(page, true);
  await page.evaluate(() => {
    (window as unknown as { __delayNextSave: boolean }).__delayNextSave = true;
  });
  await page.getByLabel('Node notes', { exact: true }).fill('Trigger large workspace migration');
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await page.locator('.saved-row').filter({ hasText: second.name }).click();
  const modal = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await expect(modal).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!).find(
              (entry: { id: string }) => entry.id === id,
            )?.envelopeRef,
          second.id,
        ),
      { timeout: 20000 },
    )
    .toBeTruthy();
  await modal.getByLabel('Password', { exact: true }).fill(password);
  await modal.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(modal).toBeHidden({ timeout: 15000 });
  await expect(page.locator('.workspace-tab.active')).toContainText(second.name);
  await expect(
    page.getByRole('alert').filter({
      hasText: /autosave failed|saved workspace changed|another tab|encryption failed/i,
    }),
  ).toHaveCount(0);
  expect(first.id).not.toBe(second.id);
});
