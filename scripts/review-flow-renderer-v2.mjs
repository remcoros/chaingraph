// Public bundled templates only. Run after browser suites, with preview already up.
// Baseline substitutes main's unchanged force adapter in this same checkout.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const output = process.argv.includes('--compact')
  ? 'artifacts/flow-renderer-v2/compact'
  : 'artifacts/flow-renderer-v2';
await mkdir(output, { recursive: true });
const baseline = process.argv.includes('--baseline');
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const executable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  readdirSync(cache)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort()
    .reverse()
    .map((n) => path.join(cache, n, 'chrome-linux64/chrome'))
    .find(existsSync);
let server;
if (baseline) {
  server = await createServer({
    envDir: false,
    cacheDir: 'artifacts/flow-renderer-v2/baseline-vite',
    optimizeDeps: { include: ['3d-force-graph'] },
    plugins: [
      {
        name: 'main-renderer-comparison',
        enforce: 'pre',
        transform(code, id) {
          if (id.endsWith('/graph/defaultAdapter.ts'))
            return "export { createForceAdapter as createDefaultAdapter } from './forceAdapter';";
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 4192,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false } },
    },
  });
  await server.listen();
}
const browser = await chromium.launch({
  executablePath: executable,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const cases = [
  ['mainnet-wabisabi', 'A large WabiSabi CoinJoin'],
  ['mainnet-equal-outputs', 'Whirlpool: five equal outputs'],
  ['mainnet-public-wallet', 'Explore a public demo wallet'],
  ['mainnet-large-value-path', 'Follow the largest output'],
  ['testnet4-spent-output', 'Follow an exact spent output'],
];
const observations = [];
try {
  for (const [id, name] of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
    await page.goto(baseline ? 'http://127.0.0.1:4192' : 'http://127.0.0.1:3116');
    await page.getByRole('button', { name: `Create ${name} workspace`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a workspace' });
    await dialog.getByLabel('Password', { exact: true }).fill('Public-renderer-review-2026');
    await dialog.getByLabel('Confirm password').fill('Public-renderer-review-2026');
    await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.locator('.graph-canvas canvas')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(baseline ? 7500 : 1600);
    await expect(page.locator('.save-status')).toHaveText('Encrypted · saved', { timeout: 30000 });
    if (id === 'mainnet-large-value-path')
      await page.getByLabel('Size nodes by').selectOption('value');
    if (!baseline) {
      await expect(page.getByLabel('Graph layout', { exact: true })).toHaveCount(0);
      const cameraControls = page.getByRole('group', { name: 'Graph camera and layout' });
      await expect(
        cameraControls.getByRole('button', { name: 'Fit graph', exact: true }),
      ).toBeVisible();
      await cameraControls.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await cameraControls.getByRole('button', { name: 'Zoom out', exact: true }).click();
      await cameraControls.getByRole('button', { name: 'Repack graph', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('canvas')).toHaveAttribute('aria-busy', 'false');
    }
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await page.waitForTimeout(baseline ? 700 : 200);
    const prefix = `${output}/${baseline ? 'main' : 'flow'}-${id}`;
    await page.screenshot({ path: `${prefix}-3d.png` });
    const gpu = await page.locator('canvas').evaluate((canvas) => {
      const gl = canvas.getContext('webgl2'),
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
    const counts = await page.locator('.statusbar').innerText();
    await page.getByRole('button', { name: 'Flat', exact: true }).click();
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await page.waitForTimeout(baseline ? 700 : 1000);
    await page.screenshot({ path: `${prefix}-flat.png` });
    if (!baseline) {
      await page.getByRole('button', { name: '3D', exact: true }).click();
      // Select a precise outpoint through the unchanged 2D flow, then edit its metadata.
      const buttons = await page
        .locator('.transaction-flow button')
        .evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')).filter(Boolean));
      const selectOutput = buttons.find((t) =>
        (id === 'testnet4-spent-output' ? /^Output 1:/ : /^Output 0:/).test(t),
      );
      expect(selectOutput).toBeTruthy();
      if (selectOutput) {
        await page.getByRole('button', { name: selectOutput, exact: true }).click();
      }
      await page.getByRole('button', { name: 'Center selection', exact: true }).click();
      await page.waitForTimeout(250);
      const ring = page.locator('.flow-node-ring.selected');
      await expect(ring).toBeVisible();
      const ringBounds = await ring.boundingBox();
      await page.mouse.click(
        ringBounds.x + ringBounds.width / 2,
        ringBounds.y + ringBounds.height / 2,
      );
      await page.mouse.move(
        ringBounds.x + ringBounds.width / 2 + 1,
        ringBounds.y + ringBounds.height / 2,
      );
      const card = page.getByRole('dialog', { name: 'Graph item details' });
      await expect(card).toBeVisible();
      await expect(
        card.getByRole('button', { name: 'Open creating transaction', exact: true }),
      ).toBeEnabled();
      await page.screenshot({ path: `${prefix}-hover-edit.png` });
      await card.getByRole('button', { name: 'Edit label and notes', exact: true }).click();
      await page.getByLabel('Node label', { exact: true }).fill(`Reviewed ${id}`);
      await page
        .getByLabel('Node notes', { exact: true })
        .fill('Public renderer review: follow this exact outpoint.');
      if (id === 'mainnet-public-wallet') {
        await page.getByRole('button', { name: /Node icon/ }).click();
        await page
          .getByRole('dialog', { name: 'Choose node icon' })
          .getByRole('button', { name: 'Star', exact: true })
          .click();
        await page.getByRole('button', { name: 'Add or choose tags', exact: true }).click();
        const tags = page.getByRole('dialog', { name: 'Choose tags' });
        await tags.getByLabel('Find or create tag').fill('Renderer review');
        await tags.getByLabel('Find or create tag').press('Enter');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('region', { name: 'Tags and wallet matches' })).toContainText(
          'Renderer review',
        );
        await expect(page.locator('.flow-node-caption.selected')).toContainText('★ Reviewed');
        for (const name of ['Show labels', 'Show tags', 'Show icons'])
          await page.getByRole('button', { name, exact: true }).click();
        await expect(page.locator('.flow-node-caption:visible')).toHaveCount(0);
        for (const name of ['Show labels', 'Show tags', 'Show icons'])
          await page.getByRole('button', { name, exact: true }).click();
        await page.getByRole('button', { name: 'Show address nodes', exact: true }).click();
        await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${prefix}-addresses.png` });
        await page.getByRole('button', { name: 'Show address nodes', exact: true }).click();
      }
      await page.getByLabel('Hide small amounts in graph', { exact: true }).selectOption('100000');
      await page.getByLabel('Hide small amounts in graph', { exact: true }).selectOption('0');
      await page.getByRole('button', { name: 'Lock to selection', exact: true }).click();
      await page.getByRole('button', { name: 'Center selection', exact: true }).click();
      await page.screenshot({ path: `${prefix}-selected.png` });
      await page.getByRole('button', { name: 'Entities', exact: true }).click();
      await page.getByLabel('Filter graph entities').fill(`Reviewed ${id}`);
      await page.locator('.entity-row').first().click();
      await expect(page.getByLabel('Node label', { exact: true })).toHaveValue(`Reviewed ${id}`);
      await page.getByLabel('Filter graph entities').fill('');
      await page
        .locator('.right-panel')
        .getByRole('button', { name: 'Hide entity from graph', exact: true })
        .click();
      await expect(
        page.locator('.right-panel').getByText('Hidden from graph', { exact: true }),
      ).toBeVisible();
      await page
        .locator('.right-panel')
        .getByRole('button', { name: 'Show and center', exact: true })
        .click();
      const bounds = await page.locator('canvas').boundingBox();
      await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7);
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width * 0.7 - 55,
        bounds.y + bounds.height * 0.7 - 25,
        { steps: 10 },
      );
      await page.mouse.up();
      await page.mouse.wheel(0, -140);
      await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
      await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
      await page.locator('.saved-row').filter({ hasText: name }).click();
      const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
      await unlock.getByLabel('Password', { exact: true }).fill('Public-renderer-review-2026');
      await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
      await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
        'Public renderer review: follow this exact outpoint.',
      );
      await expect(page.locator('canvas')).toBeVisible();
      await expect(page.getByLabel('Graph layout', { exact: true })).toHaveCount(0);
      if (id === 'testnet4-spent-output') {
        const hops = page.locator('.transaction-flow button[aria-label^="Go to"]');
        const names = await hops.evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')));
        console.log('Loaded hop actions:', JSON.stringify(names));
        if (await hops.count()) {
          await hops.first().click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${prefix}-hop.png` });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .locator('.mobile-switch')
          .getByRole('button', { name: 'Graph', exact: true })
          .click();
        await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
        await page.screenshot({ path: `${prefix}-mobile.png` });
      }
    }
    observations.push({ id, renderer: baseline ? 'main force' : 'flow v2', counts, gpu, errors });
    console.log(id, errors.length ? 'ERRORS' : 'reviewed');
    expect(errors).toEqual([]);
    await context.close();
  }
  if (process.argv.includes('--compact') && !baseline) {
    const sections = cases
      .map(
        ([id, name]) =>
          `<section><h2>${name}</h2><div class="compare">${[
            ['Compact', `flow-${id}-3d.png`],
            ['Previous Compact', `../layouts/flow-${id}-3d.png`],
            ['Main force baseline', `../main-${id}-3d.png`],
          ]
            .map(
              ([label, file]) =>
                `<figure><figcaption>${label}</figcaption><a href="${file}"><img src="${file}" alt="${label}: ${name}" loading="lazy"></a></figure>`,
            )
            .join(
              '',
            )}</div><p><a href="flow-${id}-flat.png">Compact Flat</a> · <a href="flow-${id}-selected.png">Selected output</a> · <a href="flow-${id}-hover-edit.png">Shared editing card</a></p></section>`,
      )
      .join('');
    await writeFile(
      `${output}/index.html`,
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chaingraph layout review</title><style>body{background:#131b20;color:#dce7e2;font:15px system-ui;margin:24px}a{color:#a9d878}h1{font-size:24px}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0}figcaption{padding:8px 0}img{width:100%}section{margin:30px 0}@media(max-width:850px){.compare{grid-template-columns:1fr}}</style><h1>Compact graph and navigation</h1><p>Public bundled snapshots. Previous Compact and main baselines were captured during earlier renderer reviews. Chromium software WebGL; no physical GPU performance claim. Click images to inspect full size.</p>${sections}</html>`,
    );
  }
  await writeFile(
    `${output}/${baseline ? 'main' : 'flow'}-observations.json`,
    JSON.stringify(observations, null, 2),
  );
} finally {
  await browser.close();
  await server?.close();
}
