import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { address, networks } from 'bitcoinjs-lib';
import { decryptWorkspace, encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace, parseWorkspace } from '../../src/domain/workspace';
import type { Workspace } from '../../src/domain/types';
import { mockBitcoin } from '../fixtures/bitcoin';

const password = 'public-dense-autosave-fixture';
const txid = (index: number) => (index + 1).toString(16).padStart(64, '0');
interface Probe {
  jobs: { type: string; time: number }[];
  snapshotStrings: number;
  gestureEvents: { type: string; time: number }[];
  snapshotTimes: number[];
  longTasks: { time: number; duration: number }[];
  beats: number;
  failNextEncryption: boolean;
}

function denseWorkspace(count: number): Workspace {
  const workspace = newWorkspace('Public dense autosave performance fixture', 'mainnet');
  const perTransaction = Math.min(1500, count);
  for (let index = 0; index < count; index++) {
    const transactionId = txid(Math.floor(index / perTransaction));
    const transaction = (workspace.transactions[transactionId] ??= {
      txid: transactionId,
      vin: [{ coinbase: '00' }],
      vout: [],
      confirmations: 100,
    });
    const hex = `0014${(index + 1).toString(16).padStart(40, '0')}`;
    transaction.vout.push({
      n: transaction.vout.length,
      value: (100000 + index) / 100000000,
      scriptPubKey: {
        hex,
        address: address.fromOutputScript(Buffer.from(hex, 'hex'), networks.bitcoin),
        type: 'witness_v0_keyhash',
      },
    });
  }
  // Retain 15,000 output/script/address observations while displaying a dense
  // 1,501-node subgraph. This isolates persistence cost from a 30,000-node GPU test
  // and keeps the encrypted snapshot within Chromium's localStorage quota.
  const ids = [
    `tx:${txid(0)}`,
    ...workspace.transactions[txid(0)].vout.map((out) => `out:${txid(0)}:${out.n}`),
  ];
  workspace.view.dimensions = 2;
  workspace.view.selectionId = ids[0];
  workspace.view.filters = { includeIds: ids };
  workspace.view.transactionFlow = { open: false, transactionId: txid(0) };
  workspace.view.showLabels = false;
  workspace.view.showTags = false;
  workspace.view.showIcons = false;
  workspace.view.glow = false;
  workspace.view.graphSnapshot = {
    version: 1,
    dimensions: 2,
    camera: {
      position: { x: 0, y: 0, z: 1800 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    nodes: ids.map((id, index) => ({
      id,
      x: (index % 50) * 20 - 500,
      y: Math.floor(index / 50) * 20 - 300,
      z: 0,
    })),
  };
  return parseWorkspace(workspace);
}

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = {
      jobs: [],
      snapshotStrings: 0,
      gestureEvents: [],
      snapshotTimes: [],
      longTasks: [],
      beats: 0,
      failNextEncryption: false,
    };
    (window as unknown as { __graphAutosaveProbe: Probe }).__graphAutosaveProbe = probe;
    const postMessage = Worker.prototype.postMessage;
    Object.defineProperty(Worker.prototype, 'postMessage', {
      value: function (this: Worker, message: unknown, ...rest: unknown[]) {
        const type =
          message && typeof message === 'object' && 'type' in message ? String(message.type) : '';
        // Observe the operation name only. Never copy workspace/password payloads.
        probe.jobs.push({ type, time: performance.now() });
        if (type === 'encrypt-workspace' && probe.failNextEncryption) {
          probe.failNextEncryption = false;
          queueMicrotask(() =>
            this.dispatchEvent(
              new ErrorEvent('error', { message: 'Public injected worker implementation detail' }),
            ),
          );
          return;
        }
        return Reflect.apply(postMessage, this, [message, ...rest]);
      },
    });
    for (const type of ['wheel', 'pointerdown', 'pointerup']) {
      document.addEventListener(
        type,
        (event) => {
          if (event.target instanceof Element && event.target.closest('.graph-canvas'))
            probe.gestureEvents.push({ type, time: performance.now() });
        },
        { capture: true, passive: true },
      );
    }
    const stringify = JSON.stringify;
    Object.defineProperty(JSON, 'stringify', {
      value: function (value: unknown, ...rest: unknown[]) {
        if (
          value &&
          typeof value === 'object' &&
          'camera' in value &&
          'nodes' in value &&
          'dimensions' in value
        ) {
          probe.snapshotStrings++;
          probe.snapshotTimes.push(performance.now());
        }
        return Reflect.apply(stringify, JSON, [value, ...rest]);
      },
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        probe.longTasks.push({ time: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: false });
    setInterval(() => probe.beats++, 25);
  });
}

async function openFixture(page: Page, workspace: Workspace) {
  await installProbe(page);
  const envelope = await encryptWorkspace(workspace, password);
  expect(JSON.stringify(envelope).length).toBeLessThan(4.8 * 1024 * 1024);
  await page.addInitScript(
    ({ id, publicName, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      if (!localStorage.getItem('chaingraph.encrypted-workspaces.v1'))
        localStorage.setItem(
          'chaingraph.encrypted-workspaces.v1',
          JSON.stringify([{ id, publicName, savedAt: new Date().toISOString(), envelope }]),
        );
    },
    { id: workspace.id, publicName: workspace.name, envelope },
  );
  await mockBitcoin(page, false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.locator('.graph-canvas canvas')).toBeVisible({ timeout: 45000 });
  // Let force-layout cooling and the initial save finish before measuring input.
  await page.waitForTimeout(7500);
  await expect(page.locator('.save-status')).toContainText('Encrypted · saved', { timeout: 45000 });
}

async function probe(page: Page) {
  return page.evaluate(() =>
    structuredClone((window as unknown as { __graphAutosaveProbe: Probe }).__graphAutosaveProbe),
  );
}

async function resetProbe(page: Page) {
  await page.evaluate(() => {
    const probe = (window as unknown as { __graphAutosaveProbe: Probe }).__graphAutosaveProbe;
    probe.jobs = [];
    probe.snapshotStrings = 0;
    probe.snapshotTimes = [];
    probe.gestureEvents = [];
    probe.longTasks = [];
    probe.beats = 0;
  });
}

async function savedWorkspace(page: Page) {
  const envelope = await page.evaluate(async () => {
    const entry = JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1')!)[0];
    if (entry.envelope) return entry.envelope;
    if (!entry.envelopeRef) throw new Error('Fixture encrypted payload is missing');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chaingraph.encrypted-envelopes.v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Fixture encrypted storage did not open'));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction('envelopes', 'readonly');
        const request = transaction.objectStore('envelopes').get(entry.envelopeRef);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(new Error('Fixture encrypted payload read failed'));
      });
    } finally {
      database.close();
    }
  });
  return parseWorkspace(await decryptWorkspace(envelope, password));
}

async function graphPoint(page: Page) {
  const box = (await page.locator('.graph-canvas canvas').boundingBox())!;
  return { x: box.x + box.width * 0.8, y: box.y + box.height * 0.72 };
}

async function lock(page: Page) {
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
}

test('dense graph gestures defer snapshot serialization and encryption, then export and lock flush the latest camera', async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const workspace = denseWorkspace(15000);
  expect(JSON.stringify(workspace).length).toBeGreaterThan(2 * 1024 * 1024);
  await openFixture(page, workspace);
  // Geometry lookup can take longer than the autosave debounce on a loaded
  // software renderer. Position the pointer before creating the dirty note.
  const point = await graphPoint(page);
  await page.mouse.move(point.x, point.y);
  await resetProbe(page);
  await page
    .getByLabel('Node notes', { exact: true })
    .fill('Pending note survives continuous graph navigation.');
  // Dispatch synthetic DOM wheel events through the real OrbitControls handler.
  // Browser scheduling preserves continuous input even when CDP round trips on
  // SwiftShader take longer than the quiet interval.
  const afterWheel = await page.evaluate(async ({ x, y }) => {
    const canvas = document.querySelector('.graph-canvas canvas')!;
    const state = (window as unknown as { __graphAutosaveProbe: Probe }).__graphAutosaveProbe;
    const dispatch = () =>
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 16,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
    dispatch();
    return await new Promise<Probe>((resolve) => {
      const timer = setInterval(dispatch, 80);
      setTimeout(() => {
        clearInterval(timer);
        resolve(structuredClone(state));
      }, 2400);
    });
  }, point);
  const wheelEvents = afterWheel.gestureEvents.filter((event) => event.type === 'wheel');
  expect(wheelEvents.length).toBeGreaterThanOrEqual(4);
  const gestureStart = wheelEvents[0].time;
  const wheelGaps = wheelEvents
    .slice(1)
    .map((event, index) => event.time - wheelEvents[index].time);
  expect(Math.max(...wheelGaps)).toBeLessThan(1000);
  const duringGesture = (time: number) => time >= gestureStart;
  expect(
    afterWheel.jobs.filter((job) => job.type === 'encrypt-workspace' && duringGesture(job.time)),
  ).toHaveLength(0);
  expect(afterWheel.snapshotTimes.filter(duringGesture)).toHaveLength(0);
  await page.mouse.down();
  const dragStarted = Date.now();
  let step = 0;
  while (Date.now() - dragStarted < 2400) {
    await page.mouse.move(point.x + Math.sin(step / 3) * 32, point.y + Math.cos(step / 3) * 24);
    step++;
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  const active = await probe(page);
  const dragBegin = [...active.gestureEvents]
    .reverse()
    .find((event) => event.type === 'pointerdown')!.time;
  const dragEnd = [...active.gestureEvents]
    .reverse()
    .find((event) => event.type === 'pointerup')!.time;
  expect(dragEnd - dragBegin).toBeGreaterThan(2000);
  const whileDragging = (time: number) => time >= dragBegin && time <= dragEnd;
  expect(
    active.jobs.filter((job) => job.type === 'encrypt-workspace' && whileDragging(job.time)),
  ).toHaveLength(0);
  expect(active.snapshotTimes.filter(whileDragging)).toHaveLength(0);
  expect(active.beats).toBeGreaterThan(10);
  // A generous stall bound detects the reported multi-second UI freeze without
  // treating software-rendered frame rate as a hardware-independent benchmark.
  expect(Math.max(0, ...active.longTasks.map((entry) => entry.duration))).toBeLessThan(1500);
  await expect
    .poll(
      async () =>
        (await probe(page)).jobs.filter(
          (job) => job.type === 'encrypt-workspace' && job.time > dragEnd,
        ).length,
    )
    .toBeGreaterThan(0);
  const firstIdleJob = (await probe(page)).jobs.find(
    (job) => job.type === 'encrypt-workspace' && job.time > dragEnd,
  )!;
  expect(firstIdleJob.time - dragEnd).toBeGreaterThanOrEqual(1000);
  await expect(page.locator('.save-status')).toContainText('Encrypted · saved', { timeout: 45000 });
  const afterIdle = await savedWorkspace(page);
  expect(afterIdle.annotations[`tx:${txid(0)}`].note).toBe(
    'Pending note survives continuous graph navigation.',
  );
  const beforeExport = afterIdle.view.graphSnapshot!.camera;
  const nextPoint = await graphPoint(page);
  await page.mouse.move(nextPoint.x, nextPoint.y);
  await page.mouse.wheel(0, -350);
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export encrypted workspace backup', exact: true })
    .click();
  const download = await downloading;
  const exported = parseWorkspace(
    await decryptWorkspace(JSON.parse(await readFile((await download.path())!, 'utf8')), password),
  );
  expect(exported.view.graphSnapshot!.camera).not.toEqual(beforeExport);
  expect(exported.annotations[`tx:${txid(0)}`].note).toBe(
    afterIdle.annotations[`tx:${txid(0)}`].note,
  );
  await page.mouse.move(nextPoint.x, nextPoint.y);
  await page.mouse.wheel(0, 240);
  await lock(page);
  await expect(page.locator('.saved-row')).toBeVisible();
  const locked = await savedWorkspace(page);
  expect(locked.view.graphSnapshot!.camera).not.toEqual(exported.view.graphSnapshot!.camera);
  expect(locked.annotations[`tx:${txid(0)}`].note).toBe(
    afterIdle.annotations[`tx:${txid(0)}`].note,
  );
  const observationPath = info.outputPath('main-thread-gesture-observations.json');
  await writeFile(
    observationPath,
    JSON.stringify(
      {
        observations: 15000,
        renderedNodes: 1501,
        gestureBeats: active.beats,
        gestureLongTasks: active.longTasks.filter((task) => duringGesture(task.time)),
        gestureEvents: active.gestureEvents,
        wheelGaps,
        dragDuration: dragEnd - dragBegin,
        encryptJobsDuringGestures: 0,
      },
      null,
      2,
    ),
  );
  await info.attach('main-thread-gesture-observations.json', {
    path: observationPath,
    contentType: 'application/json',
  });
});

test('an encryption worker failure leaves edits unlocked and a subsequent lock retries safely', async ({
  page,
}) => {
  test.setTimeout(90000);
  await openFixture(page, denseWorkspace(40));
  await page.evaluate(() => {
    (window as unknown as { __graphAutosaveProbe: Probe }).__graphAutosaveProbe.failNextEncryption =
      true;
  });
  await page
    .getByLabel('Node notes', { exact: true })
    .fill('Retain this public note after an encryption failure.');
  await lock(page);
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /encryption|encrypt|save|worker/i })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(
    'Retain this public note after an encryption failure.',
  );
  await expect(page.locator('body')).not.toContainText(
    'Public injected worker implementation detail',
  );
  await lock(page);
  await expect(page.locator('.saved-row')).toBeVisible();
  expect((await savedWorkspace(page)).annotations[`tx:${txid(0)}`].note).toBe(
    'Retain this public note after an encryption failure.',
  );
});
