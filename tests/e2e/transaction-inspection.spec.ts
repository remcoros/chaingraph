import { openLaboratoryFixture } from '../fixtures/open-workspace';
import { test, expect, type Page } from '@playwright/test';
import { Transaction as BitcoinTransaction } from 'bitcoinjs-lib';
import { mockBitcoin, TX_SPENDING, TX_FUNDING } from '../fixtures/bitcoin';

async function create(page: Page, fixture = false) {
  if (fixture) {
    await openLaboratoryFixture(page, 'Transaction inspection QA', 'transaction-inspection-test');
    return;
  }
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'New workspace',
      exact: true,
    })
    .last()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Transaction inspection QA');
  await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill('transaction-inspection-test');
  await dialog.getByLabel('Confirm password').fill('transaction-inspection-test');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
}
async function add(page: Page, txid: string) {
  await page.getByLabel('Transaction, output, or address').fill(txid);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
}

test('transaction rows retain spending context while automatically loading prevouts, labeling and inspecting scripts', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await create(page);
  await expect(page.getByLabel('Prefetch previous levels')).toHaveValue('0');
  await add(page, TX_SPENDING);
  const view = page.locator('.transaction-view');
  await expect(view).toBeVisible();
  await view.getByRole('button', { name: /^Input 0:/ }).click();
  await expect(view.locator('.transaction-view-identity')).toContainText('Spending transaction');
  await expect(view.locator('.transaction-row[data-selected="true"]')).toHaveCount(1);
  await expect(view.getByRole('button', { name: /^Input 0:/ })).toContainText('1.00 000 000 BTC');
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toBeVisible();
  await view
    .getByRole('button', { name: `Go to previous transaction ${TX_FUNDING}`, exact: true })
    .click();
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(TX_FUNDING);
  await view
    .getByRole('button', { name: `Go to spending transaction ${TX_SPENDING}`, exact: true })
    .click();
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(TX_SPENDING);
  await expect(view.getByRole('button', { name: /^Input 0:/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await view
    .getByRole('button', { name: `Go to previous transaction ${TX_FUNDING}`, exact: true })
    .click();
  await expect(view.locator('.transaction-row[data-selected="true"]')).toContainText(
    '1.00 000 000 BTC',
  );
  await view.getByRole('button', { name: 'Edit output 0 annotation', exact: true }).click();
  await page.getByLabel('Node label').fill('Exchange withdrawal');
  await expect(view.locator('.transaction-row[data-selected="true"]')).toContainText(
    'Exchange withdrawal',
  );
  await page.locator('.script-inspector > summary').click();
  await expect(page.locator('.script-inspector')).toContainText('OP_0');
  await page.screenshot({ path: 'test-results/transaction-inspection-desktop.png' });
  await view.locator(':scope > summary').getByText('Transaction flow', { exact: true }).click();
  await expect(view.locator('.transaction-columns')).not.toBeVisible();
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  // Lock completes only after the current encrypted revision reaches storage.
  await expect(page.locator('.saved-row')).toBeVisible();
  await page.reload();
  await page.locator('.saved-row').click();
  await page
    .getByRole('dialog')
    .getByLabel('Password', { exact: true })
    .fill('transaction-inspection-test');
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(view).toBeVisible();
  await expect(view).not.toHaveAttribute('open');
  await view.locator(':scope > summary').getByText('Transaction flow', { exact: true }).click();
  await expect(view.getByLabel('Displayed transaction', { exact: true })).toHaveValue(TX_FUNDING);
  await expect(view.locator('.transaction-row[data-selected="true"]')).toContainText(
    'Exchange withdrawal',
  );
});

test('large transaction lists collapse and remain usable on a phone', async ({ page }) => {
  const calls = await mockBitcoin(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, true);
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-row')).toContainText('Synthetic CoinJoin 1');
  await page.locator('.entity-row').click();
  await page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }).click();
  const view = page.locator('.transaction-view');
  await expect(view.locator('.transaction-row')).toHaveCount(6);
  await view.getByRole('button', { name: 'Show all 150 outputs', exact: true }).click();
  await expect(view.getByRole('button', { name: /^Output 149:/ })).toBeAttached();
  await view.getByRole('button', { name: /^Output 149:/ }).click();
  await view.getByRole('button', { name: 'Collapse outputs', exact: true }).click();
  await expect(view.locator('.transaction-row[data-selected="true"]')).toBeAttached();
  await expect(view.getByRole('button', { name: /^Output 149:/ })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'test-results/transaction-inspection-mobile.png' });
  await view.getByRole('button', { name: 'Show all 150 outputs', exact: true }).click();
  await expect(view.getByRole('button', { name: /^Output 149:/ })).toBeInViewport({ ratio: 1 });
  await view.hover();
  await page.mouse.wheel(0, -20000);
  await expect.poll(() => view.evaluate((element) => element.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await view.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Inspector', exact: true }).first().click();
  await page.locator('.script-inspector > summary').click();
  await expect(
    page.getByRole('button', { name: 'Load raw transaction', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  // Lock completes only after the current encrypted revision reaches storage.
  await expect(page.locator('.saved-row')).toBeVisible();
  await page.reload();
  await page.locator('.saved-row').click();
  await page
    .getByRole('dialog')
    .getByLabel('Password', { exact: true })
    .fill('transaction-inspection-test');
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(view.getByRole('button', { name: 'Collapse outputs', exact: true })).toBeAttached();
  await expect(view.getByRole('button', { name: /^Output 149:/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(view.getByRole('button', { name: /^Output 149:/ })).toBeInViewport({ ratio: 1 });
  expect(calls).toHaveLength(0);
});

test('raw inspection is explicit, verified, and displays witness bytes without persisting them', async ({
  page,
}) => {
  await mockBitcoin(page);
  const raw = new BitcoinTransaction();
  raw.addInput(
    Uint8Array.from({ length: 32 }, () => 0x11),
    3,
    0xfffffffd,
    Uint8Array.of(0x51),
  );
  raw.addOutput(Uint8Array.of(0x51), 12345n);
  raw.setWitness(0, [
    Uint8Array.of(0xaa, 0xbb, 0xcc),
    ...Array.from({ length: 20 }, () => new Uint8Array()),
  ]);
  const txid = raw.getId();
  let rawRequests = 0;
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.params[0] !== txid) return route.fallback();
    if (call.params[1] === false) {
      rawRequests++;
      return route.fulfill({ json: { result: raw.toHex() } });
    }
    return route.fulfill({
      json: {
        result: {
          txid,
          vin: [{ txid: '11'.repeat(32), vout: 3 }],
          vout: [{ n: 0, value: 0.00012345, scriptPubKey: { hex: '51' } }],
        },
      },
    });
  });
  await create(page);
  await add(page, txid);
  await page.locator('.script-inspector > summary').click();
  expect(rawRequests).toBe(0);
  await page.getByRole('button', { name: 'Load raw transaction', exact: true }).click();
  await expect(page.locator('.script-inspector')).toContainText('Sequence: 4294967293');
  await page.getByText('Witness stack (21 items)', { exact: true }).click();
  await expect(page.locator('.witness-items')).toContainText('aabbcc');
  await expect(page.locator('.witness-items .script-field')).toHaveCount(20);
  await page.getByRole('button', { name: 'Show next witness items (20 of 21 shown)' }).click();
  await expect(page.locator('.witness-items .script-field')).toHaveCount(21);
  expect(rawRequests).toBe(1);
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  expect(persisted).not.toContain(raw.toHex());
  await page
    .locator('.transaction-view')
    .getByRole('button', { name: /^Output 0:/ })
    .click();
  await page.locator('.script-inspector > summary').click();
  await expect(
    page.getByRole('button', { name: 'Load raw transaction', exact: true }),
  ).toBeVisible();
});

test('keeps selected rows visible through tag wrapping and resize, and shows transaction labels', async ({
  page,
}) => {
  const { newWorkspace } = await import('../../src/domain/workspace');
  const { encryptWorkspace } = await import('../../src/lib/crypto');
  const { transactions } = await import('../fixtures/bitcoin');
  const workspace = newWorkspace('Public transaction geometry fixture', 'mainnet');
  workspace.transactions = transactions;
  workspace.annotations[`tx:${TX_FUNDING}`] = {
    label: 'Known funding transaction',
    note: '',
    icon: '',
    bookmarked: false,
  };
  workspace.tags = [
    {
      id: crypto.randomUUID(),
      name: 'Funding source',
      color: '#68d4b7',
      nodeIds: [`tx:${TX_FUNDING}`],
    },
  ];
  const password = 'public-transaction-geometry';
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([
          {
            id,
            publicName: 'Public transaction geometry fixture',
            savedAt: new Date().toISOString(),
            envelope,
          },
        ]),
      );
    },
    { id: workspace.id, envelope },
  );
  await mockBitcoin(page, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('output');
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await page.locator('.entity-row').nth(1).click();
  const panel = page.locator('.transaction-view');
  await expect(panel.locator('.transaction-view-identity')).toContainText(
    'Known funding transaction',
  );
  await expect(panel.locator('.transaction-view-identity .entity-badges')).toContainText(
    'Funding source',
  );
  await expect(
    panel.getByLabel('Displayed transaction', { exact: true }).locator('option:checked'),
  ).toContainText('Known funding transaction');
  const geometry = () =>
    panel.evaluate((element) => {
      const row = element.querySelector('.transaction-row.is-selected')!.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const heading = element.querySelector('summary')!.getBoundingClientRect();
      return {
        scroll: element.scrollTop,
        clipped:
          Math.max(0, row.bottom - bounds.bottom + 8) + Math.max(0, heading.bottom + 4 - row.top),
      };
    });
  await expect.poll(async () => (await geometry()).clipped).toBeLessThan(1);
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  await page.getByLabel('Tag name', { exact: true }).fill('A long public example exchange tag');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(panel.locator('.transaction-row.is-selected')).toContainText(
    'A long public example exchange tag',
  );
  await expect.poll(async () => (await geometry()).clipped).toBeLessThan(1);
  // A taller desktop panel can fit the tagged row without scrolling. The
  // invariant is visibility; the phone resize below also exercises real overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }).click();
  await expect.poll(async () => (await geometry()).clipped).toBeLessThan(1);
  await expect(
    page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }),
  ).toBeFocused();
  const badge = panel.locator('.transaction-row.is-selected .entity-badges > span');
  const badgeGeometry = await badge.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflow: element.scrollWidth - element.clientWidth,
  }));
  expect(badgeGeometry.height).toBeGreaterThan(35);
  expect(badgeGeometry.overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('selected-tag-after-resize.png') });
  await page.setViewportSize({ width: 420, height: 800 });
  await expect.poll(async () => (await geometry()).clipped).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
