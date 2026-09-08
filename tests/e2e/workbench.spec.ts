import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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

async function createWorkspace(page: Page, name = 'Private investigation', demo = false) {
  if (demo) await page.getByRole('button', { name: /Explore the CoinJoin laboratory/ }).click();
  else await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog', {
    name: demo ? 'Open the CoinJoin laboratory' : 'Create a workspace',
  });
  await dialog.getByLabel('Name (public)', { exact: true }).fill(name);
  if (!demo) await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
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
  await expect(dialog.getByRole('alert')).toContainText('Could not unlock');
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
  await page.getByRole('button', { name: 'Export', exact: true }).click();
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

test('renders the 150-input laboratory and runs, excludes, restores and clears analysis overlays', async ({
  page,
}) => {
  await mockBitcoin(page, false);
  await page.goto('/');
  await createWorkspace(page, 'CoinJoin laboratory', true);
  await expect(page.getByTestId('graph-view').locator('canvas')).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('3 transactions');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await page.locator('.entity-row').click();
  await expect(page.locator('.details')).toContainText('150 / 150');
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveClass(/active/);
  await page.getByLabel('Size nodes by').selectOption('value');
  await page.getByRole('button', { name: 'Toggle highlight glow' }).click();
  await page.getByRole('button', { name: 'Fit graph' }).click();
  await page.getByRole('button', { name: 'All paths', exact: true }).click();
  await page
    .locator('.right-panel')
    .getByRole('button', { name: /^Analysis/ })
    .click();
  await page
    .locator('.analysis-tool')
    .filter({ has: page.getByRole('heading', { name: 'Equal-output detection' }) })
    .getByRole('button')
    .click();
  await expect(page.locator('.finding')).toHaveCount(3);
  await page.locator('.finding').first().getByRole('button', { name: 'Exclude' }).click();
  await expect(page.locator('.finding.excluded')).toHaveCount(1);
  await page
    .locator('.analysis-tool')
    .filter({ has: page.getByRole('heading', { name: 'Equal-output detection', exact: true }) })
    .getByRole('button', { name: 'Run analysis' })
    .click();
  await expect(page.locator('.finding.excluded')).toHaveCount(1);
  await page.locator('.finding.excluded').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.finding.excluded')).toHaveCount(0);
  await page.getByRole('button', { name: 'Help and samples', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show all fixture paths', exact: true }).click();
  await expect(page.locator('.finding').getByText('Needs rerun', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.locator('.finding')).toHaveCount(0);
  for (const name of ['Common-input ownership', 'Address reuse']) {
    await page
      .locator('.analysis-tool')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .getByRole('button')
      .click();
    await expect(
      page
        .locator('.analysis-tool')
        .filter({ has: page.getByRole('heading', { name, exact: true }) })
        .getByRole('status'),
    ).toBeVisible();
    await expect(page.locator('.finding')).toHaveCount(0);
  }
});

test('CIOH and address-reuse findings operate on loaded wallet history', async ({ page }) => {
  await mockBitcoin(page);
  await page.goto('/');
  await createWorkspace(page);
  await addAndScanWallet(page);
  await page
    .locator('.right-panel')
    .getByRole('button', { name: /^Analysis/ })
    .click();
  for (const name of ['Common-input ownership', 'Address reuse']) {
    await page
      .locator('.analysis-tool')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .getByRole('button')
      .click();
    await expect(page.locator('.finding')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  }
  await expect(page.locator('.finding')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Undo workspace change' }).click();
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
  await page.getByRole('button', { name: 'Remove transaction from graph', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await page.getByRole('button', { name: 'Next selection', exact: true }).click();
  await expect(
    page.locator(`.selection-heading .selection-facts code[title="${TX_SPENDING}"]`),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous selection', exact: true }),
  ).toBeDisabled();
});

test('inspector keeps trace actions and label editing reachable on a 150-output selection', async ({
  page,
}) => {
  await mockBitcoin(page, false);
  await page.goto('/');
  await createWorkspace(page, 'Layout laboratory', true);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Filter graph entities').fill('Synthetic CoinJoin 1');
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.locator('.selection-heading h2')).toHaveText('Synthetic CoinJoin 1');
  // The laboratory transaction really carries 150 inputs and 150 equal outputs.
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

  // --- 1440x900: trace actions and automatic editing above the fold ---
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(loadPrevious).toBeVisible();
  await expect(findSpending).toBeVisible();
  await expect(label).toBeVisible();
  await expect(notes).toBeVisible();
  const traceBox = await loadPrevious.boundingBox();
  const editorBox = await editor.boundingBox();
  const notesBox = await notes.boundingBox();
  const evidenceBox = await evidence.boundingBox();
  // Common trace actions precede the editor; the evidence block stays below it.
  expect(traceBox!.y).toBeLessThan(editorBox!.y);
  expect(evidenceBox!.y).toBeGreaterThanOrEqual(editorBox!.y + editorBox!.height);
  // Notes are fully reachable without scrolling the sidebar at this viewport.
  expect(notesBox!.y + notesBox!.height).toBeLessThanOrEqual(900);
  await expect(notes).toBeInViewport({ ratio: 1 });

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

  // --- 390x844: editing stays above the evidence and notes remain reachable ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-switch').getByRole('button', { name: 'Inspector' }).click();
  await expect(page.locator('.graph-navigation')).toBeHidden();
  await expect(loadPrevious).toBeVisible();
  await expect(label).toBeVisible();
  await expect(notes).toBeVisible();
  const editorMobile = await editor.boundingBox();
  const evidenceMobile = await evidence.boundingBox();
  expect(evidenceMobile!.y).toBeGreaterThan(editorMobile!.y);
  await expect(notes).toBeInViewport({ ratio: 1 });
  await expect(notes).toHaveValue('Draft that must survive evidence toggles.');
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
  const headerBounds = (await header.boundingBox())!;
  const lookupBounds = (await lookup.boundingBox())!;
  expect(headerBounds.height).toBeLessThan(76);
  expect(lookupBounds.y - headerBounds.y - headerBounds.height).toBeLessThan(20);

  const help = page.getByRole('button', { name: 'Help and samples', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Help and samples' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Show guided tour', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Mainnet examples', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(help).toBeFocused();
  await help.click();
  await menu.getByRole('menuitem', { name: 'Mainnet examples', exact: true }).click();
  const examples = page.getByRole('dialog', { name: 'Mainnet tracing examples' });
  await expect(examples).toBeVisible();
  await expect(examples.getByRole('button', { name: /^Load example / })).toHaveCount(4);
  for (const button of await examples.getByRole('button', { name: /^Load example / }).all()) {
    await expect(button).toBeEnabled();
  }
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tabs.getByRole('button', { name: /Compact public study/ })).toBeInViewport();
  await expect(lookup.getByLabel('Prefetch previous levels')).toBeInViewport({ ratio: 1 });
  await expect(lookup.getByRole('button', { name: 'Add to graph', exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await help.click();
  await menu.getByRole('menuitem', { name: 'CoinJoin laboratory', exact: true }).click();
  const laboratory = page.getByRole('dialog', { name: 'Open the CoinJoin laboratory' });
  await expect(laboratory).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export encrypted workspace', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByRole('button', { name: 'Undo workspace change', exact: true }),
  ).toBeVisible();
  expect(calls).toHaveLength(0);
});
