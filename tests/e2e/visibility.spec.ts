import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace, decryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

const password = 'public visibility browser fixture';
const output = `out:${TX_FUNDING}:0`,
  sibling = `out:${TX_FUNDING}:1`;
async function seed(page: Page, customize?: (workspace: Workspace) => void) {
  const workspace = newWorkspace('Visibility investigation', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.annotations[output] = {
    label: 'Origin output',
    note: 'Retained private fixture note',
    icon: '',
    bookmarked: true,
  };
  workspace.view = {
    ...workspace.view,
    selectionId: output,
    leftTab: 'entities',
    rightTab: 'inspect',
    transactionFlow: { open: true, transactionId: TX_SPENDING },
    lockToSelection: true,
  };
  customize?.(workspace);
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
  await unlock(page);
  return workspace;
}
async function unlock(page: Page) {
  await page.locator('.saved-row').click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function saved(page: Page): Promise<Workspace> {
  await expect(page.locator('.statusbar')).toContainText('Encrypted · saved');
  const records = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!),
  );
  return (await decryptWorkspace(records[0].envelope, password)) as Workspace;
}
async function undo(page: Page) {
  const button = page.locator('.workspace-undo');
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page.getByRole('button', { name: 'Undo workspace change', exact: true }).click();
  }
}

test('hidden selections remain editable, survive reload, and only explicit show centers them', async ({
  page,
}) => {
  await seed(page);
  const inspector = page.locator('.right-panel');
  await inspector.getByRole('button', { name: 'Hide entity from graph', exact: true }).click();
  await expect(inspector.getByText('Hidden from graph', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Center selection', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Lock to selection', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Origin output');
  await page.getByLabel('Node notes', { exact: true }).fill('Edited while hidden');
  await page.getByLabel('Entity visibility', { exact: true }).selectOption('hidden');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await page.locator('.entity-browser .entity-row').click();
  await expect(inspector.getByText('Hidden from graph', { exact: true })).toBeVisible();
  await page.getByLabel('Filter graph entities').fill('Origin');
  await page.getByRole('button', { name: 'Clear entity and graph filters', exact: true }).click();
  expect((await saved(page)).view.hiddenNodeIds).toEqual([output]);
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toHaveCount(1);
  await page.reload();
  await unlock(page);
  await expect(page.getByLabel('Entity visibility', { exact: true })).toHaveValue('hidden');
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue('Edited while hidden');
  await expect(inspector.getByText('Hidden from graph', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Show and center', exact: true }).click();
  await expect(inspector.getByText('Hidden from graph', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Center selection', exact: true })).toBeEnabled();
  expect((await saved(page)).view.hiddenNodeIds ?? []).toEqual([]);
});

test('group hide/show is undoable and re-adding an outpoint leaves its hidden sibling untouched', async ({
  page,
}) => {
  await seed(page);
  await page.locator(`.entity-browser .entity-row[title="tx:${TX_FUNDING}"]`).click();
  const inspector = page.locator('.right-panel');
  await inspector.getByRole('button', { name: 'Input and output visibility', exact: true }).click();
  const controls = page.getByRole('dialog', { name: 'Transaction visibility', exact: true });
  // The creating transaction owns two independently hideable outputs.
  await controls.getByRole('button', { name: 'Hide 2 outputs from graph', exact: true }).click();
  await controls.getByRole('button', { name: 'Close visibility controls', exact: true }).click();
  await page.getByLabel('Entity visibility', { exact: true }).selectOption('hidden');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(2);
  expect(new Set((await saved(page)).view.hiddenNodeIds)).toEqual(new Set([output, sibling]));
  await page.getByRole('button', { name: 'Show all 2 hidden entities', exact: true }).click();
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(0);
  await page.getByLabel('Entity visibility', { exact: true }).selectOption('all');
  await undo(page);
  expect(new Set((await saved(page)).view.hiddenNodeIds)).toEqual(new Set([output, sibling]));
  await page.getByLabel('Transaction, output, or address').fill(`${TX_FUNDING}:0`);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
  await expect(inspector.getByText('Hidden from graph', { exact: true })).toBeHidden();
  expect((await saved(page)).view.hiddenNodeIds).toEqual([sibling]);
  expect((await saved(page)).annotations[output].note).toBe('Retained private fixture note');
});

test('transaction flow keeps hidden input rows available and restores an individual input', async ({
  page,
}) => {
  await seed(page);
  const flow = page.locator('.transaction-view');
  await flow.getByRole('button', { name: /^Select displayed transaction / }).click();
  await page
    .locator('.right-panel')
    .getByRole('button', { name: 'Input and output visibility', exact: true })
    .click();
  const controls = page.getByRole('dialog', { name: 'Transaction visibility', exact: true });
  await controls.getByRole('button', { name: 'Hide 2 inputs from graph', exact: true }).click();
  await controls.getByRole('button', { name: 'Close visibility controls', exact: true }).click();
  await expect(
    flow.getByRole('button', { name: 'Show input 0 in graph', exact: true }),
  ).toBeVisible();
  await expect(
    flow.getByRole('button', { name: 'Show input 1 in graph', exact: true }),
  ).toBeVisible();
  await flow.getByRole('button', { name: 'Show input 0 in graph', exact: true }).click();
  expect((await saved(page)).view.hiddenNodeIds).toEqual([sibling]);
  await expect(
    flow.getByRole('button', { name: 'Show input 1 in graph', exact: true }),
  ).toBeVisible();
});

for (const attached of ['output-note', 'tag-only'] as const) {
  test(`transaction removal confirms ${attached} metadata, supports cancellation and restores data on undo`, async ({
    page,
  }) => {
    const original = await seed(page, (workspace) => {
      if (attached === 'tag-only') workspace.annotations = {};
      workspace.tags = [
        {
          id: crypto.randomUUID(),
          name: 'Counterparty',
          color: '#339988',
          nodeIds: [output, `tx:${TX_SPENDING}`],
        },
      ];
    });
    await page.locator(`.entity-browser .entity-row[title="tx:${TX_FUNDING}"]`).click();
    await page
      .getByRole('button', { name: 'Remove transaction from workspace', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Remove transaction?', exact: true });
    await expect(dialog).toContainText(
      attached === 'output-note' ? '1 annotated entity' : '0 annotated entities',
    );
    await expect(dialog).toContainText('1 tag membership');
    await dialog.getByRole('button', { name: 'Keep in workspace', exact: true }).click();
    expect((await saved(page)).transactions[TX_FUNDING]).toBeDefined();
    await page
      .getByRole('button', { name: 'Remove transaction from workspace', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Remove transaction', exact: true }).click();
    const removed = await saved(page);
    expect(removed.transactions[TX_FUNDING]).toBeUndefined();
    expect(removed.transactions[TX_SPENDING]).toBeDefined();
    expect(removed.annotations[output]).toBeUndefined();
    expect(removed.tags?.[0].nodeIds).toEqual([`tx:${TX_SPENDING}`]);
    await undo(page);
    const restored = await saved(page);
    expect(restored.transactions[TX_FUNDING]).toEqual(original.transactions[TX_FUNDING]);
    expect(restored.annotations).toEqual(original.annotations);
    expect(restored.tags).toEqual(original.tags);
  });
}

test('unannotated transaction removal is immediate and individual outputs offer no removal', async ({
  page,
}) => {
  await seed(page);
  await expect(
    page.getByRole('button', { name: 'Remove transaction from workspace', exact: true }),
  ).toHaveCount(0);
  await page.locator(`.entity-browser .entity-row[title="tx:${TX_SPENDING}"]`).click();
  await page
    .getByRole('button', { name: 'Remove transaction from workspace', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Remove transaction?', exact: true })).toHaveCount(
    0,
  );
  const result = await saved(page);
  expect(result.transactions[TX_SPENDING]).toBeUndefined();
  expect(result.annotations[output].note).toBe('Retained private fixture note');
});

test('stopping an annotated address watch preserves loaded transactions and is undoable', async ({
  page,
}) => {
  const address = transactions[TX_FUNDING].vout[0].scriptPubKey.address;
  await seed(page, (workspace) => {
    workspace.watchedAddresses = [address];
    workspace.annotations[`addr:${address}`] = {
      label: '',
      note: 'Watch annotation',
      icon: '',
      bookmarked: false,
    };
    workspace.tags = [
      {
        id: crypto.randomUUID(),
        name: 'Address group',
        color: '#339988',
        nodeIds: [`addr:${address}`, output],
      },
    ];
    workspace.view = { ...workspace.view, showAddresses: true, selectionId: `addr:${address}` };
  });
  await page.getByRole('button', { name: 'Stop watching address', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stop watching address?', exact: true });
  await expect(dialog).toContainText('1 annotated entity');
  await dialog.getByRole('button', { name: 'Stop watching address', exact: true }).click();
  const stopped = await saved(page);
  expect(stopped.watchedAddresses).toEqual([]);
  expect(Object.keys(stopped.transactions)).toHaveLength(2);
  expect(stopped.annotations[`addr:${address}`]).toBeUndefined();
  expect(stopped.annotations[output]).toBeDefined();
  expect(stopped.tags?.[0].nodeIds).toEqual([output]);
  await undo(page);
  const restored = await saved(page);
  expect(restored.watchedAddresses).toEqual([address]);
  expect(restored.annotations[`addr:${address}`].note).toBe('Watch annotation');
  expect(restored.tags?.[0].nodeIds).toEqual([`addr:${address}`, output]);
});
