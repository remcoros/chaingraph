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

async function openMoreFilters(page: Page) {
  await page
    .locator('.entity-browser')
    .getByRole('button', { name: /^More filters/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'More filters' })).toBeVisible();
}

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
  const rows = page.locator('.entity-browser .entity-row');
  await page.getByLabel('Filter graph entities').fill('Unique pagination investigation');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Pinned output');
  await openMoreFilters(page);
  const more = page.getByRole('dialog', { name: 'More filters' });
  await more.getByLabel('Entity label state').selectOption('labeled');
  await more.getByLabel('Bookmarked only').check();
  await expect(rows).toHaveCount(1);
  await expect(more.getByLabel('Minimum entity value in sats')).toHaveAttribute('type', 'number');
  await expect(more.getByLabel('Maximum entity value in sats')).toHaveAttribute('type', 'number');
  await more.getByLabel('Minimum entity value in sats').fill('1.5');
  await expect(more.locator('.filter-field-error')).toContainText('whole satoshi amounts');
  await expect(rows).toHaveCount(0);
  await more.getByLabel('Minimum entity value in sats').fill('1001001');
  await more.getByLabel('Maximum entity value in sats').fill('1001000');
  await expect(more.locator('.filter-field-error')).toContainText('Minimum value');
  await more.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.locator('.entity-filter-error')).toHaveCount(0);
  await expect(page.locator('.entity-result-count')).toContainText(
    `${total.toLocaleString()} matches`,
  );
  await expect(more.getByLabel('Minimum entity value in sats')).toHaveValue('');
  await more.getByLabel('Output spend evidence').selectOption('unknown');
  await expect(more).toContainText('unknown, not unspent');
  await more.getByLabel('Output funding data').selectOption('missing');
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();
  await expect(rows).toHaveCount(0);
  await expect(page.locator('.entity-list')).toContainText('No matching entities');
});

test('shows nonmatching canvas context explicitly and clears it with the shared filters', async ({
  page,
}) => {
  const { total } = await openEntities(page);
  await page.getByLabel('Filter graph entities').fill('Unique pagination investigation');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await expect(page.getByLabel('Active graph filters', { exact: true })).toContainText(
    'Search: Unique pagination',
  );
  await openMoreFilters(page);
  const more = page.getByRole('dialog', { name: 'More filters' });
  await expect(more.getByLabel('Include neighboring nodes')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const results = page.locator('.entity-result-count');
  await results.getByRole('button', { name: 'Show connections (+2)', exact: true }).click();
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-context-note')).toContainText('2 connected context entities');
  await expect(page.getByLabel('Active graph filters', { exact: true })).toContainText(
    'Neighboring nodes included',
  );
  await expect(page.getByLabel('Active graph filters', { exact: true })).toContainText(
    'Search: Unique pagination',
  );
  await results.getByRole('button', { name: 'Hide connections', exact: true }).click();
  await expect(page.locator('.entity-context-note')).toHaveCount(0);
  await expect(
    results.getByRole('button', { name: 'Show connections (+2)', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear entity and graph filters' }).click();
  await expect(results.getByRole('button', { name: /^Show connections/ })).toHaveCount(0);
  await expect(page.locator('.entity-context-note')).toHaveCount(0);
  await expect(page.locator('.filter-chip')).toHaveCount(0);
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
  const moreFilters = page
    .locator('.entity-browser')
    .getByRole('button', { name: /^More filters/ });
  await moreFilters.focus();
  await page.keyboard.press('Enter');
  const more = page.getByRole('dialog', { name: 'More filters' });
  await expect(more).toBeVisible();
  await more.getByLabel('Bookmarked only').focus();
  await page.keyboard.press('Space');
  await expect(more.getByLabel('Bookmarked only')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();
  await expect(moreFilters).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['Previous entity page', 'Next entity page']) {
    const bounds = await page.getByRole('button', { name }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThan(844);
  }
  await page.locator('.entity-browser .entity-row').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Pinned output');
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.locator('.entity-pagination')).toBeVisible();
  await expect(page.locator('.entity-browser .entity-row')).toHaveAttribute('aria-pressed', 'true');
});
