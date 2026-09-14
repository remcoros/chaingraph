import { chromium, expect } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decryptWorkspace, encryptWorkspace } from '../src/Infra/Storage/crypto';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import { transactions } from '../tests/fixtures/bitcoin';

// Exercise browser runtime boundaries using only a fresh, synthetic workspace.
// Panel workflows and visual usability belong to explicitly scoped browser QA.
const base = process.env.CHAINGRAPH_SMOKE_URL ?? 'http://127.0.0.1:4300';
const password = 'public-production-test-passphrase';
const description = 'Public fixture standing in for encrypted private workspace content.';
const workspaceName = 'Production smoke';
const storageKey = 'chaingraph.encrypted-workspaces.v1';
const artifacts = path.resolve('artifacts/production-smoke');
const workspace = newWorkspace(workspaceName, 'mainnet');
workspace.transactions = transactions;
const fixture = JSON.stringify([
  {
    id: workspace.id,
    publicName: workspaceName,
    savedAt: new Date().toISOString(),
    envelope: await encryptWorkspace(workspace, password),
  },
]);
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(cache)
    ? readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(cache, name, 'chrome-linux64/chrome'))
        .find(existsSync)
    : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const deadline = setTimeout(() => void browser.close(), 90000);
let step = 'browser context';
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(20000);
  await context.tracing.start({ screenshots: false, snapshots: true, sources: false });
  const page = await context.newPage();
  const errors: string[] = [];
  const workerUrls: string[] = [];
  let unexpectedApiCalls = 0;
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  page.on('pageerror', () => errors.push('page error'));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console error');
  });
  // Block every API request from reaching an upstream. HTTP checks run separately.
  await context.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/networks')
      return route.fulfill({ json: { networks: ['mainnet', 'testnet4'] } });
    if (url.pathname === '/api/status')
      return route.fulfill({
        json: { network: url.searchParams.get('network'), connected: false },
      });
    unexpectedApiCalls++;
    return route.fulfill({ status: 400, json: { error: 'Unexpected smoke request.' } });
  });
  await context.addInitScript(() => {
    localStorage.setItem('chaingraph.tour.seen', '1');
    // Observe contexts created by the application; the assertion must not create one.
    const observed = new WeakSet<HTMLCanvasElement>();
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, canvas, args) {
        const result = Reflect.apply(target, canvas, args);
        if (args[0] === 'webgl2' && result && !observed.has(canvas)) {
          observed.add(canvas);
          canvas.setAttribute('data-smoke-webgl', result.isContextLost() ? 'lost' : 'ready');
          canvas.addEventListener('webglcontextlost', () =>
            canvas.setAttribute('data-smoke-webgl', 'lost'),
          );
          canvas.addEventListener('webglcontextrestored', () =>
            canvas.setAttribute('data-smoke-webgl', 'ready'),
          );
        }
        return result;
      },
    });
  });
  await context.addInitScript(
    ({ key, fixture }) => {
      // Seed once; reload must retain the application's own encrypted save.
      if (localStorage.getItem(key) === null) localStorage.setItem(key, fixture);
    },
    { key: storageKey, fixture },
  );
  const encryptionWorkers = () =>
    workerUrls.filter((url) => {
      const parsed = new URL(url);
      return (
        parsed.origin === new URL(base).origin &&
        /\/assets\/workspaceEncryption\.worker-[^/]+\.js$/.test(parsed.pathname)
      );
    }).length;
  try {
    step = 'built application startup';
    await page.goto(base);
    await page.locator('.saved-row').filter({ hasText: workspaceName }).click();
    const initialUnlock = page.getByRole('dialog', { name: 'Unlock workspace' });
    await initialUnlock.getByLabel('Password', { exact: true }).fill(password);
    await initialUnlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Open workspaces' })).toContainText(
      workspaceName,
    );
    step = 'encrypted browser save';
    const beforeSave = encryptionWorkers();
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page.getByRole('button', { name: 'Workspace details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Workspace details' });
    await details.getByLabel('Workspace description', { exact: true }).fill(description);
    await details.getByRole('button', { name: 'Done', exact: true }).click();
    await expect
      .poll(
        async () => {
          const raw = await page.evaluate((key) => localStorage.getItem(key)!, storageKey);
          const saved = await decryptWorkspace(JSON.parse(raw)[0].envelope, password);
          return (saved as { description?: string }).description;
        },
        {
          timeout: 20000,
        },
      )
      .toBe(description);
    const stored = await page.evaluate((key) => localStorage.getItem(key)!, storageKey);
    expect(stored).not.toContain(description);
    expect(stored).not.toContain(password);
    const entries = JSON.parse(stored);
    expect(entries).toHaveLength(1);
    expect(entries[0].publicName).toBe(workspaceName);
    expect(await decryptWorkspace(entries[0].envelope, password)).toMatchObject({
      name: workspaceName,
      network: 'mainnet',
      description,
    });
    expect(encryptionWorkers(), 'save executes the bundled encryption worker').toBeGreaterThan(
      beforeSave,
    );

    step = 'WebGL initialization';
    const canvas = page.locator('.graph-stage canvas');
    await expect(canvas).toBeVisible();
    expect(
      await canvas.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return (
          canvas.getAttribute('data-smoke-webgl') === 'ready' &&
          canvas.width > 0 &&
          canvas.height > 0
        );
      }),
      'a live WebGL2 context backs the canvas',
    ).toBe(true);

    step = 'reload and worker unlock';
    await page.reload();
    const workerCount = encryptionWorkers();
    await page.locator('.saved-row').filter({ hasText: workspaceName }).click();
    const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
    await unlock.getByLabel('Password', { exact: true }).fill(password);
    await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Open workspaces' })).toContainText(
      workspaceName,
    );
    expect(encryptionWorkers(), 'unlock executes a fresh bundled worker').toBeGreaterThan(
      workerCount,
    );

    // Export confirms that the reopened browser session contains the saved data.
    step = 'encrypted export from reopened session';
    const downloadReady = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export encrypted workspace backup', exact: true })
      .click();
    const download = await downloadReady;
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const exported = await readFile(downloadedPath!, 'utf8');
    expect(exported).not.toContain(description);
    expect(exported).not.toContain(password);
    expect(await decryptWorkspace(JSON.parse(exported), password)).toMatchObject({
      id: entries[0].id,
      name: workspaceName,
      network: 'mainnet',
      description,
    });
    expect(unexpectedApiCalls, 'runtime smoke requires no chain lookup').toBe(0);
    expect(errors, 'production browser errors').toEqual([]);
    await context.tracing.stop();
    console.log(
      'Production runtime smoke passed: app boot, WebGL2 context, bundled encryption worker, encrypted save/reload/unlock/export. No live upstream or visual validation.',
    );
  } catch (error) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, 'failure.txt'), `${step}\n${String(error)}\n`);
    await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') }).catch(() => {});
    throw error;
  }
} catch {
  console.error(
    `Production runtime smoke failed at ${step}. Diagnostics: artifacts/production-smoke.`,
  );
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser.close();
}
