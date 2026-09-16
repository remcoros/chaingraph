import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  type ScanRun,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScan';
import {
  addScanPath,
  clearScanRuns,
  prepareScanPath,
  replaceScanRun,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanRecords';
import type { Transaction } from '../../../src/Domain/Chain/transaction';
import { clearContextProvenance } from '../../../src/App/Workspace/Evidence/InputContext';
import { createWorkspace } from '../../../src/App/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/App/Workspace/Persistence/Format';
import { encryptWorkspace } from '../../../src/App/Workspace/Persistence/Encryption/encryptedEnvelope';
import { createBrowserWorkspaceStore } from '../../../src/App/createWorkspaceStore';

const password = 'public redo fixture passphrase';
function setup(encrypt?: typeof encryptWorkspace) {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  const store = createBrowserWorkspaceStore({ storage, encrypt });
  const workspace = createWorkspace('Redo fixture', 'mainnet');
  store.open(workspace, password);
  return { store, id: workspace.id, session: () => store.getUnlocked(workspace.id)! };
}
const txid = (n: number) => n.toString(16).padStart(64, '0');
const node = (n: number) => `tx:${txid(n)}`;
const output = (n: number) => `out:${txid(n)}:0`;
const transaction = (n: number, parent?: number): Transaction => ({
  txid: txid(n),
  vin: parent === undefined ? [{ coinbase: '00' }] : [{ txid: txid(parent), vout: 0 }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
});
function scanFixture() {
  const fixture = setup();
  const { store, id } = fixture;
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
    id: 'public-redo-run',
    source: node(1),
    targetIds: [node(2)],
    settings: { ...DEFAULT_SCAN_SETTINGS },
    startedAt: '2026-09-11T12:00:00.000Z',
    status: 'complete',
    examined: 2,
    stopReasons: [],
    results: [
      {
        id: 'public-redo-run:1',
        kind: 'connection',
        relationship: 'direct',
        endpoint: node(2),
        path: [node(1), output(1), node(2)],
        directions: ['downstream', 'downstream'],
        hops: 1,
      },
    ],
  };
  store.update(id, (w) => replaceScanRun(w, run, { [txid(2)]: transaction(2, 1) }), false);
  return { ...fixture, run };
}

describe('workspace redo', () => {
  it('restores successive edits and their action descriptions in order', () => {
    const { store, id, session } = setup();
    store.update(id, (w) => ({ ...w, name: 'Renamed' }));
    store.update(id, (w) => ({ ...w, description: 'A note' }));
    store.undo(id);
    expect(session().redoHistory.at(-1)?.description).toBe('Edit workspace description');
    store.undo(id);
    expect(session().redoHistory.at(-1)?.description).toBe('Rename workspace');
    const revision = session().revision;
    const undoRevision = session().undoRevision;
    store.redo(id);
    expect(session().data.name).toBe('Renamed');
    expect(session().data.description).toBeUndefined();
    expect(session().history.at(-1)?.description).toBe('Rename workspace');
    expect(session().revision).toBe(revision + 1);
    expect(session().undoRevision).toBeGreaterThan(undoRevision);
    store.redo(id);
    expect(session().data.description).toBe('A note');
    expect(session().redoHistory).toEqual([]);
    store.undo(id);
    expect(session().data.description).toBeUndefined();
    store.redo(id);
    expect(session().data.description).toBe('A note');
  });

  it('keeps redo for identity no-ops but discards it when a new edit branches from Undo', () => {
    const { store, id, session } = setup();
    store.update(id, (w) => ({ ...w, name: 'Old branch' }));
    store.undo(id);
    const undone = session();
    store.update(id, (w) => w);
    expect(session()).toBe(undone);
    expect(session().redoHistory).toHaveLength(1);
    store.update(id, (w) => ({ ...w, description: 'New branch' }));
    expect(session().redoHistory).toEqual([]);
    const edited = session();
    store.redo(id);
    expect(session()).toBe(edited);
    expect(session().data.name).toBe('Redo fixture');
    expect(session().data.description).toBe('New branch');
  });

  it('redoes a grouped edit together and starts a fresh group after Redo', () => {
    const { store, id, session } = setup();
    const edit = (name: string) => store.update(id, (w) => ({ ...w, name }), true, 'name');
    edit('R');
    edit('Renamed');
    expect(session().history).toHaveLength(1);
    store.undo(id);
    expect(session().redoHistory).toHaveLength(1);
    store.redo(id);
    expect(session().data.name).toBe('Renamed');
    edit('Another name');
    expect(session().history).toHaveLength(2);
    store.undo(id);
    expect(session().data.name).toBe('Renamed');
  });

  it('carries the latest camera through both stacks while restoring graph membership', () => {
    const { store, id, session } = setup();
    store.update(id, (w) => ({ ...w, view: { ...w.view, graphNodeIds: [node(1)] } }));
    store.update(id, (w) => ({ ...w, name: 'Renamed' }));
    store.undo(id);
    store.update(id, (w) => ({ ...w, view: { ...w.view, dimensions: 2, glow: false } }), false);
    store.redo(id);
    expect(session().data.view).toMatchObject({
      dimensions: 2,
      glow: false,
      graphNodeIds: [node(1)],
    });
    store.undo(id);
    store.undo(id);
    expect(session().data.view.graphNodeIds).toEqual([]);
    expect(session().data.view).toMatchObject({ dimensions: 2, glow: false });
    store.redo(id);
    expect(session().data.view.graphNodeIds).toEqual([node(1)]);
  });

  it('keeps current scan dismissals and proof usable across Add, Undo and Redo', () => {
    const { store, id, session, run } = scanFixture();
    const result = run.results[0];
    store.update(id, (w) => addScanPath(w, result), true, undefined, 'Add path');
    store.undo(id);
    store.update(
      id,
      (w) => replaceScanRun(w, { ...run, results: [{ ...result, dismissed: true }] }),
      false,
    );
    store.redo(id);
    expect(session().data.transactions[txid(2)]).toEqual(transaction(2, 1));
    expect(session().data.view.graphNodeIds).toContain(node(2));
    expect(session().data.connectionScans!.runs[0].results[0].dismissed).toBe(true);
    expect(session().history.at(-1)?.description).toBe('Add path');
    expect(() => parseWorkspace(session().data)).not.toThrow();
    store.undo(id);
    expect(session().data.transactions[txid(2)]).toBeUndefined();
    expect(prepareScanPath(session().data, result).missingTxids).toEqual([]);
    expect(session().data.connectionScans!.runs[0].results[0].dismissed).toBe(true);
    expect(() => parseWorkspace(session().data)).not.toThrow();
  });

  it('does not resurrect cleared scan results when redoing a path addition', () => {
    const { store, id, session, run } = scanFixture();
    store.update(id, (w) => addScanPath(w, run.results[0]));
    store.undo(id);
    store.update(id, clearScanRuns, false);
    store.redo(id);
    expect(session().data.view.graphNodeIds).toContain(node(2));
    expect(session().data.transactions[txid(2)]).toEqual(transaction(2, 1));
    expect(session().data.connectionScans).toBeUndefined();
    store.undo(id);
    expect(session().data.connectionScans).toBeUndefined();
  });

  it('invalidates both stacks when a background refresh changes chain evidence', () => {
    const { store, id, session } = setup();
    store.update(id, (w) => ({ ...w, name: 'Renamed' }));
    store.update(id, (w) => ({ ...w, description: 'Note' }));
    store.undo(id);
    expect(session().history).toHaveLength(1);
    expect(session().redoHistory).toHaveLength(1);
    store.update(id, (w) => ({ ...w, transactions: { [txid(1)]: transaction(1) } }), false);
    expect(session().history).toEqual([]);
    expect(session().redoHistory).toEqual([]);
    store.redo(id);
    expect(session().data.description).toBeUndefined();
    expect(session().data.transactions[txid(1)]).toEqual(transaction(1));
  });

  it('keeps quiet wallet scan metadata and promoted transaction context current through Redo', () => {
    const { store, id, session } = setup();
    const wallet = {
      id: crypto.randomUUID(),
      name: 'Public wallet fixture',
      key: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      scriptType: 'p2wpkh' as const,
      color: '#339988',
      addresses: [],
    };
    store.update(
      id,
      (w) => ({
        ...w,
        wallets: [wallet],
        transactions: { [txid(1)]: transaction(1) },
        inputContext: { [txid(1)]: [0] },
        contextTransactionIds: [txid(1)],
      }),
      false,
    );
    store.update(id, (w) => ({ ...w, name: 'Renamed' }));
    store.update(id, (w) => ({ ...w, description: 'Note' }));
    store.undo(id);
    const scannedAt = '2026-09-11T12:00:00.000Z';
    store.update(
      id,
      (w) =>
        clearContextProvenance(
          {
            ...w,
            wallets: w.wallets.map((item) => ({
              ...item,
              scannedAt,
              scanComplete: true,
              scanLimit: 200,
              scanGap: 20,
            })),
          },
          [txid(1)],
        ),
      false,
    );
    expect(session().history).toHaveLength(1);
    expect(session().redoHistory).toHaveLength(1);
    store.redo(id);
    expect(session().data.description).toBe('Note');
    expect(session().data.wallets[0]).toMatchObject({
      scannedAt,
      scanComplete: true,
      scanLimit: 200,
      scanGap: 20,
    });
    expect(session().data.inputContext).toBeUndefined();
    expect(session().data.contextTransactionIds).toBeUndefined();
    store.undo(id);
    store.undo(id);
    expect(session().data.wallets[0].scannedAt).toBe(scannedAt);
    expect(session().data.inputContext).toBeUndefined();
    expect(session().data.contextTransactionIds).toBeUndefined();
    expect(() => parseWorkspace(session().data)).not.toThrow();
  });

  it('keeps at most fifteen reversible actions across both stacks', () => {
    const { store, id, session } = setup();
    for (let i = 0; i < 20; i++) store.update(id, (w) => ({ ...w, name: `Name ${i}` }));
    for (let i = 0; i < 15; i++) {
      store.undo(id);
      expect(session().history.length + session().redoHistory.length).toBe(15);
    }
    expect(session().data.name).toBe('Name 4');
    const earliest = session();
    store.undo(id);
    expect(session()).toBe(earliest);
    for (let i = 0; i < 15; i++) store.redo(id);
    expect(session().data.name).toBe('Name 19');
    expect(session().history).toHaveLength(15);
    expect(session().redoHistory).toEqual([]);
  });

  it('keeps redo local to its workspace and outside workspace data', () => {
    const { store, id, session } = setup();
    store.update(id, (w) => ({ ...w, name: 'First workspace edit' }));
    store.undo(id);
    const other = createWorkspace('Other workspace', 'testnet4');
    store.open(other, password);
    store.update(other.id, (w) => ({ ...w, name: 'Other edit' }));
    store.undo(other.id);
    store.redo(id);
    expect(session().data.name).toBe('First workspace edit');
    expect(store.getUnlocked(other.id)!.data.name).toBe('Other workspace');
    expect(store.getUnlocked(other.id)!.redoHistory).toHaveLength(1);
    expect(session().data).not.toHaveProperty('history');
    expect(session().data).not.toHaveProperty('redoHistory');
  });

  it('blocks Redo immediately during lock and starts unlocked sessions without either stack', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store, id, session } = setup(async (data, key) => {
      await waiting;
      return encryptWorkspace(data, key);
    });
    store.update(id, (w) => ({ ...w, name: 'Undone edit' }));
    store.undo(id);
    const locking = store.lock(id);
    store.redo(id);
    expect(session().data.name).toBe('Redo fixture');
    release();
    await locking;
    expect(store.getUnlocked(id)).toBeUndefined();
    store.redo(id);
    await store.unlock(store.getSaved(id)!, password);
    expect(session().data.name).toBe('Redo fixture');
    expect(session().history).toEqual([]);
    expect(session().redoHistory).toEqual([]);
  });
});
