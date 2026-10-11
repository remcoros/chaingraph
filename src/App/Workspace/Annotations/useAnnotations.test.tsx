// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../Core/Workspace/Persistence';
import type { Workspace } from '../../../Core/Workspace/workspace';
import { PUBLIC_ZPUB } from '../../../../tests/fixtures/bitcoin';
import { useAnnotations } from './useAnnotations';
import { download } from '../../../Core/Browser/download';
import { inspectLabelFile } from './labelExchange';

// Exercise hook lifetime and mutation wiring with the real Core rules. Worker
// transport has separate cancellation and snapshot tests in labelExchange.test.
vi.mock('./labelExchange', async () => {
  const core = await import('../../../Core/Workspace/Annotations/labels');
  return {
    inspectLabelFile: vi.fn(async (file: File, network: Workspace['network']) =>
      core.inspectLabels(
        new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
        network,
      ),
    ),
    createImportPreview: vi.fn(async (...args: Parameters<typeof core.planLabelImport>) =>
      core.planLabelImport(...args),
    ),
    createExportPreview: vi.fn(async (...args: Parameters<typeof core.planLabelExport>) =>
      core.planLabelExport(...args),
    ),
  };
});
vi.mock('../../../Core/Browser/download', () => ({ download: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fixture() {
  let current = createWorkspace('Metadata fixture', 'mainnet');
  const edit = vi.fn((update: (workspace: Workspace) => Workspace) => {
    current = update(current);
  });
  const view = renderHook(() =>
    useAnnotations({
      current,
      edit,
      setError: vi.fn(),
      setNotice: vi.fn(),
      sessions: {
        saved: [],
        unlocked: [],
        storageError: '',
        saving: false,
        active: undefined,
        getUnlocked: vi.fn(),
        getSaved: vi.fn(),
        setActiveId: vi.fn(),
        open: vi.fn(),
        unlock: vi.fn(),
        exportEncrypted: vi.fn(),
        removeSaved: vi.fn(),
      },
    }),
  );
  return {
    view,
    edit,
    get current() {
      return current;
    },
    setCurrent(workspace: Workspace) {
      current = workspace;
      view.rerender();
    },
  };
}
function file(content: string): File {
  const result = new File([content], 'public-labels.jsonl');
  Object.defineProperty(result, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(content).buffer,
  });
  return result;
}

it('reviews a 255-unit equivalent-key label, then applies once with explicit wallet rename', async () => {
  const f = fixture();
  f.current.wallets.definitions.push({
    id: crypto.randomUUID(),
    name: 'Previous name',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#aabbcc',
    addresses: [],
  });
  const label = 'é'.repeat(255);
  act(() => f.view.result.current.openLabelImport());
  await act(() =>
    f.view.result.current.importLabelFile(
      file(JSON.stringify({ type: 'xpub', ref: PUBLIC_ZPUB, label })),
    ),
  );
  await waitFor(() => expect(f.view.result.current.importPlan?.changes).toHaveLength(1));
  expect(f.edit).not.toHaveBeenCalled();
  expect(f.current.annotations.entities).toEqual({});
  act(() => f.view.result.current.configureLabelImport({ renameWallets: true }));
  await waitFor(() => expect(f.view.result.current.importPlan?.changes).toHaveLength(2));
  act(() => f.view.result.current.confirmLabelImport());
  expect(f.edit).toHaveBeenCalledTimes(1);
  const saved = parseWorkspace(f.current);
  expect(saved.annotations.entities[`xpub:${PUBLIC_ZPUB}`].label).toBe(label);
  expect(saved.wallets.definitions[0].name).toBe(label);
  expect(f.view.result.current.labelTransfer).toBeUndefined();
});

it('drops a late file result after cancellation and never edits another workspace', async () => {
  const f = fixture();
  let finish: ((inspection: Awaited<ReturnType<typeof inspectLabelFile>>) => void) | undefined;
  vi.mocked(inspectLabelFile).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => f.view.result.current.openLabelImport());
  let pending: Promise<void>;
  act(() => {
    pending = f.view.result.current.importLabelFile(file(''));
  });
  act(() => f.view.result.current.closeLabelTransfer());
  f.setCurrent(createWorkspace('Second fixture', 'testnet4'));
  await act(async () => {
    finish!({
      network: 'mainnet',
      recordCount: 0,
      records: [],
      issues: [],
      origins: [],
      ignoredFields: [],
    });
    await pending;
  });
  expect(f.view.result.current.labelTransfer).toBeUndefined();
  expect(f.edit).not.toHaveBeenCalled();
});

it('opens an export preview before download and keeps key labels opt-in', async () => {
  const f = fixture(),
    txid = 'a'.repeat(64);
  f.current.annotations.entities[`tx:${txid}`] = {
    label: 'Example',
    note: 'Note',
    icon: '★',
    bookmarked: true,
  };
  act(() => f.view.result.current.openLabelExport());
  await waitFor(() => expect(f.view.result.current.exportPlan?.recordCount).toBe(1));
  expect(download).not.toHaveBeenCalled();
  act(() => f.view.result.current.downloadLabelExport());
  expect(download).toHaveBeenCalledWith(
    'labels-generic.jsonl',
    JSON.stringify({ type: 'tx', ref: txid, label: 'Example' }),
    'application/x-ndjson',
  );
});

it('refreshes a preview after native metadata changes and keeps rejected files unapplied', async () => {
  const f = fixture(),
    txid = 'a'.repeat(64);
  act(() => f.view.result.current.openLabelImport());
  await act(() =>
    f.view.result.current.importLabelFile(
      file(JSON.stringify({ type: 'tx', ref: txid, label: 'Incoming' })),
    ),
  );
  await waitFor(() => expect(f.view.result.current.importPlan?.changes).toHaveLength(1));
  f.setCurrent({
    ...f.current,
    annotations: {
      ...f.current.annotations,
      entities: {
        [`tx:${txid}`]: { label: 'Concurrent annotation', note: '', icon: '', bookmarked: false },
      },
    },
  });
  await waitFor(() => expect(f.view.result.current.importPlan?.changes).toHaveLength(0));
  const oversized = file('small');
  Object.defineProperty(oversized, 'size', { value: 5_000_001 });
  await act(() => f.view.result.current.importLabelFile(oversized));
  expect(
    f.view.result.current.labelTransfer?.kind === 'import' &&
      f.view.result.current.labelTransfer.failure,
  ).toContain('5 MB');
  expect(f.view.result.current.importPlan).toBeUndefined();
  expect(f.edit).not.toHaveBeenCalled();
});
