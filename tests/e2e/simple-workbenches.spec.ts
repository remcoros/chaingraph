import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { analysisTools } from '../../src/domain/analysis';
import type { Workspace } from '../../src/domain/types';
import { newWorkspace, parseWorkspace } from '../../src/domain/workspace';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import {
  mockBitcoin,
  transactions,
  TX_SPENDING,
  CHANGE_ADDRESS,
  TX_FUNDING,
} from '../fixtures/bitcoin';

const password = 'public-simple-workbench-fixture';
const originOutput = `out:${TX_FUNDING}:0`;
const siblingOutput = `out:${TX_FUNDING}:1`;
const workbench = (page: Page, name: 'Graph' | 'Analysis' | 'Trace') =>
  page
    .getByRole('navigation', { name: 'Workbench', exact: true })
    .getByRole('button', { name, exact: true });

async function unlock(page: Page, name: string) {
  await page.locator('.saved-row').filter({ hasText: name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(workbench(page, 'Graph')).toBeVisible();
}

async function seed(page: Page, customize?: (workspace: Workspace) => void) {
  const workspace = newWorkspace('Simple public investigation', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.view = {
    ...workspace.view,
    dimensions: 2,
    selectionId: originOutput,
    leftTab: 'entities',
    rightTab: 'inspect',
    transactionFlow: { open: false, transactionId: TX_FUNDING },
  };
  customize?.(workspace);
  parseWorkspace(workspace);
  const entry = {
    id: workspace.id,
    publicName: workspace.name,
    savedAt: new Date().toISOString(),
    envelope: await encryptWorkspace(workspace, password),
  };
  await page.addInitScript((entry) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    if (!localStorage.getItem('chaingraph.encrypted-workspaces.v1'))
      localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify([entry]));
  }, entry);
  const calls = await mockBitcoin(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await unlock(page, workspace.name);
  return { workspace, calls };
}

async function saved(page: Page): Promise<Workspace> {
  const envelope = await page.evaluate(
    () => JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!)[0].envelope,
  );
  return (await decryptWorkspace(envelope, password)) as Workspace;
}

async function screenshot(page: Page, name: string) {
  await mkdir('artifacts/simple-workbenches', { recursive: true });
  await page.screenshot({ path: `artifacts/simple-workbenches/${name}.png`, fullPage: true });
}

// One click must account for every registered tool, even tools without enough context.
test('selected output scans every applicable tool, explains coverage and returns to an unfiltered graph', async ({
  page,
}) => {
  const { calls } = await seed(page, (workspace) => {
    workspace.view.hiddenNodeIds = [siblingOutput];
  });
  await workbench(page, 'Analysis').click();
  const analysis = page.locator('.analysis-workbench');
  await expect(analysis).toContainText(/output/i);
  await expect(analysis).toContainText(/loaded data/i);
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  for (const tool of analysisTools) await expect(analysis).toContainText(tool.name);
  await expect(analysis).toContainText(/wallet/i);
  await expect(analysis).toContainText(/skip|unavailable/i);
  expect(calls).toHaveLength(0);
  await screenshot(page, 'analysis-desktop');
  await analysis.getByRole('button', { name: 'Show on graph', exact: true }).click();
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await expect.poll(async () => (await saved(page)).view.filters?.includeIds).toBeUndefined();
  expect((await saved(page)).view.hiddenNodeIds).toEqual([siblingOutput]);
  await workbench(page, 'Analysis').click();
  await expect(analysis.getByRole('button', { name: 'Show on graph', exact: true })).toBeVisible();
  await analysis.getByRole('button', { name: /isolate/i }).click();
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
  await screenshot(page, 'graph-isolated-desktop');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect.poll(async () => (await saved(page)).view.filters?.includeIds).toBeUndefined();
  expect((await saved(page)).view.hiddenNodeIds).toEqual([siblingOutput]);
  await workbench(page, 'Analysis').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(analysis.getByRole('button', { name: 'Scan', exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'analysis-mobile');
});

test('restored include and focus filters have an effective reset independent of manual hiding', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    workspace.view.hiddenNodeIds = [siblingOutput];
    workspace.view.filters = {
      includeIds: [originOutput],
      focus: { id: originOutput, hops: 1 },
      minSats: 1,
    };
  });
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect
    .poll(async () => {
      const filters = (await saved(page)).view.filters;
      return Boolean(filters?.includeIds || filters?.focus || filters?.minSats);
    })
    .toBe(false);
  expect((await saved(page)).view.hiddenNodeIds).toEqual([siblingOutput]);
});

test('plain workbench switches preserve the existing canvas, manual camera and selection', async ({
  page,
}) => {
  await seed(page);
  const canvas = page.locator('.graph-canvas canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => (await saved(page)).view.graphSnapshot?.camera, { timeout: 15000 })
    .toBeDefined();
  await canvas.evaluate((element) => element.setAttribute('data-test-instance', 'original'));
  const beforeGesture = (await saved(page)).view.graphSnapshot!.camera;
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.8);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => (await saved(page)).view.graphSnapshot!.camera)
    .not.toEqual(beforeGesture);
  // Let the gesture finish before taking the stable value whose preservation matters.
  await page.waitForTimeout(1200);
  const before = (await saved(page)).view;
  await workbench(page, 'Analysis').click();
  await expect(workbench(page, 'Trace')).toHaveCount(0);
  await workbench(page, 'Graph').click();
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-test-instance', 'original');
  await page.waitForTimeout(1200);
  const after = (await saved(page)).view;
  expect(after.graphSnapshot?.camera).toEqual(before.graphSnapshot?.camera);
  expect(after.graphSnapshot?.nodes).toEqual(before.graphSnapshot?.nodes);
  expect(after.selectionId).toBe(originOutput);
  expect(after.transactionFlow).toEqual(before.transactionFlow);
});

test('saved Trace mode opens Graph and selection isolation toggles with keyboard and preserves manual hides', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    workspace.view.workbench = 'trace';
    workspace.view.hiddenNodeIds = [siblingOutput];
  });
  await expect(workbench(page, 'Graph')).toHaveAttribute('aria-pressed', 'true');
  await expect(workbench(page, 'Trace')).toHaveCount(0);
  await expect(page.locator('.trace-workbench')).toHaveCount(0);
  const isolate = page.getByRole('button', { name: 'Isolate selection', exact: true });
  await isolate.focus();
  await page.keyboard.press('Enter');
  await expect(isolate).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await saved(page)).view.filters?.focus)
    .toEqual({ id: originOutput, hops: 1 });
  await page.getByLabel('Focus graph paths').selectOption('2');
  await expect.poll(async () => (await saved(page)).view.filters?.focus?.hops).toBe(2);
  await screenshot(page, 'graph-selection-isolated-desktop');
  await page.locator(`.entity-row[title="tx:${TX_FUNDING}"]`).click();
  await expect
    .poll(async () => (await saved(page)).view.filters?.focus?.id)
    .toBe(`tx:${TX_FUNDING}`);
  await isolate.click();
  await expect(isolate).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await saved(page)).view.filters?.focus).toBeUndefined();
  expect((await saved(page)).view.hiddenNodeIds).toEqual([siblingOutput]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Graph', exact: true }).click();
  await isolate.click();
  await expect(isolate).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'graph-selection-isolated-mobile');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(isolate).toHaveAttribute('aria-pressed', 'false');
});

test('equal-output evidence links all six outputs, their addresses and the supporting transaction', async ({
  page,
}) => {
  const { calls } = await seed(page, (workspace) => {
    const tx = workspace.transactions[TX_SPENDING];
    tx.vout = Array.from({ length: 6 }, (_, n) => ({ ...tx.vout[0], n, value: 20 }));
    tx.vout[5].scriptPubKey = { ...transactions[TX_SPENDING].vout[1].scriptPubKey };
    workspace.inputContext = { [TX_SPENDING]: [0] };
    workspace.view.selectionId = `tx:${TX_SPENDING}`;
  });
  await workbench(page, 'Analysis').click();
  const analysis = page.locator('.analysis-workbench');
  await expect(
    analysis.getByRole('option', { name: 'Current selection', exact: true }),
  ).toHaveCount(1);
  await expect(analysis.getByRole('button', { name: 'Trace', exact: true })).toHaveCount(0);
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  await analysis
    .locator('.scan-result-list button')
    .filter({ hasText: /6 equal/ })
    .click();
  const evidence = analysis.getByRole('list', { name: 'Affected entities' });
  await expect(evidence.getByRole('button', { name: /^Show output/ })).toHaveCount(6);
  await expect(evidence).toContainText('2,000,000,000');
  await screenshot(page, 'six-outputs-evidence-desktop');
  await evidence
    .getByRole('button', { name: `Show address ${CHANGE_ADDRESS} on graph`, exact: true })
    .click();
  await expect.poll(async () => (await saved(page)).view.showAddresses).toBe(true);
  await expect
    .poll(async () => (await saved(page)).view.selectionId)
    .toBe(`addr:${CHANGE_ADDRESS}`);
  await expect.poll(async () => (await saved(page)).inputContext?.[TX_SPENDING]).toBeUndefined();
  await page.getByRole('button', { name: 'Back to Analysis', exact: true }).click();
  for (let n = 0; n < 6; n++) {
    await evidence
      .getByRole('button', { name: `Show output ${TX_SPENDING}:${n} on graph`, exact: true })
      .click();
    await expect
      .poll(async () => (await saved(page)).view.selectionId)
      .toBe(`out:${TX_SPENDING}:${n}`);
    expect((await saved(page)).view.filters?.includeIds).toBeUndefined();
    await page.getByRole('button', { name: 'Back to Analysis', exact: true }).click();
  }
  await evidence
    .getByRole('button', { name: /^Show address/ })
    .first()
    .click();
  await expect.poll(async () => (await saved(page)).view.showAddresses).toBe(true);
  await expect.poll(async () => (await saved(page)).view.selectionId).toMatch(/^addr:/);
  await page.getByRole('button', { name: 'Back to Analysis', exact: true }).click();
  await analysis
    .getByRole('list', { name: 'Supporting transactions' })
    .getByRole('button', { name: `Show transaction ${TX_SPENDING} on graph`, exact: true })
    .click();
  await expect.poll(async () => (await saved(page)).view.selectionId).toBe(`tx:${TX_SPENDING}`);
  await page.getByRole('button', { name: 'Back to Analysis', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence.scrollIntoViewIfNeeded();
  await screenshot(page, 'six-outputs-evidence-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls).toEqual([]);
});

for (const phone of [false, true]) {
  test(`keyboard workbench handoff reaches Graph and returns to the exact Analysis invoker (${phone ? 'phone' : 'desktop'})`, async ({
    page,
  }) => {
    const { calls } = await seed(page);
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await workbench(page, 'Analysis').click();
    const analysis = page.locator('.analysis-workbench');
    await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
    const canvas = page.locator('.graph-canvas canvas');
    const invokers = [
      analysis.getByRole('button', { name: 'Show on graph', exact: true }),
      analysis.getByRole('button', { name: 'Isolate', exact: true }),
      analysis.getByRole('button', { name: /^Show output/ }).first(),
      analysis.getByRole('button', { name: /^Show address/ }).first(),
      analysis.getByRole('button', { name: /^Show transaction/ }).first(),
    ];
    for (const invoker of invokers) {
      await invoker.focus();
      await page.keyboard.press('Enter');
      await expect(canvas).toBeFocused();
      await page.keyboard.press('Tab');
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(document.activeElement?.closest('[aria-label="Graph navigation"]')),
          ),
        )
        .toBe(true);
      await page.getByRole('button', { name: 'Back to Analysis', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(invoker).toBeFocused();
      await expect(analysis.getByLabel('Scan scope')).toHaveValue('context');
    }
    await screenshot(page, `keyboard-analysis-return-${phone ? 'phone' : 'desktop'}`);
    expect(calls).toEqual([]);
  });
}

test('keyboard workbench return falls back when the originating finding is replaced or cleared', async ({
  page,
}) => {
  await seed(page);
  const analysis = page.locator('.analysis-workbench');
  await workbench(page, 'Analysis').click();
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  for (const remove of [false, true]) {
    const invoker = analysis.getByRole('button', { name: 'Show on graph', exact: true });
    const original = await invoker.elementHandle();
    await invoker.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.graph-canvas canvas')).toBeFocused();
    await workbench(page, 'Analysis').focus();
    await page.keyboard.press('Enter');
    await expect(workbench(page, 'Analysis')).toBeFocused();
    if (remove) await analysis.getByRole('button', { name: 'Clear all', exact: true }).click();
    else await analysis.locator('.scan-result-list button').nth(1).click();
    expect(await original!.evaluate((element) => element.isConnected)).toBe(false);
    await workbench(page, 'Graph').focus();
    await page.keyboard.press('Enter');
    await expect(workbench(page, 'Graph')).toBeFocused();
    await page.getByRole('button', { name: 'Back to Analysis', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('region', { name: 'Analysis workspace', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(analysis.getByRole('button', { name: 'Scan', exact: true })).toBeFocused();
  }
});

// Retain the original journeys while the Trace workbench is intentionally disabled.
test.skip('Trace requires an output choice, follows one explicit branch and shares encrypted annotations', async ({
  page,
}) => {
  const { workspace, calls } = await seed(page, (workspace) => {
    workspace.view.selectionId = `tx:${TX_FUNDING}`;
  });
  await workbench(page, 'Trace').click();
  const trace = page.getByRole('region', { name: 'Trace workbench', exact: true });
  await expect(trace).toContainText('Choose an output to begin');
  await expect(trace.getByRole('button', { name: 'Scan forward', exact: true })).toHaveCount(0);
  await trace.getByLabel('Choose trace output', { exact: true }).selectOption(originOutput);
  await expect(trace.locator('.trace-current > .trace-id[title]')).toHaveAttribute(
    'title',
    `${TX_FUNDING}:0`,
  );
  await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
  const choice = trace.getByRole('region', { name: 'Choose continuation', exact: true });
  await expect(choice).toContainText('Ambiguous continuation');
  await expect(choice).toContainText('PayJoin');
  await expect(trace.getByLabel('Trace branch', { exact: true })).toHaveValue('');
  await expect(
    trace.getByRole('button', { name: 'Follow selected branch', exact: true }),
  ).toBeDisabled();
  await screenshot(page, 'trace-ambiguity-desktop');
  const nextOutput = `out:${'b'.repeat(64)}:1`;
  await trace.getByLabel('Trace branch', { exact: true }).selectOption(nextOutput);
  await trace.getByRole('button', { name: 'Follow selected branch', exact: true }).click();
  await expect(trace.locator('.trace-current > .trace-id[title]')).toHaveAttribute(
    'title',
    `${'b'.repeat(64)}:1`,
  );
  await expect(trace.getByRole('region', { name: 'Trace trail', exact: true })).toContainText(
    'no satoshi mapping',
  );
  expect(calls).toHaveLength(0);
  await trace.getByRole('button', { name: 'Scan backward', exact: true }).click();
  await expect(choice).toContainText('Choose a previous input');
  await expect(trace.getByLabel('Trace branch', { exact: true })).toHaveValue('');
  await trace.getByLabel('Trace branch', { exact: true }).selectOption(originOutput);
  await trace.getByRole('button', { name: 'Follow selected branch', exact: true }).click();
  await expect(trace.locator('.trace-current > .trace-id[title]')).toHaveAttribute(
    'title',
    `${TX_FUNDING}:0`,
  );
  await trace.getByRole('button', { name: 'Label', exact: true }).click();
  await page.getByLabel('Node label', { exact: true }).fill('Reviewed branch');
  await page
    .getByLabel('Node notes', { exact: true })
    .fill('Chosen continuation, no ownership claim.');
  await page.getByRole('button', { name: 'Back to Trace', exact: true }).click();
  await expect(trace.locator('.trace-current')).toContainText('Reviewed branch');
  await trace.getByRole('button', { name: 'Tags', exact: true }).click();
  const tags = page.getByRole('dialog', { name: 'Choose tags', exact: true });
  await tags.getByLabel('Find or create tag').fill('Reviewed path');
  await tags.getByLabel('Find or create tag').press('Enter');
  await expect(tags.getByRole('checkbox', { name: /Reviewed path/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to Trace', exact: true }).click();
  await trace.getByRole('button', { name: 'Icon', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Choose node icon', exact: true })
    .getByRole('button', { name: 'Star', exact: true })
    .click();
  await page.getByRole('button', { name: 'Back to Trace', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trace.getByRole('button', { name: 'Scan backward', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'trace-mobile');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await unlock(page, workspace.name);
  await expect(trace.locator('.trace-current')).toContainText('Reviewed branch');
  const reopened = await saved(page);
  expect(reopened.annotations[originOutput].note).toBe('Chosen continuation, no ownership claim.');
  expect(reopened.annotations[originOutput].icon).not.toBe('');
  expect(reopened.tags?.find((tag) => tag.name === 'Reviewed path')?.nodeIds).toContain(
    originOutput,
  );
});

test.skip('bounded Trace errors and empty results retain unknown status and the selected branch', async ({
  page,
}) => {
  const { calls } = await seed(page, (workspace) => {
    delete workspace.transactions['b'.repeat(64)];
  });
  let fail = true;
  await page.route('**/api/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.method === 'blockchain.scripthash.get_history')
      return route.fulfill(
        fail
          ? { status: 503, json: { error: 'Synthetic lookup unavailable' } }
          : { json: { result: [] } },
      );
    return route.fallback();
  });
  await workbench(page, 'Trace').click();
  const trace = page.getByRole('region', { name: 'Trace workbench', exact: true });
  await expect(trace).toContainText('No spender loaded. Status unknown.');
  await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
  await expect(trace.locator('.trace-status')).toContainText('Lookup failed.');
  await expect(trace.locator('.trace-current > .trace-id[title]')).toHaveAttribute(
    'title',
    `${TX_FUNDING}:0`,
  );
  fail = false;
  await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
  await expect(trace.locator('.trace-status')).toContainText(
    'No spender found in this bounded search.',
  );
  await expect(trace.locator('.trace-status')).toContainText('Spending status remains unknown');
  await expect(trace.getByLabel('Trace branch', { exact: true })).toHaveCount(0);
  expect(calls.every((call) => call.network === 'mainnet')).toBe(true);
  expect(Object.keys((await saved(page)).transactions)).toEqual([TX_FUNDING]);
});

test.skip('leaving Trace cancels a pending lookup and discards its late spending result', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    delete workspace.transactions['b'.repeat(64)];
  });
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  page.on('close', release);
  await page.route('**/api/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.method === 'blockchain.scripthash.get_history') {
      requested = true;
      await pending;
      return route
        .fulfill({ json: { result: [{ tx_hash: 'b'.repeat(64), height: 899901 }] } })
        .catch(() => {});
    }
    return route.fallback();
  });
  await workbench(page, 'Trace').click();
  const trace = page.getByRole('region', { name: 'Trace workbench', exact: true });
  await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await workbench(page, 'Analysis').click();
  release();
  await workbench(page, 'Trace').click();
  await expect(trace.getByRole('button', { name: 'Scan forward', exact: true })).toBeEnabled();
  await expect(trace).toContainText('No spender loaded. Status unknown.');
  await expect(trace.getByLabel('Trace branch', { exact: true })).toHaveCount(0);
  // A late result must not mutate the encrypted workspace either.
  await page.waitForTimeout(500);
  expect(Object.keys((await saved(page)).transactions)).toEqual([TX_FUNDING]);
});

test.skip('Trace shows a timestamped unspent observation and clears it on a failed recheck', async ({
  page,
}) => {
  await seed(page, (workspace) => {
    delete workspace.transactions['b'.repeat(64)];
  });
  let failed = false;
  let histories = 0;
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.method === 'blockchain.scripthash.get_history') {
      histories++;
      return route.fulfill({ status: 503, json: { error: 'Public fixture failure' } });
    }
    if (call.method !== 'gettxout') return route.fallback();
    return route.fulfill(
      failed
        ? { status: 503, json: { error: 'Public fixture failure' } }
        : {
            json: {
              result: {
                bestblock: 'd'.repeat(64),
                confirmations: 100,
                coinbase: true,
                value: transactions[TX_FUNDING].vout[0].value,
                scriptPubKey: transactions[TX_FUNDING].vout[0].scriptPubKey,
              },
            },
          },
    );
  });
  await workbench(page, 'Trace').click();
  const trace = page.getByRole('region', { name: 'Trace workbench', exact: true });
  await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
  await expect(trace.locator('.trace-neighbor').last()).toContainText('Observed unspent at');
  await expect(trace.locator('.trace-neighbor').last()).not.toContainText('Status unknown');
  expect(histories).toBe(0);
  failed = true;
  await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
  await expect(trace.locator('.trace-status')).toContainText('Lookup failed');
  await expect(trace.locator('.trace-neighbor').last()).toContainText('Status unknown');
  await expect(trace).not.toContainText('Observed unspent at');
});

test.skip('Trace timeout leaves its anchor and saved transactions intact', async ({ page }) => {
  await seed(page, (workspace) => {
    delete workspace.transactions['b'.repeat(64)];
  });
  await page.clock.install();
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  page.on('close', release);
  await page.route('**/api/rpc', async (route) => {
    if (route.request().postDataJSON().method !== 'blockchain.scripthash.get_history')
      return route.fallback();
    requested = true;
    await pending;
    await route.fulfill({ json: { result: [] } }).catch(() => {});
  });
  await workbench(page, 'Trace').click();
  const trace = page.getByRole('region', { name: 'Trace workbench', exact: true });
  await trace.getByRole('button', { name: 'Scan forward', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.clock.fastForward(15_100);
  await expect(trace.locator('.trace-status')).toContainText('Lookup timed out after 15 seconds');
  await expect(trace.locator('.trace-current > .trace-id[title]')).toHaveAttribute(
    'title',
    `${TX_FUNDING}:0`,
  );
  await expect(trace.getByRole('button', { name: 'Scan forward', exact: true })).toBeEnabled();
  release();
  expect(Object.keys((await saved(page)).transactions)).toEqual([TX_FUNDING]);
});
