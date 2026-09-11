import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace, decryptWorkspace } from '../../src/lib/crypto';
import { buildGraph, newWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

const password = 'public batch controls browser fixture';
const fundingOutput = `out:${TX_FUNDING}:0`,
  fundingSibling = `out:${TX_FUNDING}:1`,
  spendingOutput = `out:${TX_SPENDING}:0`,
  spendingChange = `out:${TX_SPENDING}:1`;

async function seed(page: Page, customize?: (workspace: Workspace) => void) {
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
  customize?.(workspace);
  workspace.view.graphNodeIds = buildGraph(workspace).nodes.map((node) => node.id);
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
  const labelEditor = page.getByRole('dialog', { name: 'Label selected records' });
  await expect(labelEditor.getByText('3 of 3 records change.')).toBeVisible();
  await labelEditor.getByLabel('Batch label').fill('Batch reviewed');
  await labelEditor.getByRole('button', { name: 'Apply label' }).click();
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
  await toolbar.getByRole('button', { name: /^Undo: Change (?:\d+ )?labels?/ }).click();
  workspace = await saved(page);
  expect(workspace.annotations[fundingSibling]?.label ?? '').toBe('');
  expect(workspace.annotations[fundingOutput].label).toBe('Keep this label');

  // Selection survives the undo; tag and icon batches use the same explicit scope.
  await expect(toolbar.getByRole('status')).toContainText('3 selected');
  await toolbar.getByRole('button', { name: 'Tags', exact: true }).click();
  const tagEditor = page.getByRole('dialog', { name: 'Tag selected records' });
  await expect(tagEditor.getByText('0 of 3 selected')).toBeVisible();
  // Only one batch editor is active at a time.
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await tagEditor.getByLabel('Find or create tag').fill('Reviewed batch');
  await tagEditor.getByRole('button', { name: 'Color 3', exact: true }).click();
  await tagEditor.getByRole('button', { name: 'Create and assign' }).click();
  await expect(tagEditor).toBeHidden();
  workspace = await saved(page);
  expect(workspace.tags?.map((tag) => tag.name)).toEqual(['Exchange', 'Reviewed batch']);
  expect(workspace.tags?.[1].nodeIds.sort()).toEqual(
    [fundingSibling, spendingOutput, spendingChange].sort(),
  );
  expect(workspace.tags?.[0].nodeIds).toEqual([fundingOutput]);
  expect(workspace.tags?.[1].color).toBe('#9c9aed');

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
  const spendingRow = rows.filter({
    has: page.getByTitle(`tx:${TX_SPENDING}`, { exact: true }),
  });
  await spendingRow.locator('.entity-row').click();
  await expect(page.getByLabel('Node label')).toBeVisible();

  // Flow checkboxes share the same selection without changing the inspected entity.
  const flowRow = page
    .locator('.transaction-row')
    .filter({ has: page.getByRole('button', { name: /^Output 0:/ }) });
  await flowRow.getByRole('checkbox').check();
  await expect(toolbar.getByRole('status')).toContainText('1 selected');
  // The Inspector still shows the clicked transaction, not the checked output.
  await expect(page.locator('.selection-heading .eyebrow:visible')).toHaveText('TRANSACTION');

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
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await spendingRow.getByRole('button', { name: /^Remove/ }).click();
  // This transaction has no annotations or tags, so removal is immediate.
  await expect(spendingRow).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Remove transaction?', exact: true })).toHaveCount(
    0,
  );
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
  await expect(toolbar).toBeInViewport();
  await toolbar.getByRole('button', { name: 'Label' }).click();
  const editor = page.getByRole('dialog', { name: 'Label selected records' });
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
  await page.keyboard.press('Escape');
  await page
    .locator('.graph-navigation-status')
    .getByRole('button', { name: /^Show connections/ })
    .click();
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
  await toolbar.getByRole('button', { name: 'Tags', exact: true }).click();
  const tagEditor = page.getByRole('dialog', { name: 'Tag selected records' });
  await tagEditor.getByLabel('Find or create tag').fill('Equal-value review');
  await tagEditor.getByRole('button', { name: 'Color 3', exact: true }).click();
  await tagEditor.getByRole('button', { name: 'Create and assign' }).click();
  const batchUndo = toolbar.getByRole('button', { name: /^Undo: Add tag/ });
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
  const labelEditor = page.getByRole('dialog', { name: 'Label selected records' });
  await labelEditor.getByLabel('Batch label').fill('Repeated label');
  await labelEditor.getByLabel('Replace existing labels').check();
  await labelEditor.getByRole('button', { name: 'Apply label' }).click();
  await expect(
    toolbar.getByRole('button', { name: /^Undo: Change (?:\d+ )?labels?/ }),
  ).toBeVisible();
  await toolbar.getByRole('button', { name: 'Label', exact: true }).click();
  await labelEditor.getByLabel('Batch label').fill('Repeated label');
  await labelEditor.getByLabel('Replace existing labels').check();
  await labelEditor.getByRole('button', { name: 'Apply label' }).click();
  await expect(page.locator('.toast')).toContainText('left every selected entity unchanged');
  await expect(toolbar.getByRole('button', { name: /^Undo:/ })).toHaveCount(0);
  workspace = await saved(page);
  expect(workspace.annotations[fundingSibling].label).toBe('Repeated label');
});

test('combined workbench navigation retains batch Undo and isolation reveals amount-filtered targets', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    workspace.view.smallAmountThreshold = 1000000000;
  });
  const toolbar = page.locator('.selection-toolbar');
  await page.locator('.graph-navigation').getByRole('button', { name: 'Selection mode' }).click();
  // Amount-filtered entities are excluded from the default "on graph" list scope;
  // widen to "all" so they can be selected and isolated back onto the canvas.
  const visibilityToggle = page.getByLabel(/^Entity visibility:/);
  await visibilityToggle.click();
  await visibilityToggle.click();
  const rows = page.locator('.entity-list .entity-list-entry');
  await rows.nth(1).getByRole('checkbox').check();
  await rows.nth(2).getByRole('checkbox').check();
  await toolbar.getByRole('button', { name: 'Label', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Label selected records' });
  await editor.getByLabel('Batch label').fill('Combined review');
  await editor.getByRole('button', { name: 'Apply label' }).click();
  const undo = toolbar.getByRole('button', { name: /^Undo: Change (?:\d+ )?labels?/ });
  await expect(undo).toBeVisible();
  const modes = page.getByRole('navigation', { name: 'Workbench', exact: true });
  await modes.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(toolbar).toBeHidden();
  await modes.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(undo).toBeVisible();
  await expect(toolbar).toContainText('2 not on canvas');
  await toolbar.getByRole('button', { name: 'Isolate', exact: true }).click();
  await expect(page.getByLabel('Hide small amounts in graph', { exact: true })).toHaveValue('0');
  await expect(toolbar.getByRole('status')).toContainText('2 selected');
  await expect(toolbar).toContainText('all on canvas');
  await expect(undo).toBeVisible();
  await undo.click();
  const workspace = await saved(page);
  expect(workspace.annotations[fundingOutput].label).toBe('Keep this label');
  expect(workspace.annotations[fundingSibling]?.label ?? '').toBe('');
});

test('shared graph quick editors keep long tags readable and preserve scope at 320px', async ({
  page,
}) => {
  const longName = 'Exchange withdrawal for long-term household savings and future expenses';
  await seed(page, (workspace) => {
    workspace.tags![0].name = longName;
    workspace.tags![0].description = 'Public description searchable from every quick tag editor';
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  await page.locator('.left-panel').getByRole('button', { name: 'Select', exact: true }).click();
  const rows = page.locator('.entity-list .entity-list-entry');
  await rows.nth(1).getByRole('checkbox').check();
  await rows.nth(2).getByRole('checkbox').check();
  const toolbar = page.locator('.selection-toolbar');
  const trigger = toolbar.getByRole('button', { name: 'Tags', exact: true });
  await trigger.click();
  const editor = page.getByRole('dialog', { name: 'Tag selected records' });
  const popup = page.locator('.metadata-popover');
  const input = editor.getByLabel('Find or create tag');
  await expect(input).toBeFocused();
  const row = editor.locator('.metadata-tag-option');
  await expect(row).toContainText(longName);
  await expect(
    row.getByRole('button', { name: `Add ${longName} to selected records`, exact: true }),
  ).toBeVisible();
  await input.fill('searchable');
  await expect(row).toHaveCount(1);
  await input.fill('');
  for (const name of ['S', 'x'.repeat(100)]) {
    await input.fill(name);
    await expect(editor.getByRole('button', { name: 'Create and assign' })).toBeVisible();
    expect(await popup.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await input.fill('Scoped savings');
  await editor.getByRole('button', { name: 'Color 4', exact: true }).click();
  await input.press('Enter');
  await expect(editor).toBeHidden();
  await expect(trigger).toBeFocused();
  const workspace = await saved(page);
  const tag = workspace.tags!.find((tag) => tag.name === 'Scoped savings')!;
  expect(tag.color).toBe('#e888a5');
  expect(tag.nodeIds.sort()).toEqual([fundingOutput, fundingSibling].sort());
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await toolbar.getByRole('button', { name: 'Label', exact: true }).click();
  const label = page.getByRole('dialog', { name: 'Label selected records' });
  await expect(label.getByLabel('Replace existing labels')).not.toBeChecked();
  await expect(label).toContainText('1 already labelled and kept as they are.');
  await label.getByLabel('Batch label').fill('Preserve previous labels');
  await label.getByRole('button', { name: 'Apply label' }).click();
  const labelled = await saved(page);
  expect(labelled.annotations[fundingOutput].label).toBe('Keep this label');
  expect(labelled.annotations[fundingSibling].label).toBe('Preserve previous labels');
});

test('quick editors toggle, follow viewport changes and close on focus or scope changes', async ({
  page,
}) => {
  await seed(page);
  await page.locator('.left-panel').getByRole('button', { name: 'Select', exact: true }).click();
  const rows = page.locator('.entity-list .entity-list-entry');
  await rows.nth(1).getByRole('checkbox').check();
  const toolbar = page.locator('.selection-toolbar');
  for (const name of ['Label', 'Tags']) {
    const trigger = toolbar.getByRole('button', { name, exact: true });
    await trigger.click();
    await expect(page.locator('.metadata-popover')).toBeVisible();
    await trigger.click();
    await expect(page.locator('.metadata-popover')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  const icon = toolbar.getByRole('button', { name: /^Set an icon/ });
  await icon.click();
  await expect(page.getByRole('dialog', { name: 'Choose node icon' })).toBeVisible();
  await icon.click();
  await expect(page.locator('.metadata-popover')).toHaveCount(0);
  await icon.click();
  await page.setViewportSize({ width: 390, height: 400 });
  const popup = page.locator('.metadata-popover');
  await expect(popup).toBeVisible();
  await expect(popup).toBeInViewport({ ratio: 1 });
  expect(await popup.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await toolbar.getByRole('button', { name: 'Tags', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Label', exact: true }).focus();
  await expect(popup).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Label', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Label selected records' })).toBeVisible();
  await page.getByLabel('Batch label').fill('Unapplied draft');
  // A keyboard selection change dismisses the editor without applying its draft.
  await rows.nth(2).getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await expect(popup).toHaveCount(0);
  await toolbar.getByRole('button', { name: 'Label', exact: true }).click();
  await expect(page.getByLabel('Batch label')).toHaveValue('');
  await page.keyboard.press('Escape');
  await icon.click();
  await rows.nth(2).getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await expect(popup).toHaveCount(0);
});
