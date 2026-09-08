import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin } from '../fixtures/bitcoin';

const steps = [
  'Workspaces',
  'Wallets',
  'Add chain data',
  '3D graph',
  'Transaction flow',
  'Labels and notes',
  'Tags',
  'Entities and filters',
  'Bookmarks',
  'Save and share',
];

async function create(page: Page, example = false) {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: example ? 'Create An on-chain message workspace' : 'New workspace',
      exact: true,
    })
    .last()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill('public-guided-tour-password');
  await dialog.getByLabel('Confirm password').fill('public-guided-tour-password');
  await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Guided tour' })).toBeVisible();
}

async function contents(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  const toggle = dialog.getByRole('button', { name: 'Tour contents', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const navigation = dialog.getByRole('navigation', { name: 'Tour steps' });
  await expect(navigation).toBeVisible();
  return navigation;
}

async function jump(page: Page, label: string) {
  const navigation = await contents(page);
  await navigation.getByRole('button', { name: new RegExp(label) }).click();
  const current = (await contents(page)).locator('[aria-current="step"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText(label);
}

async function restart(page: Page) {
  await page.getByRole('button', { name: 'Help and samples', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show guided tour', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Guided tour' })).toBeVisible();
}

test('a first empty workspace tours all showcases without fetching data and can restart', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page);
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  await expect((await contents(page)).getByRole('button')).toHaveCount(steps.length);
  for (let index = 0; index < steps.length; index++) {
    const active = (await contents(page)).locator('[aria-current="step"]');
    await expect(active).toContainText(steps[index]);
    await expect(dialog.getByRole('heading')).toBeVisible();
    const next = dialog.getByRole('button', {
      name: index === steps.length - 1 ? 'Start exploring' : 'Next',
      exact: true,
    });
    await expect(next).toBeInViewport();
    await next.click();
  }
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.tour-spotlight')).toHaveCount(0);
  expect(calls).toEqual([]);
  await restart(page);
  await expect((await contents(page)).locator('[aria-current="step"]')).toContainText('Workspaces');
  await dialog.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Help and samples', exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('chaingraph.tour.seen'))).toBe('1');
  expect(errors).toEqual([]);
});

test('contents jumps and Back follow the selected topic, with keyboard focus contained', async ({
  page,
}) => {
  await mockBitcoin(page);
  await create(page);
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  await jump(page, 'Tags');
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect((await contents(page)).locator('[aria-current="step"]')).toContainText(
    'Labels and notes',
  );
  await jump(page, 'Save and share');
  await expect(dialog.getByRole('button', { name: 'Start exploring', exact: true })).toBeVisible();
  await jump(page, 'Wallets');
  await dialog.getByRole('button', { name: 'Tour contents', exact: true }).click();
  await expect(dialog.getByRole('navigation', { name: 'Tour steps' })).toBeHidden();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press(index % 3 === 0 ? 'Shift+Tab' : 'Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.tour-spotlight')).toHaveCount(0);
});

test('tour previews panels but restores focused graph, prior tabs and selected annotations', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await create(page, true);
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  await dialog.getByRole('button', { name: 'Skip tour', exact: true }).click();
  const originalLabel = await page.getByLabel('Node label', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page
    .locator('.right-panel .panel-tabs')
    .getByRole('button', { name: /^Analysis/ })
    .click();
  await page.getByRole('button', { name: 'Focus graph', exact: true }).click();
  await expect(page.locator('.left-panel')).toBeHidden();
  await restart(page);
  await jump(page, 'Tags');
  await expect(page.locator('.left-panel')).toBeVisible();
  await expect(
    page.locator('.left-panel .panel-tabs').getByRole('button', { name: 'Tags', exact: true }),
  ).toHaveClass(/active/);
  await jump(page, 'Labels and notes');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue(originalLabel);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.left-panel')).toBeHidden();
  await expect(page.locator('.right-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Help and samples', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Show panels', exact: true }).click();
  await expect(
    page.locator('.left-panel .panel-tabs').getByRole('button', { name: 'Entities', exact: true }),
  ).toHaveClass(/active/);
  await expect(
    page.locator('.right-panel .panel-tabs').getByRole('button', { name: /^Analysis/ }),
  ).toHaveClass(/active/);
  await page
    .locator('.right-panel .panel-tabs')
    .getByRole('button', { name: 'Inspector', exact: true })
    .click();
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue(originalLabel);
  expect(calls).toEqual([]);
});

test('mobile contents reaches every topic and closes back to the original Browse view', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, true);
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  await dialog.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await page.locator('.mobile-switch').getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await restart(page);
  for (const label of [...steps].reverse()) {
    await jump(page, label);
    await expect(dialog.getByRole('button', { name: 'Skip tour', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await jump(page, '3D graph');
  await expect(page.locator('.graph-stage')).toBeVisible();
  await jump(page, 'Labels and notes');
  await expect(page.locator('.right-panel')).toBeVisible();
  await expect(page.getByLabel('Node label', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.left-panel')).toBeVisible();
  await expect(page.locator('.graph-stage')).toBeHidden();
  await expect(
    page.locator('.left-panel .panel-tabs').getByRole('button', { name: 'Entities', exact: true }),
  ).toHaveClass(/active/);
  await expect(page.locator('.tour-spotlight')).toHaveCount(0);
  expect(calls).toEqual([]);
});

test('mobile annotation showcase reveals its editor without covering it and restores scroll', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, true);
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  await dialog.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await page
    .locator('.mobile-switch')
    .getByRole('button', { name: 'Inspector', exact: true })
    .click();
  const inspector = page.locator('.inspector-scroll');
  await inspector.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
  const originalScroll = await inspector.evaluate((element) => element.scrollTop);
  await restart(page);
  await (await contents(page)).getByRole('button', { name: /Labels and notes/ }).click();
  await expect(dialog.getByRole('button', { name: 'Tour contents', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const editor = page.locator('[data-tour="annotation-editor"]');
  await expect(editor).toBeInViewport({ ratio: 0.99 });
  await expect(page.locator('.tour-spotlight')).toBeVisible();
  await expect
    .poll(async () => {
      const card = await dialog.boundingBox();
      const highlight = await page.locator('.tour-spotlight').boundingBox();
      const annotation = await editor.boundingBox();
      if (!card || !highlight || !annotation) return false;
      return [highlight, annotation].every(
        (area) => card.y + card.height <= area.y || area.y + area.height <= card.y,
      );
    })
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('mobile-tour-annotations-visible.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop)).toBe(originalScroll);
});

test('a flow showcase leaves collapsed flow and prior tabs unchanged after encrypted save and unlock', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await create(page, true);
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  await dialog.getByRole('button', { name: 'Skip tour', exact: true }).click();
  const flow = page.locator('.transaction-view');
  await flow.locator(':scope > summary').getByText('Transaction flow', { exact: true }).click();
  await expect(flow).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page
    .locator('.right-panel .panel-tabs')
    .getByRole('button', { name: /^Analysis/ })
    .click();
  await restart(page);
  await (await contents(page)).getByRole('button', { name: /Transaction flow/ }).click();
  await expect(flow).toHaveAttribute('open');
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  await page.keyboard.press('Escape');
  await expect(flow).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.locator('.saved-row').filter({ hasText: 'An on-chain message' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill('public-guided-tour-password');
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(unlock).not.toBeVisible();
  await expect(flow).toBeVisible();
  await expect(flow).not.toHaveAttribute('open');
  await expect(
    page.locator('.left-panel .panel-tabs').getByRole('button', { name: 'Entities', exact: true }),
  ).toHaveClass(/active/);
  await expect(
    page.locator('.right-panel .panel-tabs').getByRole('button', { name: /^Analysis/ }),
  ).toHaveClass(/active/);
  expect(calls).toEqual([]);
});

test('short landscape view reveals the active topic and resets scrolled explanations', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.setViewportSize({ width: 740, height: 420 });
  await create(page, true);
  await jump(page, 'Labels and notes');
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await expect(tour.locator('[aria-current="step"]')).toBeInViewport({ ratio: 0.99 });
  await expect(tour.getByRole('button', { name: 'Next', exact: true })).toBeInViewport();
  await tour.locator('.tour-copy').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await jump(page, '3D graph');
  await expect
    .poll(() => tour.locator('.tour-copy').evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect(tour.getByRole('button', { name: 'Skip tour', exact: true })).toBeInViewport();
});
