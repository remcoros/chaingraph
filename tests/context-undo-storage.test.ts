import { describe, expect, it } from 'vitest';
import {
  clearContextProvenance,
  newWorkspace,
  parseWorkspace,
  promoteInputContext,
} from '../src/Domain/Workspace/workspace';
import { removeWorkspaceEntity } from '../src/Domain/Workspace/entityRemoval';
import { WorkspaceSessionStore } from '../src/App/Workspace/useWorkspaces';
import { applyWalletScan } from '../src/Domain/Wallet/walletActivity';

const parent = 'a'.repeat(64),
  child = 'b'.repeat(64);
function fixture() {
  const store = new WorkspaceSessionStore({ storage: { getItem: () => null, setItem: () => {} } });
  const workspace = newWorkspace('Context Undo fixture', 'mainnet');
  workspace.transactions = {
    [parent]: {
      txid: parent,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    },
    [child]: {
      txid: child,
      vin: [{ txid: parent, vout: 0 }],
      vout: [{ n: 0, value: 0.9, scriptPubKey: { hex: '51' } }],
    },
  };
  workspace.inputContext = { [parent]: [0] };
  workspace.contextTransactionIds = [parent];
  store.open(workspace, 'public context fixture password');
  return { store, id: workspace.id };
}
function annotate(store: WorkspaceSessionStore, id: string) {
  store.update(id, (w) => ({
    ...w,
    annotations: {
      ...w.annotations,
      [`tx:${child}`]: { label: 'Temporary label', note: '', icon: '', bookmarked: false },
    },
  }));
}
describe('quiet context transitions across workspace Undo', () => {
  it('keeps an explicitly loaded parent independent after undoing an older annotation', () => {
    const { store, id } = fixture();
    annotate(store, id);
    store.update(id, (w) => clearContextProvenance(w, [parent]), false);
    store.undo(id);
    const restored = store.getSession(id)!.data;
    expect(restored.annotations[`tx:${child}`]).toBeUndefined();
    expect(restored.inputContext).toBeUndefined();
    expect(restored.contextTransactionIds).toBeUndefined();
    expect(removeWorkspaceEntity(restored, `tx:${child}`).transactions[parent]).toBeDefined();
    expect(() => parseWorkspace(restored)).not.toThrow();
  });
  it('retains rendering promotion without making automatic ancestry independent', () => {
    const { store, id } = fixture();
    annotate(store, id);
    store.update(id, (w) => promoteInputContext(w, [parent]), false);
    store.undo(id);
    const restored = store.getSession(id)!.data;
    expect(restored.inputContext).toBeUndefined();
    expect(restored.contextTransactionIds).toEqual([parent]);
    expect(removeWorkspaceEntity(restored, `tx:${child}`).transactions).toEqual({});
  });
  it('restores removed transaction ancestry after a later camera save', () => {
    const { store, id } = fixture();
    store.update(id, (w) => removeWorkspaceEntity(w, `tx:${child}`));
    store.update(id, (w) => ({ ...w, view: { ...w.view, glow: false } }), false);
    store.undo(id);
    const restored = store.getSession(id)!.data;
    expect(Object.keys(restored.transactions).sort()).toEqual([parent, child]);
    expect(restored.inputContext).toEqual({ [parent]: [0] });
    expect(restored.contextTransactionIds).toEqual([parent]);
    expect(restored.view.glow).toBe(false);
    expect(() => parseWorkspace(restored)).not.toThrow();
  });
  it('keeps quiet wallet discovery independent while Undo retains scan metadata', () => {
    const { store, id } = fixture();
    const wallet = {
      id: crypto.randomUUID(),
      name: 'Public wallet fixture',
      key: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      scriptType: 'p2wpkh' as const,
      color: '#339988',
      addresses: [],
    };
    store.update(id, (w) => ({ ...w, wallets: [wallet] }), false);
    annotate(store, id);
    const scannedAt = '2026-09-08T12:00:00.000Z';
    store.update(
      id,
      (w) => applyWalletScan(w, { ...wallet, scannedAt }, [w.transactions[parent]]),
      false,
    );
    expect(store.getSession(id)!.history).toHaveLength(1);
    store.undo(id);
    const restored = store.getSession(id)!.data;
    expect(restored.annotations[`tx:${child}`]).toBeUndefined();
    expect(restored.contextTransactionIds).toBeUndefined();
    expect(restored.inputContext).toBeUndefined();
    expect(restored.wallets[0].scannedAt).toBe(scannedAt);
    expect(removeWorkspaceEntity(restored, `tx:${child}`).transactions[parent]).toBeDefined();
    expect(() => parseWorkspace(restored)).not.toThrow();
  });
});
