import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin } from '../fixtures/bitcoin';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import type { Workspace } from '../../src/domain/types';

const steps = [
  'Workspaces',
  'Wallets',
  'Review and addresses',
  'Filter and select',
  'Review and follow',
  'Add chain data',
  '3D graph',
  'Transaction flow',
  'Labels and notes',
  'Tags',
  'Entities and filters',
  'Bookmarks',
  'Save and share',
];

async function create(page: Page, example: boolean | 'wallet' = false) {
  await page.goto('/');
  await page
    .getByRole('button', {
      name:
        example === 'wallet'
          ? 'Create Explore a public demo wallet workspace'
          : example
            ? 'Create An on-chain message workspace'
            : 'New workspace',
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

test('an empty workspace includes wallet activity in sequence, keeps its index and can restart', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page);
  const dialog = page.getByRole('dialog', { name: 'Guided tour' });
  await expect((await contents(page)).getByRole('button')).toHaveCount(steps.length);
  const sequence = steps;
  for (let index = 0; index < sequence.length; index++) {
    const active = (await contents(page)).locator('[aria-current="step"]');
    await expect(active).toContainText(sequence[index]);
    await expect(dialog.getByRole('heading')).toBeVisible();
    const next = dialog.getByRole('button', {
      name: index === sequence.length - 1 ? 'Start exploring' : 'Next',
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
    .getByRole('button', { name: 'Inspector', exact: true })
    .click();
  await page.getByRole('button', { name: 'Hide panels', exact: true }).click();
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
    page
      .locator('.right-panel .panel-tabs')
      .getByRole('button', { name: 'Inspector', exact: true }),
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
    .getByRole('button', { name: 'Inspector', exact: true })
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
    page
      .locator('.right-panel .panel-tabs')
      .getByRole('button', { name: 'Inspector', exact: true }),
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

const walletTopics = ['Wallets', 'Review and addresses', 'Filter and select', 'Review and follow'];

async function closeContents(page: Page) {
  const toggle = page
    .getByRole('dialog', { name: 'Guided tour' })
    .getByRole('button', { name: 'Tour contents', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
}

async function savedTourWorkspace(page: Page): Promise<Workspace> {
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
  const envelope = await page.evaluate(async () => {
    const entry = JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!)[0];
    if (entry.envelope) return entry.envelope;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('chaingraph.encrypted-envelopes.v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('envelopes').objectStore('envelopes').get(entry.envelopeRef);
        read.onsuccess = () => {
          db.close();
          resolve(read.result);
        };
        read.onerror = () => {
          db.close();
          reject(read.error);
        };
      };
    });
  });
  return (await decryptWorkspace(envelope, 'public-guided-tour-password')) as Workspace;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const example of [false, 'wallet'] as const) {
    test(`wallet targets stay visible with ${example ? 'public demo' : 'empty workspace'} at ${viewport.width}px without RPC`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const calls = await mockBitcoin(page);
      await create(page, example);
      const before = await savedTourWorkspace(page);
      for (const [index, label] of walletTopics.entries()) {
        await jump(page, label);
        await closeContents(page);
        await expect(page.locator('#wallet-workspace')).toBeVisible();
        await expect(
          page
            .getByRole('navigation', { name: 'Workbench', exact: true })
            .getByRole('button', { name: 'Wallet', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        const hasPreview = !!example || index > 0;
        const selector = hasPreview
          ? ['wallet-overview', 'wallet-sections', 'wallet-filters', 'wallet-item-actions'][index]
          : 'wallet-empty';
        const target = page.locator(
          hasPreview
            ? `[data-tour="wallet-preview"] [data-tour="${selector}"]`
            : '[data-tour="wallet-empty"]',
        );
        await expect(target).toBeInViewport({ ratio: 0.99 });
        await expect
          .poll(async () => {
            const card = await page.getByRole('dialog', { name: 'Guided tour' }).boundingBox();
            const highlight = await page.locator('.tour-spotlight').boundingBox();
            if (!card || !highlight) return false;
            return (
              card.x + card.width <= highlight.x ||
              highlight.x + highlight.width <= card.x ||
              card.y + card.height <= highlight.y ||
              highlight.y + highlight.height <= card.y
            );
          })
          .toBe(true);
        if (!example && index === 0) await expect(page.locator('.tour-prerequisite')).toBeVisible();
        if (!example && index > 0) await expect(page.locator('.tour-preview-label')).toBeVisible();
        if (index === 3) {
          await expect(target.locator('.single-metadata-bar')).toContainText('Label');
          await expect(target.locator('.single-metadata-bar')).toContainText('Notes');
          await expect(target).toContainText('Mark reviewed');
          await expect(target).toContainText('Review later');
        }
        expect(calls).toEqual([]);
      }
      expect(await savedTourWorkspace(page)).toEqual(before);
      await jump(page, 'Save and share');
      await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
      await expect(page.locator('#main-workspace')).toBeVisible();
      expect(await savedTourWorkspace(page)).toEqual(before);
      expect(calls).toEqual([]);
    });
  }

  test(`public example automatically loads and unloads while preserving empty state at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const calls = await mockBitcoin(page);
    let loads = 0;
    page.on('worker', (worker) => {
      if (worker.url().includes('templateWorkspace.worker')) loads++;
    });
    await create(page);
    const before = await savedTourWorkspace(page);
    const tour = page.getByRole('dialog', { name: 'Guided tour' });
    await jump(page, 'Wallets');
    await closeContents(page);
    await expect(page.locator('[data-tour="wallet-empty"]')).toBeVisible();
    expect(loads).toBe(0);
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(tour.locator('.tour-preview-label')).toHaveText(
      'Public example · preview only (mainnet)',
    );
    for (const [index, targetId] of [
      'wallet-sections',
      'wallet-filters',
      'wallet-item-actions',
    ].entries()) {
      const target = page.locator(`[data-tour="wallet-preview"] [data-tour="${targetId}"]`);
      await expect(target).toBeInViewport({ ratio: 0.99 });
      await expect(page.locator('[data-tour="wallet-preview"]')).toHaveAttribute('inert', '');
      await expect(tour.locator('.tour-preview-label')).toBeVisible();
      expect(await tour.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      if (index === 2) await expect(target).toContainText('Mark reviewed');
      expect(loads).toBe(1);
      expect(await savedTourWorkspace(page)).toEqual(before);
      await tour.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(tour).toContainText('Start from an outpoint');
    await expect(tour.locator('.tour-preview-label')).toHaveCount(0);
    await expect(page.locator('[data-tour="wallet-preview"]')).toHaveCount(0);
    await tour.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('[data-tour="wallet-preview"]')).toBeVisible();
    expect(loads).toBe(2);
    await expect(tour.locator('.tour-preview-label')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-tour="wallet-preview"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Help and samples', exact: true })).toBeFocused();
    expect(await savedTourWorkspace(page)).toEqual(before);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!).length,
      ),
    ).toBe(1);

    // Restart and direct index jumps automatically load a new, temporary preview.
    await restart(page);
    await jump(page, 'Filter and select');
    await closeContents(page);

    await expect(
      page.locator('[data-tour="wallet-preview"] [data-tour="wallet-filters"]'),
    ).toBeInViewport({ ratio: 0.99 });
    await expect(tour.locator('.tour-preview-label')).toBeVisible();
    expect(loads).toBe(3);
    await jump(page, 'Save and share');
    await tour.getByRole('button', { name: 'Start exploring', exact: true }).click();
    await expect(page.locator('#main-workspace')).toBeVisible();
    expect(await savedTourWorkspace(page)).toEqual(before);
    expect(calls).toEqual([]);
  });

  test(`wallet tour returns filters, batch, wallet and graph handoff at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const calls = await mockBitcoin(page, { connected: false });
    await create(page, 'wallet');
    const workspace = await savedTourWorkspace(page);
    const wallet = workspace.wallets[0];
    workspace.wallets = [
      {
        ...wallet,
        id: '30000000-0000-4000-8000-000000000099',
        name: 'Empty test wallet',
        addresses: [],
      },
      wallet,
    ];
    workspace.view.selectedWallet = wallet.id;
    workspace.view.workbench = 'wallet';
    const entry = {
      id: workspace.id,
      publicName: workspace.name,
      savedAt: new Date().toISOString(),
      envelope: await encryptWorkspace(workspace, 'public-guided-tour-password'),
    };
    await page.addInitScript((entry) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify([entry]));
    }, entry);
    await page.goto('/');
    await page.locator('.saved-row').filter({ hasText: workspace.name }).click();
    const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
    await unlock.getByLabel('Password', { exact: true }).fill('public-guided-tour-password');
    await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    const live = page.locator('.wallet-workbench:not([data-tour="wallet-preview"])');
    await live.getByRole('button', { name: 'Addresses', exact: true }).click();
    await live.getByRole('checkbox').nth(0).check();
    await live.getByRole('checkbox').nth(1).check();
    await live.getByLabel('Filter wallet records').fill('bc1');
    const checked = await live.getByRole('checkbox', { checked: true }).count();
    const before = await savedTourWorkspace(page);
    const scroll = await live.evaluate((el) => el.scrollTop);
    await restart(page);
    for (const topic of walletTopics) {
      await jump(page, topic);
      await closeContents(page);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Help and samples', exact: true })).toBeFocused();
    await expect(live.getByLabel('Selected wallet')).toHaveValue(wallet.id);
    await expect(live.getByRole('button', { name: 'Addresses', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(live.getByLabel('Filter wallet records')).toHaveValue('bc1');
    await expect(live.getByRole('checkbox', { checked: true })).toHaveCount(checked);
    expect(await live.evaluate((el) => el.scrollTop)).toBe(scroll);
    expect(await savedTourWorkspace(page)).toEqual(before);
    await live.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(page.locator('#main-workspace')).toBeVisible();
    const graphBefore = await savedTourWorkspace(page);
    await restart(page);
    await jump(page, 'Review and follow');
    await closeContents(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#main-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Wallet', exact: true }).click();
    await expect(live.getByLabel('Filter wallet records')).toHaveValue('bc1');
    await expect(live.getByRole('checkbox', { checked: true })).toHaveCount(checked);
    // The handoff survives the preview, and the graph camera and filters are untouched.
    const after = await savedTourWorkspace(page);
    expect(after.view.graphSnapshot?.camera).toEqual(graphBefore.view.graphSnapshot?.camera);
    expect(after.view.filters).toEqual(graphBefore.view.filters);
    expect(after.annotations).toEqual(before.annotations);
    expect(after.findings).toEqual(before.findings);
    await live.getByLabel('Selected wallet').selectOption('30000000-0000-4000-8000-000000000099');
    await restart(page);
    await jump(page, 'Review and follow');
    await closeContents(page);
    await expect(page.locator('.tour-prerequisite')).toContainText('No review item is available');
    await expect(
      page.locator('[data-tour="wallet-preview"] [data-tour="wallet-filters"]'),
    ).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(live.getByLabel('Selected wallet')).toHaveValue(
      '30000000-0000-4000-8000-000000000099',
    );
    expect(calls).toEqual([]);
  });
}

test('automatic public example loading can fail, retry and stay separate from testnet4', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockBitcoin(page, { networks: ['testnet4'] });
  await create(page);
  const before = await savedTourWorkspace(page);
  expect(before.network).toBe('testnet4');
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  const worker = '**/templateWorkspace.worker.ts*';
  await page.context().route(worker, (route) => route.abort());
  await jump(page, 'Review and addresses');
  await closeContents(page);
  await expect(tour.getByRole('alert')).toContainText('The public example could not load');
  await expect(page.locator('.tour-spotlight')).toHaveCount(0);
  await expect(tour.getByRole('button', { name: 'Try again', exact: true })).toBeInViewport();
  await expect(tour.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await page.context().unroute(worker);
  await tour.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-tour="wallet-preview"]')).toBeVisible();
  await expect(tour.locator('.tour-preview-label')).toHaveText(
    'Public example · preview only (mainnet)',
  );
  expect(await savedTourWorkspace(page)).toEqual(before);
  await page.keyboard.press('Escape');
  expect(await savedTourWorkspace(page)).toEqual(before);
  expect(calls).toEqual([]);
});

for (const exit of ['Next', 'Escape'] as const) {
  test(`${exit} cancels automatic loading without changing the destination or reopening the tour`, async ({
    page,
  }) => {
    const calls = await mockBitcoin(page);
    await create(page);
    const before = await savedTourWorkspace(page);
    const tour = page.getByRole('dialog', { name: 'Guided tour' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested!: () => void;
    const loading = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const worker = '**/templateWorkspace.worker.ts*';
    await page.context().route(worker, async (route) => {
      requested();
      await gate;
      await route.continue().catch(() => {});
    });
    await jump(page, 'Review and follow');
    await closeContents(page);
    await loading;
    await expect(tour.getByRole('status')).toHaveText('Loading public example...');
    await expect(page.locator('.tour-spotlight')).toHaveCount(0);
    if (exit === 'Escape') await page.keyboard.press('Escape');
    else await tour.getByRole('button', { name: 'Next', exact: true }).click();
    release();
    await page.context().unroute(worker);
    if (exit === 'Escape') await expect(tour).toBeHidden();
    else {
      await expect(tour).toContainText('Start from an outpoint');
      await expect(tour.locator('.tour-preview-label')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('[data-tour="wallet-preview"]')).toHaveCount(0);
    await restart(page);
    await jump(page, 'Wallets');
    await closeContents(page);
    await expect(page.locator('[data-tour="wallet-empty"]')).toBeVisible();
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('[data-tour="wallet-preview"]')).toBeVisible();
    expect(await savedTourWorkspace(page)).toEqual(before);
    expect(calls).toEqual([]);
  });
}
