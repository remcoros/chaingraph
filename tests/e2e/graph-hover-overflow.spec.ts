import { expect, test, type Page } from '@playwright/test';
import { short, outputNodeId, txNodeId } from '../../src/domain/types';

const txid = '1234567' + 'a'.repeat(50) + 'abcdef0';
const id = txNodeId(txid);
const cardFor = (page: Page) => page.getByRole('dialog', { name: 'Graph item details' });
async function openAt(page: Page, x: number, y: number, nodeId = id) {
  await page.evaluate(({ x, y, nodeId }) => window.hoverFixture.hover('node', x, y, nodeId), {
    x,
    y,
    nodeId,
  });
  await expect(cardFor(page)).toBeVisible();
}
async function checkLayout(page: Page) {
  const card = cardFor(page);
  await expect
    .poll(() => card.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBe(0);
  const bounds = (await card.boundingBox())!;
  const viewport = (await page.locator('.graph-viewport').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(viewport.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.x + viewport.width);
  expect(bounds.y).toBeGreaterThanOrEqual(viewport.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.y + viewport.height);
  // Hit testing catches controls outside the card or behind a clipping ancestor.
  expect(
    await card.locator('.graph-card-heading button').evaluateAll((buttons) =>
      buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ),
  ).toBe(true);
}

test('transaction cards contain long references, annotations and every action at both graph edges', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/graph-hover-card.html');
  await expect(page.locator('canvas')).toBeVisible();
  const card = cardFor(page);
  for (const width of [1440, 390, 240, 200]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scenario of ['unlabeled', 'raw', 'long', 'hex-label']) {
      await page.getByLabel('Scenario').selectOption(scenario);
      for (const [x, y] of [
        [5, 5],
        [width - 5, 610],
      ]) {
        await openAt(page, x, y);
        await checkLayout(page);
        const label = card.locator('.graph-card-label');
        if (scenario === 'long') {
          await expect(label).toHaveText('★ Personal annotation ' + 'LongUnbrokenLabel'.repeat(11));
          await expect(card.locator('.entity-badges')).toContainText('UnbrokenTag'.repeat(7));
        } else {
          await expect(label).toHaveText(scenario === 'hex-label' ? txid : short(txid));
        }
        await expect(label).toHaveAttribute('title', new RegExp(txid));
        await expect(card.locator('.graph-card-identifier').first()).toHaveText(short(txid));
        await expect(card.locator('.graph-card-identifier').first()).toHaveAttribute('title', txid);
        if (x === 5 && [1440, 390].includes(width) && ['unlabeled', 'long'].includes(scenario)) {
          await page.screenshot({ path: test.info().outputPath(`${width}-${scenario}.png`) });
        }
        await card.getByRole('button', { name: 'Close graph details' }).click();
        await expect(card).toBeHidden();
        await expect(page.locator('canvas')).toBeFocused();
      }
    }
  }
  expect(await page.evaluate(() => window.hoverFixture.canonical())).toBe(txid);
  expect(errors).toEqual([]);
});

test('card resize, pointer handoff, keyboard, visibility and canonical action callbacks remain usable', async ({
  page,
}) => {
  await page.goto('/tests/fixtures/graph-hover-card.html');
  await expect(page.locator('canvas')).toBeVisible();
  const card = cardFor(page);
  await page.evaluate(() => window.hoverFixture.hover('link', 100, 100));
  await page.waitForTimeout(400);
  await expect(card).toBeHidden();
  await openAt(page, 1400, 610);
  await page.setViewportSize({ width: 240, height: 900 });
  await checkLayout(page);
  await card.getByRole('button', { name: 'Edit label and notes' }).hover();
  await page.evaluate(() => window.hoverFixture.clear());
  await page.waitForTimeout(500);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Add to batch selection' }).click();
  await expect(page.getByTestId('action')).toHaveText(`batch:${id}`);
  await card.getByRole('button', { name: 'Input and output visibility' }).click();
  const visibility = page.getByRole('dialog', { name: 'Transaction visibility' });
  await expect(visibility).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(visibility).toBeHidden();
  await expect(card.getByRole('button', { name: 'Input and output visibility' })).toBeFocused();
  await card.getByRole('button', { name: 'Load previous level' }).click();
  await expect(page.getByTestId('action')).toHaveText(`trace:${id}`);
  await expect(card).toBeHidden();
  await page.locator('canvas').focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('canvas')).toBeFocused();
  await page.keyboard.press('Enter');
  await card.getByRole('button', { name: 'Edit label and notes' }).click();
  await expect(page.getByTestId('action')).toHaveText(`edit:${id}`);
  await expect(page.getByLabel('Notes editor')).toBeFocused();
  await openAt(page, 10, 10);
  await card.getByRole('button', { name: 'Select graph item', exact: true }).click();
  await expect(page.getByTestId('action')).toHaveText(`select:${id}`);
  const outputId = outputNodeId(txid, 4294967295);
  await openAt(page, 10, 10, outputId);
  await checkLayout(page);
  await expect(card.locator('.graph-card-label')).toHaveText(short(outputId));
  await expect(card.locator('.graph-card-identifier').first()).toHaveText(short(outputId));
  await expect(card.locator('.graph-card-identifier').first()).toHaveAttribute(
    'title',
    `${txid}:4294967295`,
  );
  await card.getByRole('button', { name: 'Open creating transaction' }).click();
  await expect(page.getByTestId('action')).toHaveText(`trace:${outputId}`);
  await page.getByRole('button', { name: 'Fit fixture graph' }).click();
  await expect(page.locator('canvas')).toBeVisible();
});
