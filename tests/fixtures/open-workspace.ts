import { expect, type Page } from '@playwright/test';
import type { Workspace } from '../../src/domain/types';
import { encryptWorkspace } from '../../src/lib/crypto';
import { laboratoryWorkspace } from './laboratory';

/** Seed encrypted public test data, then exercise the ordinary unlock flow. */
export async function openFixtureWorkspace(page: Page, workspace: Workspace, password: string) {
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, name, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      // A reload must retain edits and view state saved by the test.
      if (localStorage.getItem('chaingraph.encrypted-workspaces.v1') === null)
        localStorage.setItem(
          'chaingraph.encrypted-workspaces.v1',
          JSON.stringify([{ id, publicName: name, savedAt: new Date().toISOString(), envelope }]),
        );
    },
    { id: workspace.id, name: workspace.name, envelope },
  );
  await page.goto('/');
  await page.locator('.saved-row').filter({ hasText: workspace.name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Open workspaces' })).toContainText(
    workspace.name,
  );
}

export async function openLaboratoryFixture(page: Page, name: string, password: string) {
  const workspace = laboratoryWorkspace();
  workspace.name = name;
  await openFixtureWorkspace(page, workspace, password);
  return workspace;
}
