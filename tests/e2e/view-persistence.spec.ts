import { expect, test, type Page } from '@playwright/test';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { buildGraph, newWorkspace } from '../../src/domain/workspace';
import { outputNodeId, type Workspace } from '../../src/domain/types';
import type { GraphSnapshot } from '../../src/domain/graphSnapshot';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

const password = 'public-view-persistence-fixture';
const storageKey = 'chaingraph.encrypted-workspaces.v1';
const selectedA = outputNodeId(TX_FUNDING, 0);
const selectedB = outputNodeId(TX_SPENDING, 1);
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
test.afterEach(({ page }) => expect(browserErrors.get(page) ?? []).toEqual([]));

function fixture(name: string, selectedId: string, cameraX: number): Workspace {
  const workspace = newWorkspace(name, 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.annotations[selectedId] = {
    label: `${name} output`,
    note: 'Public synthetic view fixture',
    icon: '',
    bookmarked: false,
  };
  workspace.view = {
    ...workspace.view,
    dimensions: 3,
    selectionId: selectedId,
    leftTab: 'entities',
    rightTab: 'inspect',
    mobilePanel: 'graph',
    filters: {},
    prefetchDepth: 1,
  };
  workspace.view.graphSnapshot = {
    version: 1,
    dimensions: 3,
    camera: {
      position: { x: cameraX, y: 240, z: 900 },
      target: { x: 10, y: 20, z: -5 },
      up: { x: 0, y: 1, z: 0 },
    },
    nodes: buildGraph(workspace)
      .nodes.map((node, index) => ({
        id: node.id,
        x: (index - 3) * 44,
        y: index % 2 ? 28 : -28,
        z: index * 21 - 60,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return workspace;
}

async function seed(page: Page, workspaces: Workspace[]) {
  const records = await Promise.all(
    workspaces.map(async (workspace) => ({
      id: workspace.id,
      publicName: workspace.name,
      savedAt: new Date().toISOString(),
      envelope: await encryptWorkspace(workspace, password),
    })),
  );
  await page.addInitScript(
    ({ records, storageKey }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      // Reload must exercise the application's newly saved envelope, not reseed it.
      if (!localStorage.getItem(storageKey))
        localStorage.setItem(storageKey, JSON.stringify(records));
    },
    { records, storageKey },
  );
  await mockBitcoin(page);
  await page.goto('/');
}

async function unlock(page: Page, name: string) {
  await page.locator('.saved-row').filter({ hasText: name }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.graph-canvas canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entities', exact: true })).toHaveClass(/active/);
}

async function saved(page: Page, id: string): Promise<Workspace> {
  const records = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  const record = records.find((entry: { id: string }) => entry.id === id);
  return (await decryptWorkspace(record.envelope, password)) as Workspace;
}

function expectCamera(actual: GraphSnapshot['camera'], expected: GraphSnapshot['camera']) {
  for (const vector of ['position', 'target', 'up'] as const)
    for (const axis of ['x', 'y', 'z'] as const)
      expect(Math.abs(actual[vector][axis] - expected[vector][axis])).toBeLessThan(0.02);
}

async function captureCurrentCamera(page: Page, id: string) {
  const canvas = page.locator('.graph-canvas canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  // A stationary gesture emits actual camera state via OrbitControls.end. No
  // engine globals or test-only runtime hooks are used to read the renderer.
  await page.mouse.move(bounds!.x + bounds!.width * 0.8, bounds!.y + bounds!.height * 0.75);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  // Let deferred initial layout/StrictMode effects and the save debounce complete.
  await page.waitForTimeout(1200);
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved');
  return (await saved(page, id)).view.graphSnapshot!;
}

test('restores camera, selection and filters when switching workspaces and reloading encrypted state', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const a = fixture('Saved path A', selectedA, 320);
  const b = fixture('Saved path B', selectedB, -410);
  await seed(page, [a, b]);
  await unlock(page, a.name);
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Saved path A output');
  expectCamera((await captureCurrentCamera(page, a.id)).camera, a.view.graphSnapshot!.camera);

  await page.getByLabel('Filter graph entities').fill('Saved path A');
  await expect(page.locator('.entity-browser .entity-row')).toHaveCount(1);
  await expect(page.locator('.entity-browser .entity-row')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await saved(page, a.id)).view.filters?.query).toBe('Saved path A');
  // Move the real camera so restoration must retain a user-produced snapshot.
  const box = (await page.locator('.graph-canvas canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6 + 65, box.y + box.height * 0.65 + 24, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const camera = (await saved(page, a.id)).view.graphSnapshot!.camera;
        return Math.abs(camera.position.x - a.view.graphSnapshot!.camera.position.x);
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(1);
  await expect(page.locator('.save-status')).toHaveText('Encrypted · saved');
  const changedCamera = (await saved(page, a.id)).view.graphSnapshot!.camera;

  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await unlock(page, b.name);
  await expect(page.getByLabel('Filter graph entities')).toHaveValue('');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Saved path B output');
  expectCamera((await captureCurrentCamera(page, b.id)).camera, b.view.graphSnapshot!.camera);
  await page.locator('.workspace-tab').filter({ hasText: a.name }).click();
  await expect(page.getByLabel('Filter graph entities')).toHaveValue('Saved path A');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Saved path A output');
  await expect(page.locator('.entity-browser .entity-row')).toHaveAttribute('aria-pressed', 'true');
  expectCamera((await captureCurrentCamera(page, a.id)).camera, changedCamera);

  await page.reload();
  await unlock(page, a.name);
  await expect(page.getByLabel('Filter graph entities')).toHaveValue('Saved path A');
  await expect(page.getByLabel('Node label', { exact: true })).toHaveValue('Saved path A output');
  await expect(page.locator('.entity-browser .entity-row')).toHaveAttribute('aria-pressed', 'true');
  expectCamera((await captureCurrentCamera(page, a.id)).camera, changedCamera);
  const restored = await saved(page, a.id);
  expect(restored.view.selectionId).toBe(selectedA);
  expect(restored.view.graphSnapshot!.nodes).toHaveLength(a.view.graphSnapshot!.nodes.length);
  const rawStorage = await page.evaluate((key) => localStorage.getItem(key)!, storageKey);
  expect(rawStorage).not.toContain(selectedA);
  expect(rawStorage).not.toContain('Public synthetic view fixture');
});

test('recovers a saved mode mismatch and persists the next settled mode through reload', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const workspace = fixture('Mode recovery', selectedA, 470);
  // Simulates closing between persisting a mode preference and the new layout settling.
  workspace.view.dimensions = 2;
  await seed(page, [workspace]);
  await unlock(page, workspace.name);
  await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveClass(/active/);
  await expect
    .poll(async () => (await saved(page, workspace.id)).view.graphSnapshot?.dimensions, {
      timeout: 15_000,
    })
    .toBe(2);
  const flat = await captureCurrentCamera(page, workspace.id);
  expect(flat.nodes.every((node) => node.z === 0)).toBe(true);
  expect(flat.camera.position.x).not.toBe(workspace.view.graphSnapshot!.camera.position.x);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect
    .poll(async () => (await saved(page, workspace.id)).view.graphSnapshot?.dimensions, {
      timeout: 15_000,
    })
    .toBe(3);
  const three = await captureCurrentCamera(page, workspace.id);
  await page.reload();
  await unlock(page, workspace.name);
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveClass(/active/);
  expectCamera((await captureCurrentCamera(page, workspace.id)).camera, three.camera);
});
