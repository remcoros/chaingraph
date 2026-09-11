import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

const TX_OLDER = 'c'.repeat(64);
const password = 'automatic-flow-input-review';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
});

async function create(page: Page, name: string) {
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Name (public)', { exact: true }).fill(name);
  await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByLabel('Confirm password').fill(password);
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.locator('.workspace-tab').filter({ hasText: name })).toBeVisible();
}

async function add(page: Page, txid: string) {
  await page.getByLabel('Transaction, output, or address').fill(txid);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
}

async function settleRendering(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('input selection and backward navigation follow one outpoint; bulk details are explicit', async ({
  page,
}) => {
  await mockBitcoin(page);
  const fetched: string[] = [];
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    const id = call.params[0] as string;
    if (call.method !== 'getrawtransaction') return route.fallback();
    fetched.push(id);
    if (id === TX_FUNDING)
      return route.fulfill({
        json: {
          result: {
            ...transactions[TX_FUNDING],
            vin: [{ txid: TX_OLDER, vout: 0 }],
          },
        },
      });
    if (id === TX_OLDER)
      return route.fulfill({ json: { result: { ...transactions[TX_FUNDING], txid: TX_OLDER } } });
    return route.fallback();
  });
  await page.goto('/');
  await create(page, 'One transaction at a time');
  await expect(page.getByLabel('Prefetch previous levels')).toHaveValue('0');
  await add(page, TX_SPENDING);
  const flow = page.locator('.transaction-view');
  await expect(flow.getByRole('button', { name: /^Input 0:/ })).toContainText(
    'Select to load previous output',
  );
  await settleRendering(page);
  expect(fetched).toEqual([TX_SPENDING]);
  await flow.getByRole('button', { name: /^Input 0:/ }).click();
  await expect(flow.getByRole('button', { name: /^Input 0:/ })).toContainText('1.00 000 000 BTC');
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await settleRendering(page);
  expect(fetched).toEqual([TX_SPENDING, TX_FUNDING]);
  await expect(
    flow.getByRole('button', { name: `Select displayed transaction ${TX_SPENDING}` }),
  ).toBeVisible();
  await flow
    .getByRole('button', { name: 'Go to previous transaction for input 0', exact: true })
    .click();
  await expect(
    flow.getByRole('button', { name: `Select displayed transaction ${TX_FUNDING}` }),
  ).toBeVisible();
  await settleRendering(page);
  expect(fetched).toEqual([TX_SPENDING, TX_FUNDING]);
  await flow.getByRole('button', { name: `Select displayed transaction ${TX_FUNDING}` }).click();
  await settleRendering(page);
  expect(fetched).toEqual([TX_SPENDING, TX_FUNDING]);
  await flow.getByRole('button', { name: /^Load missing input details/ }).click();
  await expect(page.locator('.statusbar')).toContainText('3 transactions');
  expect(fetched).toEqual([TX_SPENDING, TX_FUNDING, TX_OLDER]);
});

test('unavailable previous outputs show a retry and recover without adding the transaction again', async ({
  page,
}) => {
  await mockBitcoin(page);
  let available = false;
  let failed = 0;
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.params[0] !== TX_FUNDING || available) return route.fallback();
    failed++;
    return route.fulfill({
      status: 503,
      json: { error: 'Synthetic previous transaction unavailable' },
    });
  });
  await page.goto('/');
  await create(page, 'Retry previous outputs');
  await add(page, TX_SPENDING);
  const flow = page.locator('.transaction-view');
  await flow.getByRole('button', { name: /^Input 0:/ }).click();
  await expect(flow.getByRole('alert')).toContainText('1 creating transaction could not be loaded');
  await expect(flow.getByRole('button', { name: /^Input 0:/ })).toContainText(
    'Select to load previous output',
  );
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  expect(failed).toBeGreaterThan(0);
  available = true;
  await flow.getByRole('button', { name: 'Retry previous outputs', exact: true }).click();
  await expect(flow.getByRole('button', { name: /^Input 0:/ })).toContainText('1.00 000 000 BTC');
  await expect(flow.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});

test('switching workspace cancels pending input hydration and preserves the new workspace graph', async ({
  page,
}) => {
  await mockBitcoin(page);
  let release = () => {};
  let complete = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let held = false;
  let received = false;
  page.on('close', release);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.params[0] === TX_OLDER)
      return route.fulfill({ json: { result: { ...transactions[TX_FUNDING], txid: TX_OLDER } } });
    if (call.params[0] !== TX_FUNDING || held) return route.fallback();
    held = true;
    received = true;
    await released;
    await route.fulfill({ json: { result: transactions[TX_FUNDING] } }).catch(() => {});
    complete();
  });
  await page.goto('/');
  await create(page, 'Pending input workspace');
  await add(page, TX_SPENDING);
  await page
    .locator('.transaction-view')
    .getByRole('button', { name: /^Input 0:/ })
    .click();
  await expect.poll(() => received).toBe(true);
  await expect(page.locator('.transaction-input-status')).toContainText('Loading previous outputs');
  await create(page, 'Current workspace');
  await add(page, TX_OLDER);
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  release();
  await completed;
  await settleRendering(page);
  await expect(
    page
      .locator('.transaction-view')
      .getByRole('button', { name: `Select displayed transaction ${TX_OLDER}` }),
  ).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await expect(page.locator('.entity-row')).toHaveCount(0);
  await page.locator('.workspace-tab').filter({ hasText: 'Pending input workspace' }).click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await page.locator('.workspace-tab').filter({ hasText: 'Current workspace' }).click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
});

for (const action of ['row', 'arrow'] as const) {
  test(`a compact parent's input ${action} retains flow context when its creator fails to load`, async ({
    page,
  }, testInfo) => {
    await mockBitcoin(page);
    let available = false;
    const olderCalls: string[] = [];
    await page.route('**/api/rpc', async (route) => {
      const call = route.request().postDataJSON();
      if (call.params[0] === TX_FUNDING)
        return route.fulfill({
          json: {
            result: {
              ...transactions[TX_FUNDING],
              vin: [{ txid: TX_OLDER, vout: 0 }],
            },
          },
        });
      if (call.params[0] !== TX_OLDER) return route.fallback();
      olderCalls.push(call.method);
      if (!available)
        return route.fulfill({ status: 503, json: { error: 'Backend request timed out' } });
      return route.fulfill({ json: { result: { ...transactions[TX_FUNDING], txid: TX_OLDER } } });
    });
    await page.goto('/');
    await create(page, `Compact input ${action}`);
    await add(page, TX_SPENDING);
    const flow = page.locator('.transaction-view');
    await flow.getByRole('button', { name: /^Input 0:/ }).click();
    await expect(page.locator('.statusbar')).toContainText('2 transactions');
    await flow
      .getByRole('button', { name: 'Go to previous transaction for input 0', exact: true })
      .click();
    await expect(
      flow.getByRole('button', { name: `Select displayed transaction ${TX_FUNDING}` }),
    ).toBeVisible();
    // Do not select the central transaction: that would expand its compact context
    // and conceal the bug triggered by selecting its still-unloaded input directly.
    await flow
      .getByRole('button', {
        name: action === 'row' ? `Input 0: ${TX_OLDER}:0` : 'Load previous transaction for input 0',
        exact: true,
      })
      .click();
    await expect(flow).toBeVisible();
    await expect(
      flow.getByRole('button', { name: `Select displayed transaction ${TX_FUNDING}` }),
    ).toBeVisible();
    await expect(
      flow.getByRole('button', { name: `Input 0: ${TX_OLDER}:0`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(flow.getByRole('alert')).toContainText('could not be loaded');
    await expect(flow.getByRole('alert')).toContainText('timed out');
    expect(olderCalls.length).toBeGreaterThan(0);
    await expect(page.locator('.statusbar')).toContainText('2 transactions');
    available = true;
    await flow.getByRole('button', { name: 'Retry previous outputs', exact: true }).click();
    await expect(page.locator('.statusbar')).toContainText('3 transactions');
    await expect(flow.getByRole('alert')).toHaveCount(0);
    await expect(
      flow.getByRole('button', { name: `Input 0: ${TX_OLDER}:0`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
}
