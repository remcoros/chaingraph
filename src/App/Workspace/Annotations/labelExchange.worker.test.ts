import { Worker as ThreadWorker } from 'node:worker_threads';
import { File } from 'node:buffer';
import { build } from 'esbuild';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import { PUBLIC_ZPUB } from '../../../../tests/fixtures/bitcoin';
import { walletEvidenceChanged } from '../../../Core/Workspace/Wallets/walletActivity';
import {
  defaultLabelImportOptions,
  inspectLabels,
  applyLabelImport,
} from '../../../Core/Workspace/Annotations/labels';
import {
  createImportPreview,
  inspectLabelFile,
  type LabelJob,
  type LabelJobResult,
} from './labelExchange';

let workerSource: string;
const threads: ThreadWorker[] = [];

beforeAll(async () => {
  // Execute the shipped entry point in a real worker thread. The bridge only
  // supplies the browser messaging surface; decoding and planning are real.
  const bundle = await build({
    entryPoints: ['src/App/Workspace/Annotations/labelExchange.worker.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    logLevel: 'silent',
  });
  workerSource = `const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: value => parentPort.postMessage(value) };
    ${bundle.outputFiles[0].text}
    parentPort.on('message', data => self.onmessage({ data }));`;
});

class EntryPointWorker {
  static latest: EntryPointWorker;
  onmessage?: (event: { data: LabelJobResult }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  readonly thread = new ThreadWorker(workerSource, { eval: true });
  terminate = vi.fn(() => void this.thread.terminate());
  constructor() {
    EntryPointWorker.latest = this;
    threads.push(this.thread);
    this.thread.on('message', (data: LabelJobResult) => this.onmessage?.({ data }));
    this.thread.on('error', () => this.onerror?.());
    this.thread.on('messageerror', () => this.onmessageerror?.());
  }
  postMessage(job: LabelJob) {
    this.thread.postMessage(job);
  }
}

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.terminate()));
  vi.unstubAllGlobals();
});

it('executes fatal UTF-8 decoding and network checks in the real worker entry point', async () => {
  vi.stubGlobal('Worker', EntryPointWorker);
  await expect(
    inspectLabelFile(
      new File([new Uint8Array([0xc3, 0x28])], 'invalid.jsonl') as globalThis.File,
      'mainnet',
      new AbortController().signal,
    ),
  ).rejects.toThrow('UTF-8');
  const content = JSON.stringify({
    type: 'addr',
    ref: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    label: 'Public reference',
  });
  const file = new File([content], 'public.jsonl') as globalThis.File;
  const mainnet = await inspectLabelFile(file, 'mainnet', new AbortController().signal);
  expect(mainnet.records).toHaveLength(1);
  const testnet = await inspectLabelFile(file, 'testnet4', new AbortController().signal);
  expect(testnet.records).toEqual([]);
  expect(testnet.issues[0].reason).toBe('wrong-network');
});

function workspace() {
  const value = createWorkspace('Worker identity fixture', 'mainnet');
  value.wallets.definitions = [
    {
      id: crypto.randomUUID(),
      name: 'Original wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#65cbbb',
      addresses: [],
    },
  ];
  value.annotations.entities[`tx:${'b'.repeat(64)}`] = {
    label: 'Unchanged',
    note: '',
    icon: '',
    bookmarked: false,
  };
  value.annotations.tags = [
    { id: crypto.randomUUID(), name: 'Unchanged', color: '#65cbbb', nodeIds: [] },
  ];
  return value;
}

it('preserves untouched wallet and annotation identities across the actual clone boundary', async () => {
  vi.stubGlobal('Worker', EntryPointWorker);
  const source = workspace();
  const inspection = inspectLabels(
    JSON.stringify({ type: 'tx', ref: 'a'.repeat(64), label: 'Imported' }),
    'mainnet',
  );
  const plan = await createImportPreview(
    source,
    inspection,
    defaultLabelImportOptions('mainnet'),
    new AbortController().signal,
  );
  const next = applyLabelImport(source, plan);
  expect(next.wallets).toBe(source.wallets);
  expect(next.annotations.tags).toBe(source.annotations.tags);
  expect(next.annotations.entities[`tx:${'b'.repeat(64)}`]).toBe(
    source.annotations.entities[`tx:${'b'.repeat(64)}`],
  );
  expect(next.annotations.entities[`tx:${'a'.repeat(64)}`].label).toBe('Imported');
  expect(walletEvidenceChanged(source.wallets.definitions, next.wallets.definitions)).toBe(false);
});

it('rebinds reviewed wallet names while retaining wallet evidence objects', async () => {
  vi.stubGlobal('Worker', EntryPointWorker);
  const source = workspace();
  const plan = await createImportPreview(
    source,
    inspectLabels(JSON.stringify({ type: 'xpub', ref: PUBLIC_ZPUB, label: 'Renamed' }), 'mainnet'),
    { ...defaultLabelImportOptions('mainnet'), renameWallets: true },
    new AbortController().signal,
  );
  const next = applyLabelImport(source, plan);
  expect(next.wallets.definitions[0].name).toBe('Renamed');
  expect(next.wallets.definitions[0].addresses).toBe(source.wallets.definitions[0].addresses);
  expect(walletEvidenceChanged(source.wallets.definitions, next.wallets.definitions)).toBe(true);
});

it('terminates the real worker when an inspection is cancelled', async () => {
  vi.stubGlobal('Worker', EntryPointWorker);
  const controller = new AbortController();
  const pending = inspectLabelFile(
    new File([''], 'cancelled.jsonl') as globalThis.File,
    'mainnet',
    controller.signal,
  );
  const worker = EntryPointWorker.latest;
  controller.abort(new Error('Review cancelled'));
  await expect(pending).rejects.toThrow('Review cancelled');
  expect(worker.terminate).toHaveBeenCalledOnce();
});
