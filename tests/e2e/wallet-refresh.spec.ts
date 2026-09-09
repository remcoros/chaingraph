import { expect, test, type Page } from '@playwright/test';
import {
  PUBLIC_ZPUB,
  mockNetworkDiscovery,
  TX_FUNDING,
  TX_SPENDING,
  transactions,
  type MockCall,
} from '../fixtures/bitcoin';

const PASSWORD = 'public-wallet-refresh-test-only';
const NEXT_RECEIVE = 'c'.repeat(64);
const RECEIVE_HASH = '6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a';
const CHANGE_HASH = '48d4bc4257d5177c6a44dfa0e3fd17916fc15b39b8a1cbb0aa297b059f826425';

async function createAndLoad(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
  await dialog.getByLabel('Name (public)', { exact: true }).fill('Returning wallet fixture');
  await dialog.getByLabel('Bitcoin network').selectOption('mainnet');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await page
    .getByRole('dialog', { name: 'Guided tour' })
    .getByRole('button', { name: 'Skip tour' })
    .click();
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a wallet' });
  await add.getByLabel('Wallet name').fill('Public BIP84 wallet');
  await add.getByLabel('Extended public key').fill(PUBLIC_ZPUB);
  await add.getByRole('button', { name: 'Add wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Scan wallet', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await expect(page.getByRole('button', { name: 'Refresh wallet', exact: true })).toBeEnabled();
}

async function selectFunding(page: Page) {
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('transaction');
  await page.getByLabel('Filter graph entities').fill(TX_FUNDING);
  await page.locator('.entity-list .entity-row').first().click();
}

async function phaseFixture(page: Page) {
  let phase = 1;
  let pause = false;
  let waiting = false;
  const releases: (() => void)[] = [];
  const calls: MockCall[] = [];
  await mockNetworkDiscovery(page);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    calls.push(call);
    expect(call.network, 'wallet requests retain their workspace network').toBe('mainnet');
    if (pause && call.method === 'blockchain.scripthash.get_history') {
      waiting = true;
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      // Route disposal on cancellation is allowed and must not fail the fixture.
      await route.abort().catch(() => {});
      return;
    }
    let result: unknown;
    if (call.method === 'blockchain.scripthash.get_history') {
      result =
        call.params[0] === RECEIVE_HASH
          ? [
              { tx_hash: TX_FUNDING, height: 899900 },
              ...(phase > 1
                ? [
                    { tx_hash: TX_SPENDING, height: 899901 },
                    { tx_hash: NEXT_RECEIVE, height: 0 },
                  ]
                : []),
            ]
          : call.params[0] === CHANGE_HASH && phase > 1
            ? [{ tx_hash: TX_SPENDING, height: 899901 }]
            : [];
    } else if (call.method === 'getrawtransaction') {
      result =
        call.params[0] === NEXT_RECEIVE
          ? { ...transactions[TX_FUNDING], txid: NEXT_RECEIVE, confirmations: 0 }
          : transactions[call.params[0] as keyof typeof transactions];
    }
    await route.fulfill(
      result === undefined
        ? { status: 400, json: { error: 'Unsupported public fixture request' } }
        : { json: { result } },
    );
  });
  return {
    calls,
    advance: () => {
      phase = 2;
    },
    pause: () => {
      pause = true;
    },
    waiting: () => waiting,
    release: () => {
      pause = false;
      releases.splice(0).forEach((release) => release());
    },
  };
}

test('reopens a wallet days later, refreshes new receives and spends, and keeps selection, notes and encrypted metadata', async ({
  page,
}, testInfo) => {
  const fixture = await phaseFixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-05T12:00:00Z') });
  await createAndLoad(page);
  await page.getByRole('button', { name: 'Show new activity (1)', exact: true }).click();
  await selectFunding(page);
  await page.getByLabel('Node label').fill('Exchange withdrawal');
  await page.getByLabel('Node notes').fill('Keep this source attribution after refreshing.');
  await page.getByLabel('Bookmark', { exact: true }).check();
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await expect(page.locator('.saved-row')).toBeVisible();
  fixture.advance();
  await page.clock.setSystemTime(new Date('2026-09-08T13:00:00Z'));
  await page.reload();
  const callsBefore = fixture.calls.length;
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  // Reopening restores the selected transaction and the Entities tab. Navigate
  // explicitly to wallet controls before checking that monitoring stays off.
  await expect(page.getByLabel('Node label')).toHaveValue('Exchange withdrawal');
  await expect(page.getByLabel('Filter graph entities')).toHaveValue(TX_FUNDING);
  await page
    .locator('.left-panel .panel-tabs')
    .getByRole('button', { name: /^Wallets/ })
    .click();
  await expect(page.locator('.wallet-row')).toContainText('Checked 3 days ago');
  await expect(page.getByLabel('Check activity every 30s')).not.toBeChecked();
  expect(fixture.calls.length).toBe(callsBefore);
  await selectFunding(page);
  await expect(page.getByLabel('Node label')).toHaveValue('Exchange withdrawal');
  await expect(page.getByLabel('Node notes')).toHaveValue(
    'Keep this source attribution after refreshing.',
  );
  await expect(page.getByLabel('Bookmark', { exact: true })).toBeChecked();
  await page.getByLabel('Node notes').fill('Edited note remains during refresh.');
  await page
    .locator('.left-panel .panel-tabs')
    .getByRole('button', { name: /^Wallets/ })
    .click();
  await page.getByRole('button', { name: 'Refresh all wallets', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('3 transactions');
  await expect(
    page.getByRole('button', { name: 'Refresh all wallets', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.selection-heading h2')).toHaveText('Exchange withdrawal');
  await expect(page.getByLabel('Node notes')).toHaveValue('Edited note remains during refresh.');
  await expect(page.locator('.wallet-activity-link')).toContainText('2');
  // A no-new-transaction check must not clear the unreviewed activity badge.
  await page.getByRole('button', { name: 'Refresh all wallets', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Refresh all wallets', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.statusbar')).toContainText('3 transactions');
  await expect(page.locator('.wallet-activity-link')).toContainText('2');
  const refreshedCalls = fixture.calls
    .slice(callsBefore)
    .filter((call) => call.method === 'getrawtransaction');
  expect(refreshedCalls.map((call) => call.params[0])).toEqual([
    TX_SPENDING,
    NEXT_RECEIVE,
    NEXT_RECEIVE,
  ]);
  await page.locator('.wallet-row').click();
  await expect(
    page.getByText('Last check: 0 new to workspace · 1 transaction refreshed', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath('wallet-refreshed-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Show new activity (2)', exact: true }).click();
  await expect(page.getByLabel('Filter graph entities')).toHaveValue('');
  await expect(page.locator('.entity-list')).toContainText(TX_SPENDING.slice(0, 8));
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await selectFunding(page);
  await expect(page.getByLabel('Node notes')).toHaveValue('Edited note remains during refresh.');
  await page
    .locator('.left-panel .panel-tabs')
    .getByRole('button', { name: /^Wallets/ })
    .click();
  await page.locator('.wallet-row').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Refresh wallet', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({
    path: testInfo.outputPath('wallet-refreshed-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  const storage = await page.evaluate(() =>
    JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
  );
  for (const privateValue of [PUBLIC_ZPUB, 'Exchange withdrawal', 'Edited note remains', PASSWORD])
    expect(storage).not.toContain(privateValue);
});

test('cancels a returning refresh without advancing the saved check or committing partial history', async ({
  page,
}) => {
  const fixture = await phaseFixture(page);
  await createAndLoad(page);
  const lastChecked = await page.getByText(/^Last checked /).textContent();
  await page.clock.setSystemTime(new Date(Date.now() + 86_400_000));
  fixture.advance();
  fixture.pause();
  await page.getByRole('button', { name: 'Refresh wallet', exact: true }).click();
  await expect.poll(fixture.waiting).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  fixture.release();
  await expect(page.getByRole('button', { name: 'Refresh wallet', exact: true })).toBeEnabled();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  await expect(page.getByText(/^Last checked /)).toHaveText(lastChecked!);
  await expect(
    page.getByText('Last check: 1 new to workspace · 0 transactions refreshed', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Refresh wallet', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('3 transactions');
});

test('acknowledging new wallet activity keeps analysis reports and findings active', async ({
  page,
}) => {
  const fixture = await phaseFixture(page);
  await createAndLoad(page);
  fixture.advance();
  await page.getByRole('button', { name: 'Refresh wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh wallet', exact: true })).toBeEnabled();
  const modes = page.getByRole('navigation', { name: 'Workbench', exact: true });
  await modes.getByRole('button', { name: 'Analysis', exact: true }).click();
  const analysis = page.locator('.analysis-workbench');
  await analysis.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(analysis.locator('.scan-run-note')).toBeVisible();
  const report = await analysis.locator('.scan-run-note').textContent();
  const resultTitles = await analysis.locator('.scan-result-list strong').allTextContents();
  expect(resultTitles.length).toBeGreaterThan(0);
  await modes.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh all wallets', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Refresh all wallets', exact: true }),
  ).toBeEnabled();
  await modes.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(analysis.locator('.scan-run-note')).toHaveText(report!);
  await modes.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.locator('.wallet-activity-link').click();
  await modes.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(analysis.locator('.scan-run-note')).toHaveText(report!);
  await expect(analysis.locator('.scan-result-list strong')).toHaveText(resultTitles);
  await expect(analysis.locator('.scan-result-list').getByText(/Needs rerun/)).toHaveCount(0);
});

test('monitoring only queries wallets after opt-in and preserves activity until reviewed', async ({
  page,
}) => {
  const fixture = await phaseFixture(page);
  await createAndLoad(page);
  await page.clock.install();
  fixture.advance();
  const baseline = fixture.calls.length;
  await page.clock.fastForward(31_000);
  expect(fixture.calls.length).toBe(baseline);
  await page.getByLabel('Check activity every 30s').check();
  await page.clock.fastForward(31_000);
  await expect(page.locator('.statusbar')).toContainText('3 transactions');
  await expect(page.getByRole('button', { name: 'Refresh wallet', exact: true })).toBeEnabled();
  await page.getByLabel('Check activity every 30s').uncheck();
  const checked = fixture.calls.length;
  await page.clock.fastForward(31_000);
  expect(fixture.calls.length).toBe(checked);
  await expect(
    page.getByRole('button', { name: 'Show new activity (3)', exact: true }),
  ).toBeVisible();
});

test('turning monitoring off cancels its current history requests', async ({ page }) => {
  const fixture = await phaseFixture(page);
  await createAndLoad(page);
  await page.clock.install();
  fixture.advance();
  fixture.pause();
  await page.getByLabel('Check activity every 30s').check();
  await page.clock.fastForward(31_000);
  await expect.poll(fixture.waiting).toBe(true);
  await page.getByLabel('Check activity every 30s').uncheck();
  fixture.release();
  await expect(page.getByRole('button', { name: 'Refresh wallet', exact: true })).toBeEnabled();
  await expect(page.locator('.statusbar')).toContainText('1 transaction');
  const stopped = fixture.calls.length;
  await page.clock.fastForward(31_000);
  expect(fixture.calls.length).toBe(stopped);
});

test('shows wallet script matches without making requests or acknowledging new activity', async ({
  page,
}) => {
  const fixture = await phaseFixture(page);
  await createAndLoad(page);
  const requests = fixture.calls.length;
  await page.getByRole('button', { name: 'Show wallet matches', exact: true }).click();
  await expect(page.locator('.filter-chip')).toContainText([
    'Wallet: Public BIP84 wallet',
    'Connected context shown',
  ]);
  expect(fixture.calls).toHaveLength(requests);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('output');
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.getByRole('region', { name: 'Tags and wallet matches' })).toContainText(
    'Wallet match: Public BIP84 wallet',
  );
  await expect(page.locator('.transaction-row.is-selected .entity-badges')).toContainText(
    'Wallet: Public BIP84 wallet',
  );
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.locator('.filter-chip')).toHaveCount(0);
  expect(fixture.calls).toHaveLength(requests);
});
