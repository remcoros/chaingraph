import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace, decryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

const password = 'public batch controls browser fixture';
const fundingOutput = `out:${TX_FUNDING}:0`,
  fundingSibling = `out:${TX_FUNDING}:1`,
  spendingOutput = `out:${TX_SPENDING}:0`,
  spendingChange = `out:${TX_SPENDING}:1`;

async function seed(page: Page) {
  const workspace = newWorkspace('Batch controls investigation', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.annotations[fundingOutput] = {
    label: 'Keep this label',
    note: 'Unrelated note that must survive batch edits',
    icon: '★',
    bookmarked: true,
  };
  workspace.tags = [
    { id: crypto.randomUUID(), name: 'Exchange', color: '#65cbbb', nodeIds: [fundingOutput] },
  ];
  workspace.view = {
    ...workspace.view,
    leftTab: 'entities',
    rightTab: 'inspect',
    transactionFlow: { open: true, transactionId: TX_SPENDING },
  };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, publicName, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      if (!localStorage.getItem('chaingraph.encrypted-workspaces.v1'))
        localStorage.setItem(
          'chaingraph.encrypted-workspaces.v1',
          JSON.stringify([{ id, publicName, envelope, savedAt: new Date().toISOString() }]),
        );
    },
    { id: workspace.id, publicName: workspace.name, envelope },
  );
  await mockBitcoin(page);
  await page.goto('/');
  await page.locator('.saved-row').click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog).toBeHidden();
  return workspace;
}

async function saved(page: Page): Promise<Workspace> {
  await expect(page.locator('.statusbar')).toContainText('Encrypted · saved');
  const records = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!),
  );
  return (await decryptWorkspace(records[0].envelope, password)) as Workspace;
}

test('filters, batch selection and anchored batch editors keep other metadata intact', async ({
  page,
}) => {
  await seed(page);
  const toolbar = page.locator('.selection-toolbar');
  const chips = page.locator('.filter-chip');

  // Narrow the canvas to unlabeled outputs through the consolidated popover.
  await page.locator('.graph-navigation').getByRole('button', { name: 'Filters' }).click();
  const filters = page.getByRole('dialog', { name: 'Graph filters' });
  await filters.getByLabel('Entity type filter').selectOption('output');
  await filters.getByLabel('Entity label state').selectOption('unlabeled');
  await filters.getByRole('button', { name: 'Close graph filters' }).click();
  await expect(chips).toHaveText(['Type: Outputs', 'No label']);

  // The exact scope and count are stated before any batch edit.
  await page.locator('.graph-navigation').getByRole('button', { name: 'Selection mode' }).click();
  const selectMatching = toolbar.getByRole('button', { name: 'Select 3 matching outputs' });
  await expect(selectMatching).toBeVisible();
  await selectMatching.click();
  await expect(toolbar.getByRole('status')).toContainText('3 selected');

  // Label only the unlabeled entities, with the affected and replacement counts shown.
  await toolbar.getByRole('button', { name: 'Label' }).click();
  const labelEditor = page.getByRole('dialog', { name: 'Label selected entities' });
  await expect(labelEditor.getByRole('status')).toContainText('Applies to 3 of 3 selected');
  await labelEditor.getByLabel(/^Label for/).fill('Batch reviewed');
  await labelEditor.getByRole('button', { name: 'Apply to 3' }).click();
  await expect(labelEditor).toBeHidden();
  // Applying closes the editor and returns focus to its trigger.
  await expect(toolbar.getByRole('button', { name: 'Label', exact: true })).toBeFocused();

  let workspace = await saved(page);
  expect(workspace.annotations[fundingSibling].label).toBe('Batch reviewed');
  expect(workspace.annotations[spendingOutput].label).toBe('Batch reviewed');
  expect(workspace.annotations[spendingChange].label).toBe('Batch reviewed');
  // The labeled, tagged and bookmarked entity was outside the filtered scope.
  expect(workspace.annotations[fundingOutput]).toEqual({
    label: 'Keep this label',
    note: 'Unrelated note that must survive batch edits',
    icon: '★',
    bookmarked: true,
  });

  // One Undo step restores the whole batch.
  await toolbar.getByRole('button', { name: /^Undo: Label applied/ }).click();
  workspace = await saved(page);
  expect(workspace.annotations[fundingSibling]?.label ?? '').toBe('');
  expect(workspace.annotations[fundingOutput].label).toBe('Keep this label');

  // Selection survives the undo; tag and icon batches use the same explicit scope.
  await expect(toolbar.getByRole('status')).toContainText('3 selected');
  await toolbar.getByRole('button', { name: 'Tag', exact: true }).click();
  const tagEditor = page.getByRole('dialog', { name: 'Tag selected entities' });
  await expect(tagEditor.getByText('in 0 of 3')).toBeVisible();
  // Only one batch editor is active at a time.
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await tagEditor.getByLabel('Find or create a tag for the selection').fill('Reviewed batch');
  await tagEditor.getByRole('button', { name: /^Create “Reviewed batch”/ }).click();
  await expect(tagEditor).toBeHidden();
  workspace = await saved(page);
  expect(workspace.tags?.map((tag) => tag.name)).toEqual(['Exchange', 'Reviewed batch']);
  expect(workspace.tags?.[1].nodeIds.sort()).toEqual(
    [fundingSibling, spendingOutput, spendingChange].sort(),
  );
  expect(workspace.tags?.[0].nodeIds).toEqual([fundingOutput]);

  await toolbar.getByRole('button', { name: /^Set an icon on 3/ }).click();
  await page.getByRole('dialog', { name: 'Choose node icon' }).getByLabel('CoinJoin').click();
  workspace = await saved(page);
  expect(workspace.annotations[spendingOutput].icon).toBe('🤝');
  expect(workspace.annotations[fundingOutput].icon).toBe('★');

  // Manual hiding stays separate from filters and keeps its own recovery affordance.
  await toolbar.getByRole('button', { name: 'Hide', exact: true }).click();
  const hiddenChip = page.locator('.filter-chip-hidden');
  await expect(hiddenChip).toContainText('3 hidden manually');
  await expect(toolbar.getByRole('status')).toContainText('3 not on canvas');
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(chips.filter({ hasText: 'Type: Outputs' })).toHaveCount(0);
  await expect(hiddenChip).toContainText('3 hidden manually');
  await hiddenChip.getByRole('button', { name: /^Show all 3/ }).click();
  await expect(page.locator('.filter-chip-hidden')).toHaveCount(0);

  // Isolation is visible as its own removable scope chip.
  await toolbar.getByRole('button', { name: 'Isolate' }).click();
  const isolation = chips.filter({ hasText: 'Isolated 3 entities' });
  await expect(isolation).toBeVisible();
  await isolation.getByRole('button', { name: /^Remove filter/ }).click();
  await expect(chips.filter({ hasText: 'Isolated' })).toHaveCount(0);

  await toolbar.getByRole('button', { name: 'Clear' }).click();
  await expect(toolbar.getByRole('status')).toContainText('0 selected');
  workspace = await saved(page);
  expect(workspace.view.hiddenNodeIds ?? []).toEqual([]);
});

test('selection is explicit, scoped per workspace and pruned only by removal', async ({ page }) => {
  await seed(page);
  const toolbar = page.locator('.selection-toolbar');
  await page.locator('.graph-navigation').getByRole('button', { name: 'Selection mode' }).click();

  // Single click still inspects and opens the transaction flow.
  const rows = page.locator('.entity-list .entity-list-entry');
  await rows
    .filter({ hasText: TX_SPENDING.slice(0, 8) })
    .first()
    .locator('.entity-row')
    .click();
  await expect(page.getByLabel('Node label')).toBeVisible();

  // Flow checkboxes share the same selection without changing the inspected entity.
  const flowRow = page
    .locator('.transaction-row')
    .filter({ has: page.getByRole('button', { name: /^Output 0:/ }) });
  await flowRow.getByRole('checkbox').check();
  await expect(toolbar.getByRole('status')).toContainText('1 selected');
  // The Inspector still shows the clicked transaction, not the checked output.
  await expect(page.locator('.selection-heading .eyebrow')).toHaveText('TRANSACTION');

  // Entity rows use the same shared selection.
  await rows.nth(1).getByRole('checkbox').check();
  await expect(toolbar.getByRole('status')).toContainText('2 selected');
  await rows.nth(2).locator('.entity-row').click();
  await expect(page.getByLabel('Node label')).toBeVisible();
  await expect(toolbar.getByRole('status')).toContainText('2 selected');

  // Narrowing the results never grows the selection.
  await page.getByLabel('Filter graph entities').fill(TX_SPENDING.slice(0, 8));
  await expect(toolbar.getByRole('status')).toContainText('2 selected');

  // Removing a transaction prunes exactly its entities from the selection.
  await page.getByLabel('Filter graph entities').fill('');
  await page.getByLabel('Entity type', { exact: true }).selectOption('transaction');
  await page
    .locator('.entity-list-entry')
    .filter({ hasText: TX_SPENDING.slice(0, 8) })
    .getByRole('button', { name: /^Remove/ })
    .click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible())
    await dialog
      .getByRole('button', { name: /Remove|Confirm/ })
      .first()
      .click();
  await expect(toolbar.getByRole('status')).toContainText('1 selected');
});

test('batch controls stay reachable and tappable on a phone screen', async ({ page }, testInfo) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  await page.locator('.left-panel').getByRole('button', { name: 'Select', exact: true }).click();
  const rows = page.locator('.entity-list .entity-list-entry');
  await rows.nth(0).getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  const toolbar = page.locator('.selection-toolbar');
  await expect(toolbar.getByRole('status')).toContainText('2 selected');
  const box = await toolbar.getByRole('button', { name: 'Label' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(36);
  await expect(toolbar).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('batch-controls-phone.png') });
  await toolbar.getByRole('button', { name: 'Label' }).click();
  const editor = page.getByRole('dialog', { name: 'Label selected entities' });
  await expect(editor).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(toolbar.getByRole('button', { name: 'Label' })).toBeFocused();
});

test('context entities shown to explain links never become batch targets', async ({ page }) => {
  await seed(page);
  await page.locator('.graph-navigation').getByRole('button', { name: 'Filters' }).click();
  const filters = page.getByRole('dialog', { name: 'Graph filters' });
  await filters.getByLabel('Entity type filter').selectOption('transaction');
  await filters.getByLabel('Show connected context on canvas').check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Entity visibility').selectOption('graph');
  await page.locator('.left-panel').getByRole('button', { name: 'Select', exact: true }).click();

  // The list shows canvas context, and the batch scope counts only real matches.
  const bar = page.locator('.entity-selection-bar');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(6);
  await expect(bar).toContainText('4 context entities excluded');
  await bar
    .getByRole('button', { name: 'Select 2 matching transactions in the entity list' })
    .click();
  await expect(page.locator('.selection-toolbar').getByRole('status')).toContainText('2 selected');
});

test('a batch Undo retires when a later edit owns the undo step, protecting that edit', async ({
  page,
}) => {
  await seed(page);
  const toolbar = page.locator('.selection-toolbar');
  await page.locator('.graph-navigation').getByRole('button', { name: 'Selection mode' }).click();
  const rows = page.locator('.entity-list .entity-list-entry');
  await rows.nth(1).getByRole('checkbox').check();
  await rows.nth(2).getByRole('checkbox').check();
  await expect(toolbar.getByRole('status')).toContainText('2 selected');

  // Apply a batch tag; its Undo is offered while the batch owns the undo step.
  await toolbar.getByRole('button', { name: 'Tag', exact: true }).click();
  const tagEditor = page.getByRole('dialog', { name: 'Tag selected entities' });
  await tagEditor.getByLabel('Find or create a tag for the selection').fill('Equal-value review');
  await tagEditor.getByRole('button', { name: /^Create “Equal-value review”/ }).click();
  const batchUndo = toolbar.getByRole('button', { name: /^Undo: Tag Equal-value review/ });
  await expect(batchUndo).toBeVisible();

  // A later unrelated annotation edit takes over the undo step.
  await rows.nth(2).locator('.entity-row').click();
  await page.getByLabel('Node notes').fill('Note written after the batch');
  await expect(batchUndo).toHaveCount(0);
  await expect(toolbar.getByRole('status')).toContainText('2 selected');
  let workspace = await saved(page);
  expect(workspace.annotations[fundingSibling].note).toBe('Note written after the batch');
  expect(workspace.tags?.[1].nodeIds).toHaveLength(2);

  // The header Undo remains the general history control and restores that note only.
  await page.locator('.workspace-undo').click();
  workspace = await saved(page);
  expect(workspace.annotations[fundingSibling]?.note ?? '').toBe('');
  expect(workspace.tags?.[1].nodeIds).toHaveLength(2);

  // A batch that changes nothing never advertises an undo step.
  await toolbar.getByRole('button', { name: 'Label', exact: true }).click();
  const labelEditor = page.getByRole('dialog', { name: 'Label selected entities' });
  await labelEditor.getByLabel(/^Label for/).fill('Repeated label');
  await labelEditor.getByRole('button', { name: 'Apply to 2' }).click();
  await expect(toolbar.getByRole('button', { name: /^Undo: Label/ })).toBeVisible();
  await toolbar.getByRole('button', { name: 'Label', exact: true }).click();
  await labelEditor.getByLabel(/^Label for/).fill('Repeated label');
  await labelEditor.getByRole('button', { name: 'Apply to 2' }).click();
  await expect(page.locator('.toast')).toContainText('left every selected entity unchanged');
  await expect(toolbar.getByRole('button', { name: /^Undo:/ })).toHaveCount(0);
  workspace = await saved(page);
  expect(workspace.annotations[fundingSibling].label).toBe('Repeated label');
});
