import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { encryptWorkspace } from '../../src/lib/crypto';
import { parseWorkspace } from '../../src/domain/workspace';
import { mockNetworkDiscovery } from '../fixtures/bitcoin';
import { largeWalletFixture } from '../fixtures/wallet-performance';

const password = 'public-performance-fixture';
const output = 'artifacts/wallet-selection-performance';

async function seed(page: Page) {
  const workspace = largeWalletFixture();
  parseWorkspace(workspace);
  const entry = {
    id: workspace.id,
    publicName: workspace.name,
    savedAt: '2026-09-09T09:00:00.000Z',
    envelope: await encryptWorkspace(workspace, password),
  };
  await page.addInitScript((entry) => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    localStorage.setItem('chaingraph.encrypted-workspaces.v1', JSON.stringify([entry]));
  }, entry);
  // Saved mainnet data remains inspectable with only another network configured.
  // This isolates already-loaded navigation from discovery and upstream latency.
  await mockNetworkDiscovery(page, { networks: ['testnet4'] });
  const rpcCalls: string[] = [];
  await page.route('**/api/rpc', async (route) => {
    rpcCalls.push(route.request().postDataJSON().method);
    await route.fulfill({ status: 400, json: { error: 'Unexpected fixture request.' } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.saved-row').filter({ hasText: workspace.name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace', exact: true });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30000 });
  return rpcCalls;
}

async function measuredClick(page: Page, index: number) {
  return page
    .locator('.wallet-review-list .wallet-row-button')
    .nth(index)
    .evaluate(async (button) => {
      const started = performance.now();
      (button as HTMLButtonElement).click();
      // The second frame includes React's event update and a paint opportunity.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        elapsedMs: performance.now() - started,
        selected: button.getAttribute('aria-pressed'),
      };
    });
}

test('loaded large-wallet row selection stays responsive without upstream requests', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await mkdir(output, { recursive: true });
  const rpcCalls = await seed(page);
  const session = await context.newCDPSession(page);
  const measurements: Record<string, number[]> = {};
  for (const tab of ['Transactions', 'Addresses']) {
    await page
      .getByRole('navigation', { name: 'Wallet sections' })
      .getByRole('button', { name: tab, exact: true })
      .click();
    await expect(page.getByRole('list', { name: `${tab} records` })).toBeVisible();
    await measuredClick(page, 1);
    await session.send('Profiler.enable');
    await session.send('Profiler.start');
    measurements[tab] = [];
    for (const index of [2, 3, 4, 5, 6]) {
      const result = await measuredClick(page, index);
      expect(result.selected).toBe('true');
      measurements[tab].push(result.elapsedMs);
    }
    const { profile } = await session.send('Profiler.stop');
    await writeFile(`${output}/${tab.toLowerCase()}.cpuprofile`, JSON.stringify(profile));
  }
  await session.detach();
  await writeFile(
    `${output}/timings.json`,
    JSON.stringify({ addresses: 600, transactions: 1800, measurements }, null, 2),
  );
  expect(rpcCalls).toEqual([]);
  for (const samples of Object.values(measurements)) {
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    expect(median, 'Median click-to-render duration for a warmed, loaded wallet').toBeLessThan(250);
  }
});
