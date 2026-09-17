import { describe, expect, it } from 'vitest';
import { clearContextProvenance, promoteInputContext } from '../../transactionContext';
import { createWorkspace } from '../../createWorkspace';
import { parseWorkspace } from '../../Persistence';
import { removeWorkspaceEntity } from '../../../../App/Workspace/entityRemoval';
import { createBrowserWorkspaceStore } from './workspaceStoreFixture';
import type { WorkspaceStore } from '../../Session/WorkspaceStore';
import { applyWalletScan } from '../../Wallets/walletActivity';

const parent = 'a'.repeat(64),
  child = 'b'.repeat(64);
function fixture() {
  const store = createBrowserWorkspaceStore({
    storage: { getItem: () => null, setItem: () => {} },
  });
  const workspace = createWorkspace('Context Undo fixture', 'mainnet');
  workspace.chainData.transactions = {
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
  workspace.view.inputContext = { [parent]: [0] };
  workspace.chainData.contextTransactionIds = [parent];
  store.open(workspace, 'public context fixture password');
  return { store, id: workspace.id };
}
function annotate(store: WorkspaceStore, id: string) {
  store.update(id, (w) => ({
    ...w,
    annotations: {
      ...w.annotations,
      entities: {
        ...w.annotations.entities,
        [`tx:${child}`]: { label: 'Temporary label', note: '', icon: '', bookmarked: false },
      },
    },
  }));
}
describe('quiet context transitions across workspace Undo', () => {
  it('keeps an explicitly loaded parent independent after undoing an older annotation', () => {
    const { store, id } = fixture();
    annotate(store, id);
    store.update(id, (w) => clearContextProvenance(w, [parent]), false);
    store.undo(id);
    const restored = store.getUnlocked(id)!.data;
    expect(restored.annotations.entities[`tx:${child}`]).toBeUndefined();
    expect(restored.view.inputContext).toBeUndefined();
    expect(restored.chainData.contextTransactionIds).toBeUndefined();
    expect(
      removeWorkspaceEntity(restored, `tx:${child}`).chainData.transactions[parent],
    ).toBeDefined();
    expect(() => parseWorkspace(restored)).not.toThrow();
  });
  it('retains rendering promotion without making automatic ancestry independent', () => {
    const { store, id } = fixture();
    annotate(store, id);
    store.update(id, (w) => promoteInputContext(w, [parent]), false);
    store.undo(id);
    const restored = store.getUnlocked(id)!.data;
    expect(restored.view.inputContext).toBeUndefined();
    expect(restored.chainData.contextTransactionIds).toEqual([parent]);
    expect(removeWorkspaceEntity(restored, `tx:${child}`).chainData.transactions).toEqual({});
  });
  it('restores removed transaction ancestry after a later camera save', () => {
    const { store, id } = fixture();
    store.update(id, (w) => removeWorkspaceEntity(w, `tx:${child}`));
    store.update(id, (w) => ({ ...w, view: { ...w.view, glow: false } }), false);
    store.undo(id);
    const restored = store.getUnlocked(id)!.data;
    expect(Object.keys(restored.chainData.transactions).sort()).toEqual([parent, child]);
    expect(restored.view.inputContext).toEqual({ [parent]: [0] });
    expect(restored.chainData.contextTransactionIds).toEqual([parent]);
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
    store.update(id, (w) => ({ ...w, wallets: { ...w.wallets, definitions: [wallet] } }), false);
    annotate(store, id);
    const scannedAt = '2026-09-08T12:00:00.000Z';
    store.update(
      id,
      (w) => applyWalletScan(w, { ...wallet, scannedAt }, [w.chainData.transactions[parent]]),
      false,
    );
    expect(store.getUnlocked(id)!.history).toHaveLength(1);
    store.undo(id);
    const restored = store.getUnlocked(id)!.data;
    expect(restored.annotations.entities[`tx:${child}`]).toBeUndefined();
    expect(restored.chainData.contextTransactionIds).toBeUndefined();
    expect(restored.view.inputContext).toBeUndefined();
    expect(restored.wallets.definitions[0].scannedAt).toBe(scannedAt);
    expect(
      removeWorkspaceEntity(restored, `tx:${child}`).chainData.transactions[parent],
    ).toBeDefined();
    expect(() => parseWorkspace(restored)).not.toThrow();
  });
});
