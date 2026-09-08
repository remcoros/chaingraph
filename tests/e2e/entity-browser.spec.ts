import { expect, test, type Page } from '@playwright/test';
import { openFixtureWorkspace } from '../fixtures/open-workspace';
import { laboratoryWorkspace } from '../fixtures/laboratory';
import { buildGraph } from '../../src/domain/workspace';
import { mockBitcoin } from '../fixtures/bitcoin';

const password = 'entity-browser-fixture-passphrase';
const targetId = `out:${(2000).toString(16).padStart(64, '0')}:0`;
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => expect(browserErrors.get(page) ?? []).toEqual([]));

async function openEntities(page: Page) {
  const workspace = laboratoryWorkspace();
  workspace.name = 'Entity browser fixture';
  workspace.annotations[targetId] = {
    label: 'Pinned output',
    note: 'Unique pagination investigation note',
    icon: '',
    bookmarked: true,
  };
  const total = buildGraph(workspace).nodes.length;
  await mockBitcoin(page);
  await openFixtureWorkspace(page, workspace, password);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.locator('.entity-result-count')).toContainText(
    `${total.toLocaleString()} matches`,
  );
  return { total, transactionCount: Object.keys(workspace.transactions).length };
}

test('browses all records beyond 200, sorts and selects across pages', async ({ page }) => {
  const { transactionCount } = await openEntities(page);
  await page.getByLabel('Entity type', { exact: true }).selectOption('transaction');
  await page.getByLabel('Entity sort order').selectOption('label');
  await page.getByLabel('Entities per page').selectOption('100');
  const rows = page.locator('.entity-browser .entity-row');
  await expect(rows).toHaveCount(100);
  const first = await rows.first().getAttribute('title');
  await page.getByRole('button', { name: 'Next entity page' }).click();
  await page.getByRole('button', { name: 'Next entity page' }).click();
  await expect(page.locator('.entity-pagination')).toContainText(`201–300 of ${transactionCount}`);
  expect(await rows.first().getAttribute('title')).not.toBe(first);
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Node label', { exact: true })).toBeVisible();
  while (await page.getByRole('button', { name: 'Next entity page' }).isEnabled()) {
    await page.getByRole('button', { name: 'Next entity page' }).click();
  }
  await expect(rows).toHaveCount(transactionCount % 100 || 100);
  await expect(page.locator('.entity-pagination')).toContainText(
    `${transactionCount} of ${transactionCount}`,
  );
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 2');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.entity-pagination')).toContainText('Page 1 / 1');
});

test('combines note, label and bookmark filters and reports invalid amount bounds without silently dropping them', async ({
  page,
}) => {
  const { total } = await openEntities(page);
  await page.getByLabel('Filter graph entities').fill('Unique pagination investigation');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-browser .entity-row')).toContainText('Pinned output');
  await page.locator('.entity-advanced summary').click();
  await page.getByLabel('Entity label state').selectOption('labeled');
  await page.getByLabel('Bookmarked only').check();
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await page.getByLabel('Minimum entity value in sats').fill('not a number');
  await expect(page.locator('.entity-filter-error')).toContainText('whole satoshi amounts');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(0);
  await page.getByLabel('Minimum entity value in sats').fill('1001001');
  await page.getByLabel('Maximum entity value in sats').fill('1001000');
  await expect(page.locator('.entity-filter-error')).toContainText('Minimum value');
  await page.getByRole('button', { name: 'Clear entity and graph filters' }).click();
  await expect(page.locator('.entity-filter-error')).toHaveCount(0);
  await expect(page.locator('.entity-result-count')).toContainText(
    `${total.toLocaleString()} matches`,
  );
  await expect(page.getByLabel('Minimum entity value in sats')).toHaveValue('');
  await page.getByLabel('Output spend evidence').selectOption('unknown');
  await expect(page.locator('.entity-advanced-fields')).toContainText('unknown, not unspent');
  await expect(page.locator('.entity-browser .entity-row').first()).toContainText('output');
  await page.getByLabel('Output funding data').selectOption('missing');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(0);
  await expect(page.locator('.entity-list')).toContainText('No matching entities');
});

test('shows nonmatching canvas context explicitly and clears it with the shared filters', async ({
  page,
}) => {
  const { total } = await openEntities(page);
  await page.getByLabel('Filter graph entities').fill('Unique pagination investigation');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await expect(page.locator('.view-summary')).toBeHidden();
  await page.locator('.entity-advanced summary').click();
  await page.getByLabel('Show connected context on canvas').check();
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-context-note')).toContainText('2 connected context entities');
  await expect(page.locator('.view-summary')).toBeHidden();
  await page.getByRole('button', { name: 'Clear entity and graph filters' }).click();
  await expect(page.getByLabel('Show connected context on canvas')).not.toBeChecked();
  await expect(page.locator('.entity-context-note')).toHaveCount(0);
  await expect(page.locator('.entity-result-count')).toContainText(
    `${total.toLocaleString()} matches`,
  );
});

test('keeps entity filters, pagination and selection usable on a narrow screen with keyboard input', async ({
  page,
}) => {
  await openEntities(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  const filters = page.getByLabel('Filter graph entities');
  await filters.focus();
  await expect(filters).toBeFocused();
  await page.keyboard.type('Unique pagination investigation');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  const summary = page.locator('.entity-advanced summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.entity-advanced')).toHaveAttribute('open', '');
  await page.getByLabel('Bookmarked only').focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Bookmarked only')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['Previous entity page', 'Next entity page']) {
    const bounds = await page.getByRole('button', { name }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThan(844);
  }
  await page.screenshot({ path: '/tmp/chaingraph-entity-browser-mobile.png', fullPage: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.locator('.entity-browser .entity-row').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Pinned output');
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.locator('.entity-pagination')).toBeVisible();
  await expect(page.locator('.entity-browser .entity-row')).toHaveAttribute('aria-pressed', 'true');
});
