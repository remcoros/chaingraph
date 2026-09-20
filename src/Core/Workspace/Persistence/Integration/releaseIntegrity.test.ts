import { describe, it, expect } from 'vitest';
import { createWorkspace } from '../../createWorkspace';
import { parseWorkspace } from '../../Persistence';
import { buildGraph } from '../../../../App/Workspace/GraphState/graphEvidence';
import { encryptWorkspace, decryptWorkspace } from '../Codec/encryptedEnvelope';
import { createBrowserWorkspaceStore } from './workspaceStoreFixture';
import { deriveAddresses } from '../../Wallets/walletDerivation';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';
import { applyWalletScan } from '../../Wallets/walletActivity';
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
  const w = createWorkspace('Public workspace', 'mainnet');
  w.wallets.definitions.push({
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
    w.wallets.definitions[0].name = 'L'.repeat(200);
    const encrypted = await encryptWorkspace(w, password);
    const restored = parseWorkspace(await decryptWorkspace(encrypted, password));
    expect(restored.wallets.definitions[0].name).toBe(w.wallets.definitions[0].name);
    const store = createBrowserWorkspaceStore({ storage: storage() });
    store.open(restored, password);
    await store.lock(w.id);
    await store.unlock(store.getSnapshot().saved[0], password);
    expect(store.getSnapshot().unlocked[0].data.wallets.definitions[0].name).toHaveLength(200);
  });
  it('rejects an invalid updated wallet before replacing its good encrypted snapshot', async () => {
    const memory = storage();
    const store = createBrowserWorkspaceStore({ storage: memory });
    const w = workspace();
    store.open(w, password);
    await store.persist(w.id);
    const before = memory.getItem();
    store.update(w.id, (w) => ({
      ...w,
      wallets: {
        ...w.wallets,
        definitions: w.wallets.definitions.map((wallet) => ({ ...wallet, name: 'L'.repeat(201) })),
      },
    }));
    await expect(store.persist(w.id)).rejects.toThrow();
    expect(memory.getItem()).toBe(before);
    expect(store.getSnapshot().unlocked).toHaveLength(1);
  });
  it('rejects an imported address with a valid hash that does not belong at the recorded wallet index', () => {
    const w = workspace();
    const foreign = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 1, 1)[0];
    w.wallets.definitions[0].addresses[0] = { ...foreign, index: 0, path: 'account/0/0' };
    expect(() => parseWorkspace(w)).toThrow();
  });
  it('keeps findings and graph coloring current when transaction content is unchanged', () => {
    const store = createBrowserWorkspaceStore({ storage: storage() });
    const w = createWorkspace('Stale test', 'mainnet');
    const id = 'a'.repeat(64);
    w.chainData.transactions[id] = {
      txid: id,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: {} }],
    };
    w.analysis.findings = [
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
      (current) => ({
        ...current,
        chainData: { ...current.chainData, transactions: { ...current.chainData.transactions } },
      }),
      false,
    );
    const updated = store.getSnapshot().unlocked[0].data;
    expect(updated.analysis.findings[0].stale).not.toBe(true);
    expect(buildGraph(updated).nodes).toEqual(buildGraph(w).nodes);
  });
  it('keeps findings active when acknowledging wallet activity and invalidates changed wallet evidence', () => {
    const store = createBrowserWorkspaceStore({ storage: storage() });
    const w = workspace();
    w.analysis.findings = [
      {
        id: 'wallet-match',
        algorithm: 'wallet-intersections-v2',
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
        wallets: {
          ...current.wallets,
          definitions: current.wallets.definitions.map((wallet) => ({
            ...wallet,
            scannedAt: new Date().toISOString(),
            pendingTransactionIds: [],
            scanGap: 20,
            color: '#ccbbaa',
          })),
        },
      }),
      false,
    );
    expect(store.getSnapshot().unlocked[0].data.analysis.findings[0].stale).not.toBe(true);
    store.update(
      w.id,
      (current) => ({
        ...current,
        wallets: {
          ...current.wallets,
          definitions: current.wallets.definitions.map((wallet) => ({
            ...wallet,
            addresses: wallet.addresses.map((address) => ({
              ...address,
              scripthash: '2'.repeat(64),
            })),
          })),
        },
      }),
      false,
    );
    expect(store.getSnapshot().unlocked[0].data.analysis.findings[0].stale).toBe(true);
  });

  it('keeps structure-only findings current through quiet refreshes and changed confirmations', () => {
    const store = createBrowserWorkspaceStore({ storage: storage() });
    const w = workspace();
    const txid = 'a'.repeat(64);
    const transaction = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
      status: { kind: 'unknown' as const, confirmations: 0 },
    };
    w.chainData.transactions[txid] = transaction;
    w.wallets.definitions[0].addresses[0].history = [{ tx_hash: txid, height: 0 }];
    w.analysis.findings = [
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
      ...w.wallets.definitions[0],
      scannedAt: new Date().toISOString(),
      addresses: structuredClone(w.wallets.definitions[0].addresses),
    };
    for (const downloaded of [[], [structuredClone(transaction)]]) {
      store.update(w.id, (current) => applyWalletScan(current, scanned, downloaded), false);
      const current = store.getSnapshot().unlocked[0].data;
      expect(current.chainData.transactions).toBe(w.chainData.transactions);
      expect(current.wallets.definitions[0].addresses).toBe(w.wallets.definitions[0].addresses);
      expect(current.analysis.findings[0].stale).not.toBe(true);
    }
    store.update(
      w.id,
      (current) =>
        applyWalletScan(current, scanned, [
          {
            ...transaction,
            status: { ...transaction.status, kind: 'confirmed' as const, confirmations: 1 },
          },
        ]),
      false,
    );
    expect(
      store.getSnapshot().unlocked[0].data.chainData.transactions[txid].status?.confirmations,
    ).toBe(1);
    expect(store.getSnapshot().unlocked[0].data.analysis.findings[0].stale).not.toBe(true);
  });

  it('deletes only a locked saved copy and preserves another workspace', async () => {
    const memory = storage();
    const store = createBrowserWorkspaceStore({ storage: memory });
    const one = createWorkspace('One', 'mainnet'),
      two = createWorkspace('Two', 'mainnet');
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
