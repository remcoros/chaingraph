import { describe, it, expect } from 'vitest';
import { newWorkspace, parseWorkspace, buildGraph } from '../src/domain/workspace';
import { encryptWorkspace, decryptWorkspace } from '../src/lib/crypto';
import { WorkspaceSessionStore } from '../src/lib/useWorkspaces';
import { deriveAddresses } from '../src/lib/wallet';
import { PUBLIC_ZPUB } from './fixtures/bitcoin';
import { applyWalletScan } from '../src/domain/walletActivity';
const password = 'release-integrity-passphrase';
function storage() {
  let raw: string | null = null;
  return {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
}
function workspace() {
  const w = newWorkspace('Public workspace', 'mainnet');
  w.wallets.push({
    id: crypto.randomUUID(),
    name: 'Wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#aabbcc',
    addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1),
  });
  return w;
}
describe('release review data integrity fixes', () => {
  it('reopens legacy wallet labels between101 and200 characters without truncation', async () => {
    const w = workspace();
    w.wallets[0].name = 'L'.repeat(200);
    const encrypted = await encryptWorkspace(w, password);
    const restored = parseWorkspace(await decryptWorkspace(encrypted, password));
    expect(restored.wallets[0].name).toBe(w.wallets[0].name);
    const store = new WorkspaceSessionStore({ storage: storage() });
    store.open(restored, password);
    await store.lock(w.id);
    await store.unlock(store.getSnapshot().saved[0], password);
    expect(store.getSnapshot().sessions[0].data.wallets[0].name).toHaveLength(200);
  });
  it('rejects an invalid updated wallet before replacing its good encrypted snapshot', async () => {
    const memory = storage();
    const store = new WorkspaceSessionStore({ storage: memory });
    const w = workspace();
    store.open(w, password);
    await store.persist(w.id);
    const before = memory.getItem();
    store.update(w.id, (w) => ({
      ...w,
      wallets: w.wallets.map((wallet) => ({ ...wallet, name: 'L'.repeat(201) })),
    }));
    await expect(store.persist(w.id)).rejects.toThrow();
    expect(memory.getItem()).toBe(before);
    expect(store.getSnapshot().sessions).toHaveLength(1);
  });
  it('rejects an imported address with a valid hash that does not belong at the recorded wallet index', () => {
    const w = workspace();
    const foreign = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 1, 1)[0];
    w.wallets[0].addresses[0] = { ...foreign, index: 0, path: 'account/0/0' };
    expect(() => parseWorkspace(w)).toThrow();
  });
  it('marks findings stale on chain updates and removes their graph coloring without deleting evidence', () => {
    const store = new WorkspaceSessionStore({ storage: storage() });
    const w = newWorkspace('Stale test', 'mainnet');
    const id = 'a'.repeat(64);
    w.transactions[id] = {
      txid: id,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: {} }],
    };
    w.findings = [
      {
        id: 'finding',
        algorithm: 'test-v1',
        title: 'Snapshot',
        description: 'Observed',
        nodeIds: [`tx:${id}`],
        txids: [id],
        createdAt: new Date().toISOString(),
      },
    ];
    store.open(w, password);
    store.update(
      w.id,
      (current) => ({ ...current, transactions: { ...current.transactions } }),
      false,
    );
    const updated = store.getSnapshot().sessions[0].data;
    expect(updated.findings[0].stale).toBe(true);
    expect(buildGraph(updated).nodes.every((node) => !node.cluster)).toBe(true);
  });
  it('keeps findings active when acknowledging wallet activity and invalidates changed wallet evidence', () => {
    const store = new WorkspaceSessionStore({ storage: storage() });
    const w = workspace();
    w.findings = [
      {
        id: 'wallet-match',
        algorithm: 'wallet-intersection',
        title: 'Wallet match',
        description: 'Derived script match',
        nodeIds: [],
        txids: [],
        createdAt: new Date().toISOString(),
      },
    ];
    store.open(w, password);
    store.update(
      w.id,
      (current) => ({
        ...current,
        wallets: current.wallets.map((wallet) => ({
          ...wallet,
          scannedAt: new Date().toISOString(),
          unreviewedTransactionIds: [],
          pendingTransactionIds: [],
          scanGap: 20,
          activityOverflow: false,
          color: '#ccbbaa',
        })),
      }),
      false,
    );
    expect(store.getSnapshot().sessions[0].data.findings[0].stale).not.toBe(true);
    store.update(
      w.id,
      (current) => ({
        ...current,
        wallets: current.wallets.map((wallet) => ({
          ...wallet,
          addresses: wallet.addresses.map((address) => ({
            ...address,
            history: [{ tx_hash: 'a'.repeat(64), height: 123 }],
          })),
        })),
      }),
      false,
    );
    expect(store.getSnapshot().sessions[0].data.findings[0].stale).toBe(true);
  });

  it('keeps a quiet wallet refresh as the same evidence but invalidates changed confirmations', () => {
    const store = new WorkspaceSessionStore({ storage: storage() });
    const w = workspace();
    const txid = 'a'.repeat(64);
    const transaction = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
      confirmations: 0,
    };
    w.transactions[txid] = transaction;
    w.wallets[0].addresses[0].history = [{ tx_hash: txid, height: 0 }];
    w.findings = [
      {
        id: 'quiet',
        algorithm: 'test',
        title: 'Snapshot',
        description: 'Current evidence',
        nodeIds: [],
        txids: [txid],
        createdAt: new Date().toISOString(),
      },
    ];
    store.open(w, password);
    const scanned = {
      ...w.wallets[0],
      scannedAt: new Date().toISOString(),
      addresses: structuredClone(w.wallets[0].addresses),
    };
    for (const downloaded of [[], [structuredClone(transaction)]]) {
      store.update(w.id, (current) => applyWalletScan(current, scanned, downloaded), false);
      const current = store.getSnapshot().sessions[0].data;
      expect(current.transactions).toBe(w.transactions);
      expect(current.wallets[0].addresses).toBe(w.wallets[0].addresses);
      expect(current.findings[0].stale).not.toBe(true);
    }
    store.update(
      w.id,
      (current) => applyWalletScan(current, scanned, [{ ...transaction, confirmations: 1 }]),
      false,
    );
    expect(store.getSnapshot().sessions[0].data.transactions[txid].confirmations).toBe(1);
    expect(store.getSnapshot().sessions[0].data.findings[0].stale).toBe(true);
  });

  it('deletes only a locked saved copy and preserves another workspace', async () => {
    const memory = storage();
    const store = new WorkspaceSessionStore({ storage: memory });
    const one = newWorkspace('One', 'mainnet'),
      two = newWorkspace('Two', 'mainnet');
    store.open(one, password);
    await store.persist(one.id);
    await expect(store.removeSaved(one.id)).rejects.toThrow('Lock');
    await store.lock(one.id);
    store.open(two, password);
    await store.lock(two.id);
    await store.removeSaved(one.id);
    expect(store.getSnapshot().saved.map((entry) => entry.publicName)).toEqual(['Two']);
  });
});
