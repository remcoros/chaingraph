import { describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../src/App/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/App/Workspace/Persistence/Format';
import {
  decryptWorkspace,
  encryptWorkspace,
} from '../../../src/App/Workspace/Persistence/Encryption/encryptedEnvelope';
import { createBrowserWorkspaceStore } from '../../../src/App/createWorkspaceStore';
import {
  DEFAULT_SCAN_SETTINGS,
  type ScanRun,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScan';
import {
  addScanPath,
  replaceScanRun,
  clearScanRuns,
  prepareScanPath,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanRecords';
import type { Transaction } from '../../../src/Domain/Chain/transaction';

const password = 'public scheduling fixture password';
function fixture(encrypt?: typeof encryptWorkspace) {
  let raw: string | null = null;
  const store = createBrowserWorkspaceStore({
    storage: {
      getItem: () => raw,
      setItem: (_key, value) => {
        raw = value;
      },
    },
    encrypt,
  });
  const workspace = createWorkspace('Gesture fixture', 'mainnet');
  store.open(workspace, password);
  return { store, id: workspace.id, raw: () => raw };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('encrypted save scheduling around graph interaction', () => {
  it('defers pending autosave and captures edits made during the gesture', async () => {
    const encrypt = vi.fn(encryptWorkspace);
    const { store, id, raw } = fixture(encrypt);
    store.pauseAutosave(id, true);
    const pending = store.persist(id, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(encrypt).not.toHaveBeenCalled();
    store.update(id, (w) => ({ ...w, description: 'Latest note during drag' }));
    store.pauseAutosave(id, false);
    await pending;
    await store.persist(id);
    expect(encrypt).toHaveBeenCalledTimes(1);
    expect(await decryptWorkspace(JSON.parse(raw()!)[0].envelope, password)).toMatchObject({
      description: 'Latest note during drag',
    });
  });

  it('defers an already encrypted autosave publication until idle and preserves newer edits', async () => {
    const encrypted = deferred();
    const release = deferred();
    const encrypt = vi.fn(async (data: unknown, key: string) => {
      const result = await encryptWorkspace(data, key);
      if (encrypt.mock.calls.length === 1) {
        encrypted.resolve();
        await release.promise;
      }
      return result;
    });
    const { store, id, raw } = fixture(encrypt);
    const pending = store.persist(id, true);
    await encrypted.promise;
    store.pauseAutosave(id, true);
    store.update(id, (w) => ({ ...w, description: 'Edit while prior save finishes' }));
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(raw()).toBeNull();
    store.pauseAutosave(id, false);
    await pending;
    await store.persist(id);
    const session = store.getUnlocked(id)!;
    expect(session.savedRevision).toBe(session.revision);
    expect(await decryptWorkspace(JSON.parse(raw()!)[0].envelope, password)).toMatchObject({
      description: 'Edit while prior save finishes',
    });
  });

  it('explicit lock releases a paused save queue and stores the latest synchronous state', async () => {
    const { store, id, raw } = fixture();
    const oldScope = store.getUnlocked(id)!.fetchScope;
    store.pauseAutosave(id, true);
    void store.persist(id, true);
    store.update(id, (w) => ({ ...w, view: { ...w.view, glow: false } }), false);
    await store.lock(id);
    expect(store.getUnlocked(id)).toBeUndefined();
    expect(oldScope.closed).toBe(true);
    expect(oldScope.jobs.size).toBe(0);
    expect(await decryptWorkspace(JSON.parse(raw()!)[0].envelope, password)).toMatchObject({
      view: { glow: false },
    });
  });

  it('exports the current session after synchronous view capture without marking it saved', async () => {
    const { store, id } = fixture();
    const old = store.getUnlocked(id)!;
    store.pauseAutosave(id, true);
    store.update(
      id,
      (w) => ({ ...w, name: 'Latest export', view: { ...w.view, glow: false } }),
      false,
    );
    const result = await store.exportEncrypted(id);
    expect(result.name).toBe('Latest export');
    expect(old.data.view.glow).not.toBe(false);
    expect(await decryptWorkspace(JSON.parse(result.contents), password)).toMatchObject({
      name: 'Latest export',
      view: { glow: false },
    });
    expect(store.getUnlocked(id)!.revision).not.toBe(store.getUnlocked(id)!.savedRevision);
  });
});

describe('retained scan results across graph Undo', () => {
  const txid = (n: number) => n.toString(16).padStart(64, '0');
  const node = (n: number) => `tx:${txid(n)}`;
  const output = (n: number) => `out:${txid(n)}:0`;
  const transaction = (n: number, parent?: number): Transaction => ({
    txid: txid(n),
    vin: parent === undefined ? [{ coinbase: '00' }] : [{ txid: txid(parent), vout: 0 }],
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  });
  function scanFixture() {
    const { store, id } = fixture();
    store.update(
      id,
      (w) => ({
        ...w,
        transactions: { [txid(1)]: transaction(1) },
        view: { ...w.view, graphNodeIds: [node(1)] },
      }),
      false,
    );
    const run: ScanRun = {
      id: 'public-run',
      source: node(1),
      targetIds: [node(2)],
      settings: { ...DEFAULT_SCAN_SETTINGS },
      startedAt: '2026-09-10T12:00:00.000Z',
      status: 'complete',
      examined: 2,
      stopReasons: [],
      results: [
        {
          id: 'public-run:1',
          kind: 'connection',
          relationship: 'direct',
          endpoint: node(2),
          path: [node(1), output(1), node(2)],
          directions: ['downstream', 'downstream'],
          hops: 1,
        },
      ],
    };
    const evidence = { [txid(2)]: transaction(2, 1) };
    store.update(id, (w) => replaceScanRun(w, run, evidence), false);
    return { store, id, run, evidence };
  }

  it('keeps a dismissed path usable after adding it and undoing the graph action', () => {
    const { store, id, run, evidence } = scanFixture();
    const result = run.results[0];
    store.update(id, (w) => addScanPath(w, result));
    expect(store.getUnlocked(id)!.data.connectionScans!.evidence).toEqual({});
    store.update(
      id,
      (w) => replaceScanRun(w, { ...run, results: [{ ...result, dismissed: true }] }, evidence),
      false,
    );
    store.undo(id);
    const restored = store.getUnlocked(id)!.data;
    expect(restored.transactions[txid(2)]).toBeUndefined();
    expect(restored.connectionScans!.runs[0].results[0].dismissed).toBe(true);
    expect(prepareScanPath(restored, result).missingTxids).toEqual([]);
    expect(addScanPath(restored, result).view.graphNodeIds).toContain(node(2));
    expect(() => parseWorkspace(restored)).not.toThrow();
  });

  it('retains the creator proof of a timestamped outpoint endpoint after Add and Undo', () => {
    const { store, id } = fixture();
    const point = output(1);
    store.update(
      id,
      (w) => ({
        ...w,
        transactions: { [txid(2)]: transaction(2, 1) },
        view: { ...w.view, graphNodeIds: [point] },
      }),
      false,
    );
    const run: ScanRun = {
      id: 'public-endpoint',
      source: point,
      targetIds: [],
      settings: { ...DEFAULT_SCAN_SETTINGS },
      startedAt: '2026-09-10T12:00:00.000Z',
      status: 'complete',
      examined: 1,
      stopReasons: [],
      results: [
        {
          id: 'public-endpoint:1',
          kind: 'endpoint',
          finding: 'unspent',
          scanDirection: 'downstream',
          endpoint: point,
          path: [point],
          directions: [],
          hops: 0,
          checkedAt: '2026-09-10T12:00:01.000Z',
          bestBlock: txid(99),
          includesMempool: true,
        },
      ],
    };
    const evidence = { [txid(1)]: transaction(1) };
    store.update(id, (w) => replaceScanRun(w, run, evidence), false);
    store.update(id, (w) => addScanPath(w, run.results[0]));
    store.update(
      id,
      (w) =>
        replaceScanRun(w, { ...run, results: [{ ...run.results[0], dismissed: true }] }, evidence),
      false,
    );
    store.undo(id);
    const restored = store.getUnlocked(id)!.data;
    expect(restored.transactions[txid(1)]).toBeUndefined();
    expect(restored.connectionScans!.evidence[txid(1)]).toEqual(evidence[txid(1)]);
    expect(prepareScanPath(restored, run.results[0]).missingTxids).toEqual([]);
    expect(() => parseWorkspace(restored)).not.toThrow();
  });

  it('keeps accumulated results and clear current through older user-edit Undo', () => {
    const { store, id, run } = scanFixture();
    store.update(id, (w) => ({ ...w, description: 'Public annotation' }));
    const latest = { ...run, id: 'latest-run', results: [] };
    store.update(id, (w) => replaceScanRun(w, latest), false);
    store.undo(id);
    expect(store.getUnlocked(id)!.data.connectionScans!.runs).toEqual([run, latest]);
    store.update(id, (w) => ({ ...w, description: 'Another public annotation' }));
    store.update(id, clearScanRuns, false);
    store.undo(id);
    expect(store.getUnlocked(id)!.data.connectionScans).toBeUndefined();
  });

  it('bounds snapshot proof and reports missing evidence when the path pool is larger', () => {
    const { store, id, run } = scanFixture();
    const transactions: Record<string, Transaction> = { [txid(1)]: transaction(1) };
    const results = Array.from({ length: 50 }, (_, i) => {
      const path = [node(1)];
      let parent = 1;
      for (let step = 0; step < 5; step++) {
        const next = 10 + i * 5 + step;
        transactions[txid(next)] = transaction(next, parent);
        path.push(output(parent), node(next));
        parent = next;
      }
      return {
        id: `bounded:${i}`,
        kind: 'boundary' as const,
        reason: 'fan-out' as const,
        endpoint: path.at(-1)!,
        path,
        directions: Array<'downstream'>(10).fill('downstream'),
        hops: 5,
      };
    });
    store.update(id, (w) => ({ ...w, transactions }));
    store.update(
      id,
      (w) =>
        replaceScanRun(w, {
          ...run,
          settings: { ...run.settings, maxHops: 8, maxTransactions: 1000 },
          results,
        }),
      false,
    );
    store.undo(id);
    const restored = store.getUnlocked(id)!.data;
    expect(Object.keys(restored.connectionScans!.evidence)).toHaveLength(200);
    expect(prepareScanPath(restored, results[0]).missingTxids).toEqual([]);
    expect(prepareScanPath(restored, results.at(-1)!).missingTxids.length).toBeGreaterThan(0);
    expect(() => parseWorkspace(restored)).not.toThrow();
  });
});
