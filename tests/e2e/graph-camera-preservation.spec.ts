import { expect, test, type Page } from '@playwright/test';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace, parseWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_FUNDING } from '../fixtures/bitcoin';

const password = 'public-camera-preservation-fixture';

async function savedCamera(page: Page) {
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1') ?? '[]')[0],
  );
  if (!saved?.envelope) return undefined;
  return parseWorkspace(await decryptWorkspace(saved.envelope, password)).view.graphSnapshot
    ?.camera;
}

test('empty, partial and failed spending searches retain the manually positioned graph', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w = newWorkspace('Preserve investigation camera', 'mainnet');
  w.transactions[TX_FUNDING] = structuredClone(transactions[TX_FUNDING]);
  w.view.dimensions = 2;
  w.view.selectionId = `tx:${TX_FUNDING}`;
  w.view.transactionFlow = { transactionId: TX_FUNDING };
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
  let mode: 'empty' | 'partial' | 'error' = 'empty';
  const candidateIds = Array.from({ length: 501 }, (_, index) =>
    (index + 1).toString(16).padStart(64, '0'),
  );
  await page.route('**/api/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.method === 'blockchain.scripthash.get_history') {
      if (mode === 'error')
        return route.fulfill({
          status: 413,
          json: { error: 'Address history exceeds the configured limit.' },
        });
      return route.fulfill({
        json: {
          result:
            mode === 'partial' ? candidateIds.map((tx_hash) => ({ tx_hash, height: 100 })) : [],
        },
      });
    }
    if (request.method === 'getrawtransaction' && candidateIds.includes(request.params[0]))
      return route.fulfill({
        json: { result: { ...transactions[TX_FUNDING], txid: request.params[0] } },
      });
    return route.fallback();
  });
  await page.goto('/');
  await page.locator('.saved-row').filter({ hasText: w.name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  const canvas = page.locator('.graph-canvas canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(7000);
  await canvas.evaluate((element) => element.setAttribute('data-camera-instance', 'same-canvas'));
  const initial = await savedCamera(page);
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * 0.8,
    y = bounds.y + bounds.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y - 25, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => savedCamera(page)).not.toEqual(initial);
  const before = await savedCamera(page);
  expect(before).toBeDefined();
  for (const outcome of ['empty', 'partial', 'error'] as const) {
    mode = outcome;
    await page
      .locator('.transaction-view')
      .getByRole('button', { name: 'Check output 0 for spends', exact: true })
      .click();
    if (outcome === 'error')
      await expect(
        page.getByRole('alert').filter({ hasText: 'Address history exceeds' }),
      ).toBeVisible();
    else {
      await expect(
        page.getByRole('status').filter({ hasText: '0 spending transactions found; 0 added' }),
      ).toBeVisible();
      if (outcome === 'partial')
        await expect(page.getByRole('status').filter({ hasText: 'Partial search' })).toBeVisible();
    }
    await expect(page.locator('.statusbar')).toContainText('1 transaction');
    await expect(canvas).toHaveAttribute('data-camera-instance', 'same-canvas');
    // Allow completed camera tweens and debounced persistence to expose an unwanted fit.
    await page.waitForTimeout(1000);
    expect(await savedCamera(page)).toEqual(before);
  }
});

test('selected input hydration preserves the manually positioned camera when data arrives', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const childId = 'b'.repeat(64);
  const w = newWorkspace('Pending input camera', 'mainnet');
  w.transactions[childId] = {
    ...structuredClone(transactions[TX_FUNDING]),
    txid: childId,
    vin: [{ txid: TX_FUNDING, vout: 0 }],
  };
  w.view.dimensions = 2;
  w.view.selectionId = `tx:${childId}`;
  w.view.transactionFlow = { transactionId: childId };
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
  let releaseParents = () => {};
  const released = new Promise<void>((resolve) => {
    releaseParents = resolve;
  });
  let parentRequests = 0;
  page.on('close', releaseParents);
  await page.route('**/api/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.method === 'getrawtransaction' && request.params[0] === TX_FUNDING) {
      parentRequests++;
      await released;
      await route.fulfill({ json: { result: transactions[TX_FUNDING] } }).catch(() => {});
      return;
    }
    return route.fallback();
  });
  await page.goto('/');
  await page.locator('.saved-row').filter({ hasText: w.name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  const canvas = page.locator('.graph-canvas canvas');
  await expect(canvas).toBeVisible();
  // Main scopes input loading to a selected outpoint; transaction selection is inert.
  await page
    .locator('.transaction-view')
    .getByRole('button', { name: /^Input 0:/ })
    .click();
  await expect.poll(() => parentRequests).toBeGreaterThan(0);
  await page.waitForTimeout(7000);
  await canvas.evaluate((element) =>
    element.setAttribute('data-camera-instance', 'pending-canvas'),
  );
  const initial = await savedCamera(page);
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * 0.8,
    y = bounds.y + bounds.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 55, y - 25, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => savedCamera(page)).not.toEqual(initial);
  const before = await savedCamera(page);
  // Keep the input selected while its creator arrives. Main correctly cancels
  // scoped hydration when selection changes; failed requests are covered above.
  releaseParents();
  await expect(
    page.locator('.transaction-view').getByRole('button', { name: /^Input 0:/ }),
  ).toContainText('100,000,000 sats');
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await page.waitForTimeout(7000);
  await expect(canvas).toHaveAttribute('data-camera-instance', 'pending-canvas');
  expect(await savedCamera(page)).toEqual(before);
});
