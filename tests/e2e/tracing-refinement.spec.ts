import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { parseWorkspace, newWorkspace } from '../../src/domain/workspace';

const password = 'public-tracing-refinement';
const older = 'c'.repeat(64);
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
  const calls = await mockBitcoin(page);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.method === 'getrawtransaction' && call.params[0] === TX_FUNDING)
      return route.fulfill({
        json: { result: { ...transactions[TX_FUNDING], vin: [{ txid: older, vout: 0 }] } },
      });
    if (call.method === 'getrawtransaction' && call.params[0] === older)
      return route.fulfill({ json: { result: { ...transactions[TX_FUNDING], txid: older } } });
    return route.fallback();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Trace refinement');
  await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByLabel('Confirm password').fill(password);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  return calls;
}
async function add(page: Page, value: string) {
  await page.getByLabel('Transaction, output, or address').fill(value);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
}
async function saved(page: Page) {
  const entry = await page.evaluate(
    () => JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1') ?? '[]')[0],
  );
  return entry?.envelope
    ? parseWorkspace(await decryptWorkspace(entry.envelope, password))
    : undefined;
}

for (const depth of ['0', '1'])
  test(`cached expansion and removal clean the input branch with Previous ${depth}`, async ({
    page,
  }) => {
    await setup(page);
    await page.getByLabel('Prefetch previous levels').selectOption(depth);
    await add(page, TX_SPENDING);
    if (depth === '0')
      await page.getByRole('button', { name: /Load missing input details/ }).click();
    await expect(page.locator('.statusbar')).toContainText('2 transactions');
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/rpc')) {
        const body = request.postDataJSON();
        if (body.method === 'getrawtransaction') requests.push(body.params[0]);
      }
    });
    const canvas = page.locator('.graph-canvas canvas');
    await canvas.focus();
    await canvas.press('Enter');
    const card = page.getByRole('dialog', { name: 'Graph item details' });
    await expect(card).toBeVisible();
    await card
      .getByRole('button', { name: /Load previous level|Open creating transaction/ })
      .click();
    await expect(
      page.getByRole('status').filter({
        hasText:
          depth === '0'
            ? 'Expanded 1 cached input transaction'
            : 'Previous transactions are already visible',
      }),
    ).toBeVisible();
    expect(requests).toEqual([]);
    await page.keyboard.press('Escape');
    const row = page
      .locator('.entity-list-entry')
      .filter({ has: page.locator(`.entity-row[title="tx:${TX_SPENDING}"]`) });
    await row.getByRole('button', { name: /Remove .* from workspace/ }).click();
    await expect(page.locator('.statusbar')).toContainText('0 transactions');
    await expect(page.locator('.entity-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo workspace change', exact: true }).first().click();
    await expect(page.locator('.statusbar')).toContainText('2 transactions');
  });

test('successful output lookup focuses that output with selection locking disabled', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await add(page, TX_FUNDING);
  await page.getByRole('button', { name: /Load missing input details/ }).click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await expect(
    page.getByRole('button', { name: 'Lock to selection', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  const canvas = page.locator('.graph-canvas canvas');
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.9, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  const before = (await saved(page))!.view.graphSnapshot!.camera;
  await add(page, `${TX_SPENDING}:1`);
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  await expect.poll(async () => (await saved(page))?.view.selectionId).toBe(`out:${TX_SPENDING}:1`);
  // Selection can save before the idle camera snapshot. Wait for the focused view too.
  await expect
    .poll(async () => (await saved(page))?.view.graphSnapshot?.camera)
    .not.toEqual(before);
  await expect
    .poll(async () =>
      (await saved(page))?.view.graphSnapshot?.nodes.some(
        (node) => node.id === `out:${TX_SPENDING}:1`,
      ),
    )
    .toBe(true);
  const state = (await saved(page))!;
  expect(state.view.graphSnapshot!.camera).not.toEqual(before);
  expect(state.view.lockToSelection).not.toBe(true);
  const point = state.view.graphSnapshot!.nodes.find((node) => node.id === `out:${TX_SPENDING}:1`)!;
  const camera = state.view.graphSnapshot!.camera;
  expect(Math.hypot(camera.target.x - point.x, camera.target.y - point.y)).toBeLessThan(60);
  // Distance adapts to the selected node and its immediate neighborhood.
  expect(camera.position.z).toBeGreaterThan(camera.target.z);
});

test('opening a saved workspace focuses its password and returns focus when dismissed', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toBeVisible();
  // Reload starts from the initial screen after the encrypted save completes.
  await page.reload();
  const entry = page.locator('.saved-row').filter({ hasText: 'Trace refinement' });
  await entry.click();
  let dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await expect(dialog.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type('typed-immediately');
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveValue('typed-immediately');
  await page.keyboard.press('Escape');
  await expect(entry).toBeFocused();
  await page.keyboard.press('Enter');
  dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await expect(dialog.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Transaction, output, or address')).toBeVisible();
});

test('deleting a root while manual tracing is pending discards late results and preserves Undo', async ({
  page,
}) => {
  await setup(page);
  let requests = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  page.on('close', release);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.method !== 'getrawtransaction' || call.params[0] !== TX_FUNDING)
      return route.fallback();
    requests++;
    await pending;
    await route.fulfill({ json: { result: transactions[TX_FUNDING] } }).catch(() => {});
  });
  await add(page, TX_SPENDING);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Load previous transactions', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await page
    .locator('.entity-list-entry')
    .filter({ has: page.locator(`.entity-row[title="tx:${TX_SPENDING}"]`) })
    .getByRole('button', { name: /Remove .* from workspace/ })
    .click();
  await expect(page.locator('.entity-row')).toHaveCount(0);
  release();
  await page.getByLabel('Transaction, output, or address').fill(TX_FUNDING);
  await expect(page.getByRole('button', { name: 'Add to graph', exact: true })).toBeEnabled();
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  await expect(page.locator('.statusbar')).toContainText('0 transactions');
  expect(Object.keys((await saved(page))!.transactions)).toEqual([]);
  await page.getByRole('button', { name: 'Undo workspace change', exact: true }).first().click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
});

test('a retained output placeholder cannot admit a late trace after its loaded creator is removed', async ({
  page,
}) => {
  const child = 'd'.repeat(64);
  const w = newWorkspace('Retained placeholder', 'mainnet');
  w.transactions = {
    [TX_SPENDING]: structuredClone(transactions[TX_SPENDING]),
    [child]: {
      ...structuredClone(transactions[TX_FUNDING]),
      txid: child,
      vin: [{ txid: TX_SPENDING, vout: 0 }],
    },
  };
  w.view = {
    ...w.view,
    leftTab: 'entities',
    selectionId: `out:${TX_SPENDING}:0`,
    transactionFlow: { open: false },
  };
  const entry = {
    id: w.id,
    publicName: w.name,
    savedAt: new Date().toISOString(),
    envelope: await encryptWorkspace(w, password),
  };
  await page.addInitScript((entry) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify([entry]));
  }, entry);
  await mockBitcoin(page);
  let requested = false;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  page.on('close', release);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.method !== 'getrawtransaction' || call.params[0] !== TX_FUNDING)
      return route.fallback();
    requested = true;
    await pending;
    await route.fulfill({ json: { result: transactions[TX_FUNDING] } }).catch(() => {});
  });
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Open creating transaction', exact: true }).click();
  await page.getByRole('button', { name: 'Load previous transactions', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page
    .locator('.entity-list-entry')
    .filter({ has: page.locator(`.entity-row[title="tx:${TX_SPENDING}"]`) })
    .getByRole('button', { name: /Remove .* from workspace/ })
    .click();
  await expect(page.locator(`.entity-row[title="out:${TX_SPENDING}:0"]`)).toBeVisible();
  release();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  const result = (await saved(page))!;
  expect(Object.keys(result.transactions)).toEqual([child]);
  await page.getByRole('button', { name: 'Undo workspace change', exact: true }).first().click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});
