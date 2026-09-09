import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { encryptWorkspace, decryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import type { Transaction, Workspace } from '../../src/domain/types';
import { analysisTools } from '../../src/domain/analysis';
import {
  mockNetworkDiscovery,
  transactions,
  TX_SPENDING,
  TX_FUNDING,
  type MockCall,
} from '../fixtures/bitcoin';
const password = 'public-analysis-recovery-fixture';
const shots = 'artifacts/analysis-ux';
const nav = (page: Page) => page.getByRole('navigation', { name: 'Workbench', exact: true });

async function prepare(page: Page, attached = false, rawScripts = false, automatic = false) {
  const w = newWorkspace('Public Analysis recovery', 'mainnet');
  const tx: Transaction = structuredClone(transactions[TX_SPENDING]);
  if (attached)
    tx.vin.forEach((input) => {
      input.prevout = transactions[TX_FUNDING].vout[input.vout!];
    });
  if (rawScripts) {
    tx.vin.forEach((input) => {
      if (input.prevout) delete input.prevout.scriptPubKey.type;
    });
    tx.vout = tx.vout.map((output, index) => ({
      ...output,
      scriptPubKey: { hex: index ? '5120' + 'cd'.repeat(32) : output.scriptPubKey.hex },
    }));
  }
  w.transactions = { [TX_SPENDING]: tx };
  w.annotations[`tx:${TX_SPENDING}`] = {
    label: 'Keep this label',
    note: 'Public fixture note',
    icon: '',
    bookmarked: false,
  };
  w.view = {
    ...w.view,
    dimensions: 2,
    selectionId: `tx:${TX_SPENDING}`,
    rightTab: 'analysis',
    graphSnapshot: {
      version: 1,
      dimensions: 2,
      camera: {
        position: { x: 20, y: 30, z: 600 },
        target: { x: 20, y: 30, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      nodes: [{ id: `tx:${TX_SPENDING}`, x: 20, y: 30, z: 0 }],
    },
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
  await mockNetworkDiscovery(page);
  const calls: MockCall[] = [];
  const state = {
    mode: 'attached' as 'attached' | 'partial' | 'complete' | 'wait' | 'slow-parent',
    release: undefined as (() => void) | undefined,
  };
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    calls.push(call);
    if (state.mode === 'wait' || (state.mode === 'slow-parent' && call.params[0] !== TX_SPENDING))
      await new Promise<void>((resolve) => {
        state.release = resolve;
      });
    let result: Transaction;
    if (call.params[0] === TX_SPENDING) {
      result = structuredClone(transactions[TX_SPENDING]);
      if (state.mode === 'attached')
        result.vin.forEach((input) => {
          input.prevout = transactions[TX_FUNDING].vout[input.vout!];
        });
      if (state.mode === 'partial' || state.mode === 'slow-parent')
        result.vin[0].prevout = transactions[TX_FUNDING].vout[0];
    } else if (call.params[0] === TX_FUNDING && state.mode === 'complete')
      result = structuredClone(transactions[TX_FUNDING]);
    else {
      await route.fulfill({ status: 400, json: { error: 'Public fixture: parent unavailable' } });
      return;
    }
    await route.fulfill({ json: { result } });
  });
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.analysis-workbench')).toBeVisible();
  if (!automatic) {
    await page.getByText('Optional settings', { exact: true }).click();
    await page.getByLabel('Load missing input data before scanning', { exact: true }).uncheck();
    await page.getByText('Optional settings', { exact: true }).click();
  }
  await mkdir(shots + '/followup', { recursive: true });
  return { w, calls, state };
}
async function scan(page: Page) {
  await page
    .locator('.analysis-workbench')
    .getByRole('button', { name: 'Scan', exact: true })
    .click();
  await expect(page.locator('.scan-result-list button').first()).toBeVisible();
}
async function exportData(page: Page) {
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export encrypted workspace backup', exact: true })
    .click();
  const file = await (await download).path();
  return (await decryptWorkspace(JSON.parse(await readFile(file!, 'utf8')), password)) as Workspace;
}

test('keyboard multiselect, zero counts, help, priority chips and reset filter results without RPC', async ({
  page,
}) => {
  const { calls } = await prepare(page, true);
  const trigger = page.getByRole('button', { name: /Finding types/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Analysis finding types' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(analysisTools.length);
  await dialog.getByRole('img', { name: 'Value flow and fees', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('Not scanned this session');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await scan(page);
  await trigger.click();
  await expect(
    dialog
      .locator('.wallet-category-option')
      .filter({ hasText: 'Value flow and fees' })
      .locator('.wallet-count'),
  ).toHaveText('1');
  await expect(
    dialog
      .locator('.wallet-category-option')
      .filter({ hasText: 'Consolidation and fan-out' })
      .locator('.wallet-count'),
  ).toHaveText('0');
  await dialog.getByRole('button', { name: 'Clear types', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Value flow and fees', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Common-input ownership', exact: true }).check();
  await page.screenshot({ path: `${shots}/after-desktop-types.png` });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.scan-result-list > button')).toHaveCount(2);
  await page.getByRole('button', { name: /Low \d/ }).click();
  await expect(page.locator('.scan-result-list > button')).toHaveCount(1);
  await page.getByRole('button', { name: /Medium \d/ }).click();
  await expect(page.locator('.scan-empty')).toContainText('Reset filters');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.locator('.scan-result-list > button')).toHaveCount(2);
  await nav(page).getByRole('button', { name: 'Graph', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Analysis', exact: true }).click();
  expect(calls).toHaveLength(0);
});

test('attached-data recovery preserves camera, annotations and Undo across cached Graph handoff', async ({
  page,
}) => {
  const { w, calls } = await prepare(page);
  await scan(page);
  await page.locator('.scan-result-list > button').filter({ hasText: 'Fee unknown' }).click();
  await page.screenshot({ path: `${shots}/after-desktop-missing.png` });
  const before = await exportData(page);
  await page
    .getByRole('article', { name: 'Selected finding' })
    .getByRole('button', { name: 'Load missing data and rerun', exact: true })
    .click();
  await expect(page.locator('.scan-notice').first()).toContainText('2 input details resolved');
  await expect(page.locator('.scan-detail h2')).toContainText('Fee:');
  expect(calls.map((call) => [call.method, ...call.params])).toEqual([
    ['getrawtransaction', TX_SPENDING, 2],
  ]);
  const after = await exportData(page);
  expect(Object.keys(after.transactions)).toEqual([TX_SPENDING]);
  expect(after.annotations).toEqual(w.annotations);
  expect(after.view.selectionId).toBe(before.view.selectionId);
  expect(after.view.graphSnapshot?.camera).toEqual(before.view.graphSnapshot?.camera);
  expect(after.findings.every((finding) => !finding.stale)).toBe(true);
  await page.screenshot({ path: `${shots}/after-desktop-resolved.png` });
  const invoker = page.getByRole('button', { name: 'Show on graph', exact: true });
  await invoker.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.graph-canvas canvas')).toBeFocused();
  await page.getByRole('button', { name: 'Back to Analysis', exact: true }).click();
  await expect(invoker).toBeFocused();
  expect(calls).toHaveLength(1);
  await page.locator('.workspace-undo').click();
  await expect(page.locator('.scan-detail h2')).toContainText('Fee unknown');
  expect(calls).toHaveLength(1);
});

test('partial success, cancellation and retry stay scoped and never add parent branches', async ({
  page,
}) => {
  const { calls, state } = await prepare(page);
  state.mode = 'partial';
  await scan(page);
  await page.locator('.scan-result-list > button').filter({ hasText: 'Fee unknown' }).click();
  const recover = page
    .getByRole('article', { name: 'Selected finding' })
    .getByRole('button', { name: 'Load missing data and rerun', exact: true });
  await recover.click();
  await expect(page.locator('.scan-notice').first()).toContainText('1 still unavailable');
  await expect(page.locator('.scan-detail')).toContainText('1/2 input values available');
  await page.screenshot({ path: `${shots}/after-desktop-partial.png` });
  state.mode = 'wait';
  await recover.click();
  await expect.poll(() => !!state.release).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  state.release!();
  await expect(page.locator('.scan-notice').first()).toContainText('cancelled');
  await expect(page.locator('.scan-detail')).toContainText('1/2 input values available');
  state.mode = 'complete';
  await recover.click();
  await expect(page.locator('.scan-notice').first()).toContainText('Findings current');
  await expect(page.locator('.scan-detail h2')).toContainText('Fee:');
  const exported = await exportData(page);
  expect(Object.keys(exported.transactions)).toEqual([TX_SPENDING]);
  expect(exported.transactions[TX_SPENDING].vin.every((input) => !!input.prevout)).toBe(true);
  expect(calls.every((call) => call.network === 'mainnet')).toBe(true);
});

test.describe('phone touch walkthrough', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('type help, recovery and reset remain reachable on a phone', async ({ page }) => {
    const { calls } = await prepare(page);
    await scan(page);
    await page.locator('.scan-result-list > button').filter({ hasText: 'Fee unknown' }).tap();
    await page.screenshot({ path: `${shots}/after-phone-missing.png` });
    await page.getByRole('button', { name: /Finding types/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Analysis finding types' });
    await dialog.getByRole('img', { name: 'Value flow and fees', exact: true }).tap();
    await expect(page.getByRole('tooltip')).toContainText('Reconcile');
    await page.screenshot({ path: `${shots}/after-phone-types-help.png` });
    await dialog.getByRole('button', { name: 'Clear types', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Close analysis finding types', exact: true }).tap();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).tap();
    await page.locator('.scan-result-list > button').filter({ hasText: 'Fee unknown' }).tap();
    await page
      .getByRole('article', { name: 'Selected finding' })
      .getByRole('button', { name: 'Load missing data and rerun', exact: true })
      .tap();
    await expect(page.locator('.scan-detail h2')).toContainText('Fee:');
    await page.screenshot({ path: `${shots}/after-phone-resolved.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

test('leaving Analysis and locking cancel recovery before late responses can save data', async ({
  page,
}) => {
  const { state, calls } = await prepare(page);
  await scan(page);
  await page.locator('.scan-result-list > button').filter({ hasText: 'Fee unknown' }).click();
  const recover = page
    .getByRole('article', { name: 'Selected finding' })
    .getByRole('button', { name: 'Load missing data and rerun', exact: true });
  state.mode = 'wait';
  await recover.click();
  await expect.poll(() => !!state.release).toBe(true);
  await nav(page).getByRole('button', { name: 'Graph', exact: true }).click();
  state.release!();
  await nav(page).getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(page.locator('.scan-notice').first()).toContainText('cancelled');
  await expect(page.locator('.scan-detail')).toContainText('0/2 input values available');
  expect(calls).toHaveLength(1);
  state.release = undefined;
  await recover.click();
  await expect.poll(() => !!state.release).toBe(true);
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.workspace-tab')).toHaveCount(0);
  state.release!();
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await page.locator('.saved-row').click();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.analysis-workbench')).toBeVisible();
  await page.locator('.scan-result-list > button').filter({ hasText: 'Fee unknown' }).click();
  await expect(page.locator('.scan-detail')).toContainText('0/2 input values available');
  expect(calls).toHaveLength(2);
});

test('standard script bytes improve comparisons without fetching omitted type labels', async ({
  page,
}) => {
  const { calls } = await prepare(page, true, true);
  await scan(page);
  await page
    .locator('.scan-result-list > button')
    .filter({ hasText: 'Mixed output script types' })
    .click();
  await expect(page.locator('.scan-detail')).toContainText('Known input types: P2WPKH');
  await expect(page.locator('.scan-detail')).toContainText('Known output types: P2WPKH, Taproot');
  await expect(page.locator('.scan-detail')).toContainText(
    '0 input and 0 output types are unavailable',
  );
  await expect(
    page.getByRole('button', { name: 'Load scope data and rerun', exact: true }),
  ).toHaveCount(0);
  expect(calls).toHaveLength(0);
  await page.screenshot({ path: `${shots}/after-desktop-script-evidence.png` });
});

test('Scan automatically resolves missing inputs and keeps the compact toolbar and navigation cache', async ({
  page,
}) => {
  const { calls } = await prepare(page, false, false, true);
  const before = await exportData(page);
  await scan(page);
  await expect(page.locator('.scan-result-list')).not.toContainText('Fee unknown');
  await page.locator('.scan-result-list > button').filter({ hasText: 'Fee:' }).click();
  expect(calls.map((call) => [call.method, ...call.params])).toEqual([
    ['getrawtransaction', TX_SPENDING, 2],
  ]);
  await expect(page.locator('.scan-results-heading .scan-priorities')).toBeVisible();
  await expect(page.getByText('Review priority', { exact: true })).toHaveCount(0);
  await expect(page.locator('.scan-filter-note')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: /Finding types/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Analysis finding types' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: `${shots}/followup/after-desktop.png` });
  const after = await exportData(page);
  expect(after.view.graphSnapshot?.camera).toEqual(before.view.graphSnapshot?.camera);
  expect(after.view.selectionId).toEqual(before.view.selectionId);
  expect(Object.keys(after.transactions)).toEqual([TX_SPENDING]);
  await nav(page).getByRole('button', { name: 'Graph', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Analysis', exact: true }).click();
  await scan(page);
  expect(calls).toHaveLength(1);
});

test('automatic loading times out with partial evidence and leaves manual recovery available', async ({
  page,
}) => {
  const { calls, state } = await prepare(page, false, false, true);
  state.mode = 'slow-parent';
  await scan(page);
  await page.locator('.scan-result-list > button').filter({ hasText: 'Fee unknown' }).click();
  await expect(page.locator('.scan-detail')).toContainText('1/2 input values available');
  await expect(page.locator('.scan-notice').first()).toContainText('Automatic loading timed out');
  await expect(
    page.getByRole('button', { name: 'Load missing data and rerun', exact: true }),
  ).toBeEnabled();
  expect(calls).toHaveLength(2);
  state.release!();
  await page.screenshot({ path: `${shots}/followup/after-partial.png` });
});

test('cancelling automatic loading does not replace saved findings or start parent lookups', async ({
  page,
}) => {
  const { calls, state } = await prepare(page, false, false, true);
  state.mode = 'wait';
  await page
    .locator('.analysis-workbench')
    .getByRole('button', { name: 'Scan', exact: true })
    .click();
  await expect.poll(() => !!state.release).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  state.release!();
  await expect(page.locator('.scan-notice').first()).toContainText('cancelled');
  await expect(page.locator('.scan-result-list')).toHaveCount(0);
  expect(calls).toHaveLength(1);
});

test.describe('automatic phone scan', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('touch Scan enriches missing inputs and the compact filters stay reachable', async ({
    page,
  }) => {
    const { calls } = await prepare(page, false, false, true);
    await scan(page);
    await page.locator('.scan-result-list > button').filter({ hasText: 'Fee:' }).tap();
    await page.getByRole('button', { name: /Finding types/ }).tap();
    await page
      .getByRole('dialog', { name: 'Analysis finding types' })
      .getByRole('button', { name: 'Clear types', exact: true })
      .tap();
    await page.getByRole('button', { name: 'Close analysis finding types', exact: true }).tap();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).tap();
    await expect(page.locator('.scan-result-list')).not.toContainText('Fee unknown');
    await page.screenshot({ path: `${shots}/followup/after-phone.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
