import { describe, expect, it } from 'vitest';
import { createBrowserWorkspaceStore } from './workspaceStoreFixture';
import { createWorkspace } from '../../createWorkspace';
import { removeWorkspaceEntity } from '../../../../App/Workspace/entityRemoval';
import type { Transaction } from '../../../ChainData';

const txid = '1'.repeat(64);
const transaction: Transaction = {
  txid,
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  status: { kind: 'confirmed' as const, confirmations: 1 },
};
function fixture() {
  const store = createBrowserWorkspaceStore({
    storage: { getItem: () => null, setItem: () => {} },
  });
  const workspace = createWorkspace('Public history fixture', 'mainnet');
  workspace.chainData.transactions[txid] = transaction;
  store.open(workspace, 'public fixture password');
  const data = () => store.getUnlocked(workspace.id)!.data;
  const refresh = (confirmations: number) =>
    store.update(
      workspace.id,
      (current) => ({
        ...current,
        chainData: {
          ...current.chainData,
          transactions: {
            ...current.chainData.transactions,
            [txid]: {
              ...transaction,
              status: {
                ...transaction.status,
                kind: confirmations < 0 ? 'inactive' : confirmations > 0 ? 'confirmed' : 'unknown',
                confirmations,
              },
            },
          },
        },
      }),
      false,
    );
  const note = (note: string) =>
    store.update(workspace.id, (current) => ({
      ...current,
      annotations: {
        ...current.annotations,
        entities: {
          ...current.annotations.entities,
          [`tx:${txid}`]: { label: '', note, icon: '', bookmarked: false },
        },
      },
    }));
  return { store, id: workspace.id, data, refresh, note };
}

describe('accepted observations across user history', () => {
  it('restores removed wallet membership without rolling back accepted transaction observations or fabricating wallet freshness', () => {
    const { store, id, data, refresh } = fixture();
    const wallet = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Public wallet',
      key: '',
      scriptType: 'p2wpkh' as const,
      color: '#27c4a7',
      addresses: [],
    };
    store.update(
      id,
      (current) => ({ ...current, wallets: { ...current.wallets, definitions: [wallet] } }),
      false,
    );
    store.update(id, (current) => ({
      ...current,
      wallets: { ...current.wallets, definitions: [] },
    }));
    refresh(7);
    store.undo(id);
    expect(data().wallets.definitions).toEqual([wallet]);
    expect(data().wallets.definitions[0].scannedAt).toBeUndefined();
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(7);
    store.redo(id);
    expect(data().wallets.definitions).toEqual([]);
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(7);
  });
  it('restores notes without reverting a refresh, including Redo', () => {
    const { store, id, data, refresh, note } = fixture();
    note('An interpretation');
    refresh(2);
    store.undo(id);
    expect(data().annotations.entities[`tx:${txid}`]).toBeUndefined();
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(2);
    store.redo(id);
    expect(data().annotations.entities[`tx:${txid}`].note).toBe('An interpretation');
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(2);
  });

  it('preserves a pending redo across refresh and branches normally on a new edit', () => {
    const { store, id, data, refresh, note } = fixture();
    note('First');
    store.undo(id);
    refresh(3);
    expect(store.getUnlocked(id)!.redoHistory).toHaveLength(1);
    store.redo(id);
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(3);
    store.undo(id);
    note('Replacement');
    expect(store.getUnlocked(id)!.redoHistory).toHaveLength(0);
  });

  it('does not resurrect user-added data in the Undo snapshot merely because it refreshed', () => {
    const { store, id, data, refresh } = fixture();
    store.update(
      id,
      (current) => ({ ...current, chainData: { ...current.chainData, transactions: {} } }),
      false,
    );
    store.update(id, (current) => ({
      ...current,
      chainData: { ...current.chainData, transactions: { [txid]: transaction } },
    }));
    refresh(4);
    store.undo(id);
    expect(data().chainData.transactions[txid]).toBeUndefined();
    store.redo(id);
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(4);
  });

  it('restores an explicitly removed transaction without inventing a fresh observation', () => {
    const { store, id, data } = fixture();
    store.update(id, (current) => removeWorkspaceEntity(current, `tx:${txid}`));
    expect(data().chainData.transactions[txid]).toBeUndefined();
    store.undo(id);
    expect(data().chainData.transactions[txid]).toEqual(transaction);
    store.redo(id);
    expect(data().chainData.transactions[txid]).toBeUndefined();
  });
});
