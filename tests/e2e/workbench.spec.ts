import { WORKSPACE_TEMPLATES } from '../../src/domain/workspaceTemplates';
import { openLaboratoryFixture } from '../fixtures/open-workspace';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import {
  mockBitcoin,
  PUBLIC_ZPUB,
  RECEIVE_ADDRESS,
  TX_FUNDING,
  TX_SPENDING,
} from '../fixtures/bitcoin';

const PASSWORD = 'public-test-only-passphrase';
const STORAGE = 'chaingraph.encrypted-workspaces.v1';
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page) ?? [], 'uncaught browser errors').toEqual([]);
});

async function createWorkspace(page: Page, name = 'Private investigation', fixture = false) {
  if (fixture) {
    await openLaboratoryFixture(page, name, PASSWORD);
    return;
  }
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog', {
    name: 'Create a workspace',
  });
  await dialog.getByLabel('Name (public)', { exact: true }).fill(name);
  await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Open workspaces' })
      .getByRole('button', { name: new RegExp(name) }),
  ).toBeVisible();
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  if (await tour.isVisible()) await tour.getByRole('button', { name: 'Skip tour' }).click();
}

async function addAndScanWallet(page: Page) {
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a wallet' });
  await dialog.getByLabel('Wallet name').fill('My private BIP84 wallet');
  await dialog.getByLabel('Extended public key').fill(PUBLIC_ZPUB);
  await dialog.getByRole('button', { name: 'Preview first receive address' }).click();
  await expect(dialog.getByText(RECEIVE_ADDRESS, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Scan wallet', exact: true }).click();
  await expect(
    page.getByText('Gap limit reached on both branches.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
}

async function selectTransaction(page: Page, hash = TX_FUNDING) {
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('transaction');
  await page.getByLabel('Filter graph entities').fill(hash);
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.getByLabel('Node label')).toBeVisible();
}

async function saved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 20000 });
}

test('suggested workspace names are selected for replacement without disrupting later edits', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.goto('/');
  for (const clickSuggestion of [false, true]) {
    await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
    const dialog = page.getByRole('dialog');
    const name = dialog.getByLabel('Name (public)', { exact: true });
    await expect(name).toBeFocused();
    const suggestion = await name.inputValue();
    await expect
      .poll(() =>
        name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
      )
      .toEqual([0, suggestion.length]);
    // Also preserve replacement when clicking an already autofocused suggestion.
    if (clickSuggestion) await name.click();
    await name.pressSequentially('My trace');
    await expect(name).toHaveValue('My trace');
    await name.press('Tab');
    await name.click();
    await name.press('End');
    await name.pressSequentially(' revised');
    await expect(name).toHaveValue('My trace revised');
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
});

test('requires password confirmation and offers a restartable guided tour', async ({ page }) => {
  await mockBitcoin(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password').fill('different-password');
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Passwords do not match.');
  await dialog.getByLabel('Confirm password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(tour).toContainText('Bring your wallets together');
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await page.getByRole('button', { name: 'Help and samples' }).click();
  await page.getByRole('menuitem', { name: 'Show guided tour', exact: true }).click();
  await expect(tour).toContainText('An investigation has its own space');
});

test('public BIP84 wallet scans both branches, annotates and bookmarks graph entities without transmitting xpubs', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page);
  await addAndScanWallet(page);
  await expect(page.getByTestId('graph-view').locator('canvas')).toBeVisible();
  await selectTransaction(page);
  await page.getByLabel('Node label').fill('Salary origin');
  await page.getByLabel('Node notes').fill('Public fixture, personal note retained privately.');
  await page.getByRole('button', { name: /Node icon/ }).click();
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  await page.getByLabel('Bookmark', { exact: true }).check();
  await expect(page.locator('.selection-heading h2')).toHaveText('Salary origin');
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(
    page.locator('.entity-list').getByRole('button', { name: /Salary origin/ }),
  ).toBeVisible();
  await saved(page);
  const storage = await page.evaluate(() =>
    JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
  );
  expect(storage).toContain('ciphertext');
  for (const secret of [
    PUBLIC_ZPUB,
    'My private BIP84 wallet',
    'Salary origin',
    'personal note',
    PASSWORD,
  ])
    expect(storage).not.toContain(secret);
  expect(JSON.stringify(calls)).not.toContain(PUBLIC_ZPUB);
  expect(calls.filter((c) => c.method === 'getrawtransaction')).toHaveLength(2);
  expect(
    calls.filter((c) => c.method === 'blockchain.scripthash.get_history').length,
  ).toBeGreaterThanOrEqual(40);
});

test('locks, rejects the wrong password, and restores a saved workspace after reload', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page, 'Secret study');
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await expect(page.locator('.saved-row')).toHaveCount(1);
  await expect(page.locator('.saved-row')).toContainText('Secret study');
  await expect(page.getByRole('navigation', { name: 'Open workspaces' })).not.toContainText(
    'Secret study',
  );
  await page.reload();
  await page.locator('.saved-row').click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill('definitely-wrong');
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Unable to unlock workspace. The password is incorrect or the file was changed.',
  );
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Open workspaces' })).toContainText(
    'Secret study',
  );
});

test('maintains independent multiple workspace tabs', async ({ page }) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page, 'First investigation');
  await page.getByLabel('Transaction, output, or address').fill('private unsent lookup');
  await createWorkspace(page, 'Second investigation');
  await expect(page.getByLabel('Transaction, output, or address')).toHaveValue('');
  const tabs = page.getByRole('navigation', { name: 'Open workspaces' });
  await expect(tabs.getByRole('button', { name: /First investigation/ })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /Second investigation/ })).toHaveClass(/active/);
  await tabs.getByRole('button', { name: /First investigation/ }).click();
  await expect(tabs.getByRole('button', { name: /First investigation/ })).toHaveClass(/active/);
  await saved(page);
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]').length, STORAGE),
    )
    .toBe(2);
});

test('exports encrypted data and reimports a copy with annotations intact', async ({
  page,
}, testInfo) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page, 'Export study');
  await page.getByLabel('Transaction, output, or address').fill(TX_FUNDING);
  await page.getByRole('button', { name: 'Add to graph' }).click();
  await expect(page.getByLabel('Node label')).toBeVisible();
  await page.getByLabel('Node label').fill('A portable label');
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export encrypted workspace backup', exact: true })
    .click();
  const download = await downloadPromise;
  const file = testInfo.outputPath('workspace.chaingraph');
  await download.saveAs(file);
  const contents = await readFile(file, 'utf8');
  expect(JSON.parse(contents).cipher).toBe('AES-256-GCM');
  expect(contents).not.toContain('A portable label');
  expect(contents).not.toContain('Export study');
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await page.locator('input[type=file][accept=".chaingraph,.json"]').setInputFiles(file);
  const dialog = page.getByRole('dialog', { name: 'Open encrypted workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Open workspaces' })).toContainText(
    'Export study (copy)',
  );
  await selectTransaction(page);
  await expect(page.getByLabel('Node label')).toHaveValue('A portable label');
});

test('renders a saved 150-input fixture and scans, excludes, restores and refreshes analysis evidence', async ({
  page,
}) => {
  await mockBitcoin(page);
  const addedTransaction = 'ff'.repeat(32);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON();
    if (call.method !== 'getrawtransaction' || call.params[0] !== addedTransaction)
      return route.fallback();
    await route.fulfill({
      json: {
        result: {
          txid: addedTransaction,
          vin: [{ coinbase: '00' }],
          vout: [{ n: 0, value: 0.02, scriptPubKey: {} }],
        },
      },
    });
  });
  await page.goto('/');
  await createWorkspace(page, 'Dense transaction study', true);
  await expect(page.getByTestId('graph-view').locator('canvas')).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('543 transactions');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await expect(page.locator('.entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-row')).toContainText('Synthetic CoinJoin 1');
  await page.locator('.entity-row').click();
  await expect(page.locator('.details')).toContainText('150 / 150');
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveClass(/active/);
  await page.getByLabel('Size nodes by').selectOption('value');
  await page.getByRole('button', { name: 'Toggle highlight glow' }).click();
  await page.getByRole('button', { name: 'Fit graph' }).click();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  const modes = page.getByRole('navigation', { name: 'Workbench', exact: true });
  await modes.getByRole('button', { name: 'Analysis', exact: true }).click();
  const analysis = page.locator('.analysis-workbench');
  await analysis
    .getByRole('combobox', { name: 'Scan scope', exact: true })
    .selectOption('workspace');
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  const results = analysis.locator('.scan-result-list > button');
  const equal = results.filter({ hasText: 'equal outputs' });
  await expect(equal).toHaveCount(3);
  await equal.first().click();
  const title = await analysis.locator('.scan-detail h2').textContent();
  await analysis.getByRole('button', { name: 'Exclude finding', exact: true }).click();
  await expect(results.filter({ hasText: 'Excluded' })).toHaveCount(1);
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(results.filter({ hasText: 'Excluded' })).toHaveCount(1);
  await results.filter({ hasText: 'Excluded' }).click();
  await expect(analysis.locator('.scan-detail h2')).toHaveText(title!);
  await analysis.getByRole('button', { name: 'Restore finding', exact: true }).click();
  await expect(results.filter({ hasText: 'Excluded' })).toHaveCount(0);
  // An ordinary chain-data addition invalidates prior analysis evidence.
  await modes.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByLabel('Transaction, output, or address').fill(addedTransaction);
  await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('544 transactions');
  await modes.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(equal.filter({ hasText: 'Needs rerun' })).toHaveCount(3);
  await equal.first().click();
  await expect(analysis.locator('.scan-detail')).toContainText(
    'Loaded data changed after this finding.',
  );
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(results.filter({ hasText: 'Needs rerun' })).toHaveCount(0);
  await analysis.getByRole('button', { name: 'Clear findings', exact: true }).click();
  await expect(results).toHaveCount(0);
});

test('CIOH and address-reuse findings operate on loaded wallet history', async ({ page }) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page);
  await addAndScanWallet(page);
  await page
    .getByRole('navigation', { name: 'Workbench', exact: true })
    .getByRole('button', { name: 'Analysis', exact: true })
    .click();
  const analysis = page.locator('.analysis-workbench');
  await analysis
    .getByRole('combobox', { name: 'Scan scope', exact: true })
    .selectOption('workspace');
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  const results = analysis.locator('.scan-result-list > button');
  await expect(results.filter({ hasText: 'hypothesis' })).toHaveCount(1);
  await expect(results.filter({ hasText: 'The same address appears' })).toHaveCount(1);
  await results.filter({ hasText: 'hypothesis' }).click();
  await expect(analysis.locator('.scan-detail')).toContainText('PayJoin');
});

for (const width of [320, 375, 414, 768])
  test(`responsive workspace fits ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBitcoin(page);
    await page.goto('/');
    const overflow = () =>
      page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
    let dimensions = await overflow();
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    await createWorkspace(page, `Mobile ${width}`);
    dimensions = await overflow();
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    const switcher = page.locator('.mobile-switch');
    if (await switcher.isVisible())
      await switcher.getByRole('button', { name: 'Browse', exact: true }).click();
    await addAndScanWallet(page);
    dimensions = await overflow();
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    if (await switcher.isVisible()) {
      for (const name of ['Browse', 'Inspector', 'Graph']) {
        await switcher.getByRole('button', { name, exact: true }).click();
        dimensions = await overflow();
        expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
      }
    }
  });

test('keeps multiple wallets independent inside one encrypted workspace', async ({ page }) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page, 'Two wallets');
  await addAndScanWallet(page);
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a wallet' });
  await add.getByLabel('Wallet name').fill('Taproot savings');
  // Public BIP86 account vector, BSD-2-Clause; also verified in wallet.test.ts.
  await add
    .getByLabel('Extended public key')
    .fill(
      'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ',
    );
  await add.getByLabel('Address type').selectOption('p2tr');
  await add.getByRole('button', { name: 'Add wallet', exact: true }).click();
  await expect(page.locator('.wallet-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Scan wallet', exact: true }).click();
  await expect(
    page.getByText('Gap limit reached on both branches.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
  await saved(page);
  await page.reload();
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.wallet-row')).toHaveCount(2);
  await page.locator('.wallet-row').filter({ hasText: 'Taproot savings' }).click();
  await page.getByRole('button', { name: 'Remove wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Remove wallet', exact: true }).click();
  await expect(page.locator('.wallet-row')).toHaveCount(1);
  await expect(page.locator('.wallet-row')).toContainText('My private BIP84 wallet');
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});

test('automatic annotation edits survive view changes and undo restores the latest fields', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page);
  await page.getByLabel('Transaction, output, or address').fill(TX_FUNDING);
  await page.getByRole('button', { name: 'Add to graph' }).click();
  const label = page.getByLabel('Node label');
  const notes = page.getByLabel('Node notes');
  await label.fill('First context');
  await notes.fill('Keep the latest note');
  await label.fill('Second context');
  await page.getByRole('button', { name: 'Toggle highlight glow' }).click();
  await page.getByLabel('Size nodes by').selectOption('value');
  await expect(label).toHaveValue('Second context');
  await label.fill('Third context');
  await page.locator('.workspace-undo').click();
  await expect(label).toHaveValue('Second context');
  await expect(notes).toHaveValue('Keep the latest note');
  await notes.fill('Note changed after undo');
  await expect(label).toHaveValue('Second context');
  await expect(notes).toHaveValue('Note changed after undo');
  await expect(page.getByRole('button', { name: 'Save annotation' })).toHaveCount(0);
  await saved(page);
});

test('imports a long wallet label during scanning and reopens it intact', async ({ page }) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page);
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a wallet' });
  await add.getByLabel('Wallet name').fill('Original wallet name');
  await add.getByLabel('Extended public key').fill(PUBLIC_ZPUB);
  await add.getByRole('button', { name: 'Add wallet', exact: true }).click();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = false;
  await page.route('**/api/rpc', async (route) => {
    if (route.request().postDataJSON().method === 'blockchain.scripthash.get_history') {
      waiting = true;
      await barrier;
    }
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Scan wallet', exact: true }).click();
  await expect.poll(() => waiting).toBe(true);
  const longName = 'Wallet label survives scan completion and encrypted reopening. '.repeat(3);
  try {
    await page.locator('input[type=file][accept=".jsonl,.json,.txt"]').setInputFiles({
      name: 'public-vector-labels.jsonl',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ type: 'xpub', ref: PUBLIC_ZPUB, label: longName })),
    });
    await expect(page.locator('.wallet-row')).toContainText(longName.trim());
  } finally {
    release();
  }
  await expect(
    page.getByText('Gap limit reached on both branches.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.wallet-row')).toContainText(longName.trim());
  await saved(page);
  await page.reload();
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.wallet-row')).toContainText(longName.trim());
});

test('about and connection navigation work and locked copies can be deliberately deleted', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Help and samples' }).click();
  await page.getByRole('menuitem', { name: 'About Chaingraph', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('CHAINGRAPH 0.2.0');
  await expect(page.getByRole('dialog').getByRole('link', { name: 'MIT license' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Connection details', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Your node is connected');
  await page.keyboard.press('Escape');
  await createWorkspace(page, 'Disposable browser study');
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  const remove = page.getByRole('button', {
    name: 'Delete saved workspace Disposable browser study',
  });
  await remove.click();
  await page.getByRole('button', { name: 'Keep workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toHaveCount(1);
  await remove.click();
  await page.getByRole('button', { name: 'Delete from this browser', exact: true }).click();
  await expect(page.locator('.saved-row')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.saved-row')).toHaveCount(0);
});

test('selection history preserves path depth and skips removed transaction nodes', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page);
  for (const id of [TX_FUNDING, TX_SPENDING]) {
    await page.getByLabel('Transaction, output, or address').fill(id);
    await page.getByRole('button', { name: 'Add to graph', exact: true }).click();
    await expect(
      page.locator(`.selection-heading .selection-facts code[title="${id}"]`),
    ).toBeVisible();
  }
  await page.getByLabel('Focus graph paths').selectOption('1');
  await page.getByRole('button', { name: 'Previous selection', exact: true }).click();
  await expect(
    page.locator(`.selection-heading .selection-facts code[title="${TX_FUNDING}"]`),
  ).toBeVisible();
  await expect(page.getByLabel('Focus graph paths')).toHaveValue('1');
  await page
    .getByRole('button', { name: 'Remove transaction from workspace', exact: true })
    .click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await page.getByRole('button', { name: 'Next selection', exact: true }).click();
  await expect(
    page.locator(`.selection-heading .selection-facts code[title="${TX_SPENDING}"]`),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous selection', exact: true }),
  ).toBeDisabled();
});

// Intersection alone misses overlays. Sample the center and four inset corners
// without Playwright's action auto-scroll hiding a clipped or covered control.
async function expectHitTarget(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return [
          [r.left + r.width / 2, r.top + r.height / 2],
          [r.left + 4, r.top + 4],
          [r.right - 4, r.top + 4],
          [r.left + 4, r.bottom - 4],
          [r.right - 4, r.bottom - 4],
        ].every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
      }),
    )
    .toBe(true);
}

test('inspector keeps trace actions and label editing reachable on a 150-output selection', async ({
  page,
}) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page, 'Dense layout study', true);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.locator('.selection-heading h2')).toHaveText('Synthetic CoinJoin 1');
  // The synthetic test transaction carries 150 inputs and 150 equal outputs.
  await expect(page.locator('.selection-heading')).toContainText('150 equal outputs');

  const loadPrevious = page.getByRole('button', {
    name: 'Load previous transactions',
    exact: true,
  });
  const findSpending = page.getByRole('button', {
    name: 'Find spending transactions',
    exact: true,
  });
  const label = page.getByLabel('Node label');
  const notes = page.getByLabel('Node notes');
  const editor = page.locator('.annotation-editor');
  const evidence = page.locator('.selection-evidence');

  // Desktop: actions remain exposed; the sidebar can reveal the complete editor.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(loadPrevious).toBeVisible();
  await expect(findSpending).toBeVisible();
  await expect(label).toBeVisible();
  await expect(notes).toBeVisible();
  const traceBox = await loadPrevious.boundingBox();
  const editorBox = await editor.boundingBox();
  const evidenceBox = await evidence.boundingBox();
  // Common trace actions precede the editor; the evidence block stays below it.
  expect(traceBox!.y).toBeLessThan(editorBox!.y);
  expect(evidenceBox!.y).toBeGreaterThanOrEqual(editorBox!.y + editorBox!.height);
  // Workbench navigation and loaded-spender links consume real vertical space.
  // A small native sidebar scroll must reveal the whole field, including its
  // bottom hit targets, and Tab must still move from label to notes.
  await expectHitTarget(loadPrevious);
  await expectHitTarget(findSpending);
  await page.locator('.inspector-scroll').hover();
  await page.mouse.wheel(0, 120);
  await label.focus();
  await expectHitTarget(label);
  await page.keyboard.press('Tab');
  await expect(notes).toBeFocused();
  await expectHitTarget(notes);
  await mkdir('artifacts/shared-test-triage', { recursive: true });
  await page.screenshot({ path: 'artifacts/shared-test-triage/inspector-desktop.png' });

  // Editing survives toggling the collapsible chain evidence.
  await notes.fill('Draft that must survive evidence toggles.');
  await evidence.locator('summary').click();
  await expect(evidence).toContainText('Inputs / outputs');
  await evidence.locator('summary').click();
  await expect(notes).toHaveValue('Draft that must survive evidence toggles.');

  // Keyboard: label is focusable and Tab advances to the notes field.
  await label.focus();
  await expect(label).toBeFocused();
  await page.keyboard.type(' via keyboard');
  await expect(label).toHaveValue('Synthetic CoinJoin 1 via keyboard');
  await page.keyboard.press('Tab');
  await expect(notes).toBeFocused();

  // Phone: native scrolling and keyboard navigation reach the same complete fields.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Inspector' }).click();
  await expect(page.locator('.graph-navigation')).toBeHidden();
  const scroll = page.locator('.inspector-scroll');
  await scroll.hover();
  await page.mouse.wheel(0, -2000);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
  await expectHitTarget(loadPrevious);
  await expectHitTarget(findSpending);
  const editorMobile = await editor.boundingBox();
  const evidenceMobile = await evidence.boundingBox();
  expect(evidenceMobile!.y).toBeGreaterThan(editorMobile!.y);
  await scroll.hover();
  await page.mouse.wheel(0, 200);
  await label.focus();
  await expectHitTarget(label);
  await page.keyboard.press('Tab');
  await expect(notes).toBeFocused();
  await expectHitTarget(notes);
  await notes.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Phone edit.');
  await expect(notes).toHaveValue('Draft that must survive evidence toggles. Phone edit.');
  await page.screenshot({ path: 'artifacts/shared-test-triage/inspector-phone.png' });
});

test('compact header keeps workspace tabs and lookup controls reachable with keyboard-accessible help and samples', async ({
  page,
}) => {
  const calls = await mockBitcoin(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await createWorkspace(page, 'Compact public study');
  await expect(page.getByRole('toolbar', { name: 'Graph navigation', exact: true })).toHaveCount(0);
  const header = page.locator('.topbar');
  const tabs = header.getByRole('navigation', { name: 'Open workspaces' });
  await expect(tabs.getByRole('button', { name: /Compact public study/ })).toBeVisible();
  const lookup = page.locator('.workbench-toolbar');
  await expect(lookup.getByLabel('Prefetch previous levels')).toHaveValue('0');
  const modes = page.getByRole('navigation', { name: 'Workbench', exact: true });
  async function expectGraphHeaderReachable() {
    const headerBounds = (await header.boundingBox())!;
    const modeBounds = (await modes.boundingBox())!;
    const lookupBounds = (await lookup.boundingBox())!;
    expect(headerBounds.height).toBeLessThan(76);
    expect(modeBounds.height).toBeLessThan(60);
    expect(lookupBounds.height).toBeLessThan(76);
    // Navigation is an intentional row. Check each adjacent boundary for
    // overlap or unused space, rather than treating navigation as a blank gap.
    for (const [above, below] of [
      [headerBounds, modeBounds],
      [modeBounds, lookupBounds],
    ]) {
      const gap = below.y - above.y - above.height;
      expect(gap).toBeGreaterThanOrEqual(-1);
      expect(gap).toBeLessThan(20);
    }
    for (const control of [
      tabs.getByRole('button', { name: /Compact public study/ }),
      modes.getByRole('button', { name: 'Graph', exact: true }),
      modes.getByRole('button', { name: 'Analysis', exact: true }),
      lookup.getByLabel('Transaction, output, or address'),
      lookup.getByLabel('Prefetch previous levels'),
      lookup.getByRole('button', { name: 'Add to graph', exact: true }),
      page.getByRole('button', { name: 'Help and samples', exact: true }),
    ])
      await expectHitTarget(control);
  }
  await expectGraphHeaderReachable();
  await mkdir('artifacts/shared-test-triage', { recursive: true });
  await page.screenshot({ path: 'artifacts/shared-test-triage/header-desktop.png' });

  const help = page.getByRole('button', { name: 'Help and samples', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Help and samples' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Show guided tour', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    menu.getByRole('menuitem', { name: 'Example workspaces', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(help).toBeFocused();
  await help.click();
  await menu.getByRole('menuitem', { name: 'Example workspaces', exact: true }).click();
  const examples = page.getByRole('dialog', { name: 'Example workspaces' });
  await expect(examples).toBeVisible();
  // Both mocked networks are configured. Each current bundled example must be
  // available by name; an old fixed catalog size hides new valid choices.
  await expect(examples.getByRole('button', { name: /^Create .+ workspace$/ })).toHaveCount(
    WORKSPACE_TEMPLATES.length,
  );
  for (const template of WORKSPACE_TEMPLATES) {
    await expect(
      examples.getByRole('button', {
        name: `Create ${template.name} workspace`,
        exact: true,
      }),
    ).toBeEnabled();
  }
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectGraphHeaderReachable();
  await page.screenshot({ path: 'artifacts/shared-test-triage/header-phone.png' });
  await expect(tabs.getByRole('button', { name: /Compact public study/ })).toBeInViewport();
  await expect(lookup.getByLabel('Prefetch previous levels')).toBeInViewport({ ratio: 1 });
  await expect(lookup.getByRole('button', { name: 'Add to graph', exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await help.click();
  await menu.getByRole('menuitem', { name: 'Example workspaces', exact: true }).click();
  await expect(examples).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export encrypted workspace', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.workspace-undo')).toBeVisible();
  expect(calls).toHaveLength(0);
});
