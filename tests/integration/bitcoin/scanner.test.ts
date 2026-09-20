import { afterEach, describe, expect, it, vi } from 'vitest';
import { verboseTransaction } from '../../fixtures/verboseTransaction';
import {
  fetchTransaction,
  fetchHistory,
  fetchAddressBalance,
  fetchAddressUtxos,
  loadAddress,
  mapLimit,
  MAX_SCAN_TRANSACTIONS,
} from '../../../src/Core/ChainData/api';
import { scanWallet } from '../../../src/Core/Workspace/Wallets/scanning';
import { deriveAddresses } from '../../../src/Core/Workspace/Wallets/walletDerivation';
import type { Wallet } from '../../../src/Core/Workspace/Wallets/wallets';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
import type { Network } from '../../../src/Core/Bitcoin';
import type { Transaction } from '../../../src/Core/ChainData';

import { address as bitcoinAddress } from 'bitcoinjs-lib';

const zpub =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const wallet: Wallet = {
  id: 'f27b07a5-afbe-4fa9-b390-fe4444d5bec6',
  name: 'Vector wallet',
  key: zpub,
  scriptType: 'p2wpkh',
  color: '#aabbcc',
  addresses: [],
};
const txid = (n: number) => n.toString(16).padStart(64, '0');
const transaction = (id: string, confirmations = 1): Transaction => ({
  txid: id,
  vin: [{ coinbase: '0101' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  status: {
    kind: confirmations < 0 ? 'inactive' : confirmations > 0 ? 'confirmed' : 'unknown',
    confirmations,
  },
});
type Request = { network: Network; target: string; method: string; params: unknown[] };
function mockRpc(
  handler: (request: Request, signal?: AbortSignal | null) => unknown | Promise<unknown>,
) {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted();
      const result = await handler(JSON.parse(init.body as string), init.signal);
      return { ok: true, json: async () => ({ result: verboseTransaction(result) }) };
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('browser-side wallet scanner', () => {
  it('fetches bounded address balance and UTXO observations on the selected network', async () => {
    const target = bitcoinAddress.toBech32(new Uint8Array(20).fill(7), 0, 'bc');
    const requests: Request[] = [];
    mockRpc(async (request) => {
      requests.push(request);
      return request.method.endsWith('get_balance')
        ? { confirmed: 100_000, unconfirmed: -1_000 }
        : [{ tx_hash: txid(1), tx_pos: 2, height: 123, value: 99_000 }];
    });
    const balance = await fetchAddressBalance('mainnet', target);
    const utxos = await fetchAddressUtxos('mainnet', target);
    expect(balance).toMatchObject({
      network: 'mainnet',
      confirmedSats: 100_000,
      unconfirmedSats: -1_000,
    });
    expect(utxos).toMatchObject({
      network: 'mainnet',
      utxos: [{ txid: txid(1), vout: 2, height: 123, valueSats: 99_000 }],
    });
    expect(requests.map(({ network, method }) => [network, method])).toEqual([
      ['mainnet', 'blockchain.scripthash.get_balance'],
      ['mainnet', 'blockchain.scripthash.listunspent'],
    ]);
  });

  it('rejects history heights that would make the encrypted workspace invalid', async () => {
    for (const height of [-2, 0x80000000, 1.5]) {
      mockRpc(() => [{ tx_hash: txid(1), height }]);
      await expect(fetchHistory('mainnet', txid(2))).rejects.toThrow(
        'Invalid or oversized address history',
      );
    }
  });
  it('scans both branches, extends after activity, deduplicates transactions and uses bounded concurrency', async () => {
    const receive = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 40);
    const change = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 1, 0, 40);
    const active = new Set([receive[9].scripthash, change[0].scripthash]);
    const requested: Request[] = [];
    let inflight = 0,
      peak = 0;
    mockRpc(async (request) => {
      requested.push(request);
      peak = Math.max(peak, ++inflight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inflight--;
      if (request.method === 'blockchain.scripthash.get_history')
        return active.has(request.params[0] as string) ? [{ tx_hash: txid(1), height: 100 }] : [];
      return transaction(request.params[0] as string);
    });
    const result = await scanWallet(wallet, 'mainnet', {}, { gap: 20, maxIndex: 40 });
    expect(result.wallet.addresses.filter((a) => a.branch === 0)).toHaveLength(30);
    expect(result.wallet.addresses.filter((a) => a.branch === 1)).toHaveLength(30);
    expect(result.wallet.scanComplete).toBe(true);
    expect(result.transactions.map((t) => t.txid)).toEqual([txid(1)]);
    expect(requested.filter((r) => r.method === 'getrawtransaction')).toHaveLength(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(JSON.stringify(requested)).not.toContain(zpub);
    expect(new Set(requested.map((request) => request.network))).toEqual(new Set(['mainnet']));
  });

  it('reports incomplete discovery when the address cap is reached before the gap', async () => {
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? []
        : transaction(request.params[0] as string),
    );
    const result = await scanWallet(wallet, 'mainnet', {}, { gap: 20, maxIndex: 10 });
    expect(result.wallet.scanComplete).toBe(false);
    expect(result.wallet.addresses).toHaveLength(20);
  });

  it('reports truncation for refresh work as well as newly discovered transactions', async () => {
    const first = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0].scripthash;
    const ids = Array.from({ length: MAX_SCAN_TRANSACTIONS + 1 }, (_, n) => txid(n + 1));
    const existing = Object.fromEntries(ids.map((id) => [id, transaction(id, 0)]));
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? request.params[0] === first
          ? ids.map((id) => ({ tx_hash: id, height: 0 }))
          : []
        : transaction(request.params[0] as string, 0),
    );
    const result = await scanWallet(wallet, 'mainnet', existing, { gap: 10, maxIndex: 30 });
    expect(result.transactions).toHaveLength(MAX_SCAN_TRANSACTIONS);
    expect(result.truncated).toBe(true);
    expect(result.wallet.scanComplete).toBe(false);
    expect(result.wallet.pendingTransactionIds).toEqual([ids[MAX_SCAN_TRANSACTIONS]]);
  });

  it('publishes address history before progressively loading transaction details', async () => {
    const target = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0];
    const events: string[] = [];
    const ids = [txid(1), txid(2)];
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? ids.map((id, index) => ({ tx_hash: id, height: 100 + index }))
        : transaction(request.params[0] as string),
    );

    const result = await loadAddress(
      target.address,
      'mainnet',
      {},
      undefined,
      (progress) => events.push(`progress:${progress.done}/${progress.total}`),
      {},
      {
        onHistory: (history, detailTotal, truncated) =>
          events.push(`history:${history.length}/${detailTotal}/${truncated}`),
        onTransaction: (loaded) => events.push(`transaction:${loaded.txid}`),
      },
    );

    expect(events[0]).toBe('history:2/2/false');
    expect(events.filter((event) => event.startsWith('transaction:'))).toHaveLength(2);
    expect(events.filter((event) => event.startsWith('progress:'))).toHaveLength(2);
    expect(result.transactions.map(({ txid: id }) => id).sort()).toEqual(ids.sort());
  });

  it('persists skipped changed-height refreshes and completes them on the next scan', async () => {
    const first = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0];
    const ids = Array.from({ length: MAX_SCAN_TRANSACTIONS + 1 }, (_, n) => txid(n + 1));
    const imported: Wallet = {
      ...wallet,
      addresses: [{ ...first, history: ids.map((id) => ({ tx_hash: id, height: 100 })) }],
    };
    const existing = Object.fromEntries(ids.map((id) => [id, transaction(id, 3)]));
    const fetched: string[] = [];
    mockRpc((request) => {
      if (request.method === 'blockchain.scripthash.get_history')
        return request.params[0] === first.scripthash
          ? ids.map((id) => ({ tx_hash: id, height: 101 }))
          : [];
      fetched.push(request.params[0] as string);
      return transaction(request.params[0] as string, 2);
    });
    const result = await scanWallet(imported, 'mainnet', existing, { gap: 10, maxIndex: 30 });
    expect(result.transactions).toHaveLength(MAX_SCAN_TRANSACTIONS);
    expect(result.wallet.pendingTransactionIds).toEqual([ids.at(-1)]);
    expect(result.truncated).toBe(true);
    const saved = parseWorkspace(
      JSON.parse(
        JSON.stringify({
          ...createWorkspace('Continuation', 'mainnet'),
          wallets: {
            ...createWorkspace('Continuation', 'mainnet').wallets,
            definitions: [result.wallet],
          },
        }),
      ),
    );
    const updated = {
      ...existing,
      ...Object.fromEntries(result.transactions.map((t) => [t.txid, t])),
    };
    fetched.length = 0;
    const continued = await scanWallet(saved.wallets.definitions[0], 'mainnet', updated, {
      gap: 10,
      maxIndex: 30,
    });
    expect(fetched).toEqual([ids.at(-1)]);
    expect(continued.wallet.pendingTransactionIds).toEqual([]);
    expect(continued.truncated).toBe(false);
    expect(continued.wallet.scanComplete).toBe(true);
  });

  it('prioritizes missing transactions and rotates skipped nonpositive-confirmation refreshes', async () => {
    const first = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0];
    const ids = Array.from({ length: MAX_SCAN_TRANSACTIONS + 2 }, (_, n) => txid(n + 1));
    const missing = ids.at(-1)!;
    const existing = Object.fromEntries(ids.slice(0, -1).map((id) => [id, transaction(id, -1)]));
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? request.params[0] === first.scripthash
          ? ids.map((id) => ({ tx_hash: id, height: 100 }))
          : []
        : transaction(request.params[0] as string, -1),
    );
    const imported: Wallet = {
      ...wallet,
      addresses: [{ ...first, history: ids.map((id) => ({ tx_hash: id, height: 100 })) }],
    };
    const result = await scanWallet(imported, 'mainnet', existing, { gap: 10, maxIndex: 30 });
    expect(result.transactions[0].txid).toBe(missing);
    const skipped = result.wallet.pendingTransactionIds!;
    expect(skipped).toHaveLength(2);
    const continued = await scanWallet(
      result.wallet,
      'mainnet',
      { ...existing, [missing]: transaction(missing, -1) },
      { gap: 10, maxIndex: 30 },
    );
    expect(continued.transactions.slice(0, skipped.length).map((t) => t.txid)).toEqual(skipped);
    expect(new Set(continued.transactions.map((t) => t.txid)).size).toBe(
      continued.transactions.length,
    );
    expect(continued.wallet.scanComplete).toBe(false);
  });

  it('drops pending transaction IDs no longer present in refreshed histories', async () => {
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? []
        : transaction(request.params[0] as string),
    );
    const result = await scanWallet(
      { ...wallet, pendingTransactionIds: [txid(99)] },
      'mainnet',
      {},
      { gap: 10, maxIndex: 20 },
    );
    expect(result.transactions).toEqual([]);
    expect(result.wallet.pendingTransactionIds).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('does not forget queued work belonging to known addresses outside a reduced scan bound', async () => {
    const known = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 35, 1)[0];
    const imported: Wallet = {
      ...wallet,
      addresses: [{ ...known, history: [{ tx_hash: txid(99), height: 101 }] }],
      pendingTransactionIds: [txid(99)],
    };
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? []
        : transaction(request.params[0] as string, 2),
    );
    const result = await scanWallet(
      imported,
      'mainnet',
      { [txid(99)]: transaction(txid(99), 3) },
      { gap: 10, maxIndex: 20 },
    );
    expect(result.transactions.map((t) => t.txid)).toEqual([txid(99)]);
    expect(result.wallet.addresses).toContainEqual(imported.addresses[0]);
    expect(result.wallet.scanComplete).toBe(false);
  });

  it('validates persisted continuation IDs and their queue bound', () => {
    const base = {
      ...createWorkspace('Queue validation', 'mainnet'),
      wallets: {
        ...createWorkspace('Queue validation', 'mainnet').wallets,
        definitions: [{ ...wallet, pendingTransactionIds: [txid(1)] }],
      },
    };
    expect(parseWorkspace(base).wallets.definitions[0].pendingTransactionIds).toEqual([txid(1)]);
    expect(() =>
      parseWorkspace({
        ...base,
        wallets: {
          ...base.wallets,
          definitions: [{ ...wallet, pendingTransactionIds: ['invalid'] }],
        },
      }),
    ).toThrow();
    expect(() =>
      parseWorkspace({
        ...base,
        wallets: {
          ...base.wallets,
          definitions: [{ ...wallet, pendingTransactionIds: Array(10001).fill(txid(1)) }],
        },
      }),
    ).toThrow();
  });

  it('loads missing address transactions before repeated nonpositive-confirmation refreshes', async () => {
    const first = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0];
    const ids = Array.from({ length: MAX_SCAN_TRANSACTIONS + 1 }, (_, n) => txid(n + 1));
    const missing = ids.at(-1)!;
    const existing = Object.fromEntries(ids.slice(0, -1).map((id) => [id, transaction(id, -1)]));
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? ids.map((id) => ({ tx_hash: id, height: 100 }))
        : transaction(request.params[0] as string, -1),
    );
    const result = await loadAddress(first.address, 'mainnet', existing);
    expect(result.transactions).toHaveLength(MAX_SCAN_TRANSACTIONS);
    expect(result.transactions[0].txid).toBe(missing);
    expect(result.truncated).toBe(true);
  });

  it('reports confirmed cached address history for promotion without repeating transaction RPC', async () => {
    const address = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0].address;
    const owned = txid(99),
      unrelated = txid(100);
    const requests: string[] = [];
    mockRpc((request) => {
      requests.push(request.method);
      return [{ tx_hash: owned, height: 100 }];
    });
    const result = await loadAddress(address, 'mainnet', {
      [owned]: transaction(owned, 10),
      [unrelated]: transaction(unrelated, 10),
    });
    expect(result.transactions).toMatchObject([
      { txid: owned, status: { kind: 'confirmed' as const, blockHeight: 100 } },
    ]);
    expect(result.transactions[0].status?.confirmations).toBeUndefined();
    expect(result.observedTransactionIds).toEqual([owned]);
    expect(requests).toEqual(['blockchain.scripthash.get_history']);
  });

  it('aborts before sending any requests when cancelled', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      scanWallet(wallet, 'mainnet', {}, { gap: 20, maxIndex: 40, signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('revisits known used indices beyond a fresh gap and refreshes changed confirmation heights', async () => {
    const known = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 35, 1)[0];
    const imported: Wallet = {
      ...wallet,
      addresses: [{ ...known, history: [{ tx_hash: txid(7), height: 100 }] }],
    };
    const lookedUp: string[] = [];
    mockRpc((request) => {
      if (request.method === 'blockchain.scripthash.get_history') {
        lookedUp.push(request.params[0] as string);
        return request.params[0] === known.scripthash ? [{ tx_hash: txid(7), height: 101 }] : [];
      }
      return transaction(request.params[0] as string, 2);
    });
    const result = await scanWallet(
      imported,
      'mainnet',
      { [txid(7)]: transaction(txid(7), 3) },
      { gap: 20, maxIndex: 60 },
    );
    expect(lookedUp).toContain(known.scripthash);
    expect(result.transactions).toMatchObject([
      { txid: txid(7), status: { kind: 'confirmed' as const, blockHeight: 101 } },
    ]);
    expect(result.wallet.scanComplete).toBe(true);
    const capped = await scanWallet(imported, 'mainnet', {}, { gap: 20, maxIndex: 20 });
    expect(capped.wallet.scanComplete).toBe(false);
    expect(capped.wallet.addresses).toContainEqual(imported.addresses[0]);
  });

  it('reports new, refreshed and disappeared history without erasing the saved snapshot', async () => {
    const first = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0];
    const imported = {
      ...wallet,
      addresses: [
        {
          ...first,
          history: [
            { tx_hash: txid(1), height: 0 },
            { tx_hash: txid(2), height: 100 },
            { tx_hash: txid(3), height: 101 },
          ],
        },
      ],
    };
    const existing = {
      [txid(1)]: transaction(txid(1), 0),
      [txid(2)]: transaction(txid(2), 3),
      [txid(3)]: transaction(txid(3), 2),
    };
    mockRpc((request) =>
      request.method === 'blockchain.scripthash.get_history'
        ? request.params[0] === first.scripthash
          ? [
              { tx_hash: txid(1), height: 103 },
              { tx_hash: txid(2), height: 102 },
              { tx_hash: txid(4), height: 0 },
            ]
          : []
        : transaction(request.params[0] as string, 1),
    );
    const result = await scanWallet(imported, 'mainnet', existing, { gap: 10, maxIndex: 30 });
    expect(result.wallet.lastActivity).toEqual({
      addedTransactionCount: 1,
      refreshedTransactionCount: 2,
      missingTransactionCount: 1,
    });
    expect(result.wallet.scanGap).toBe(10);
    expect(existing[txid(3)]).toEqual(transaction(txid(3), 2));
    expect(imported.addresses[0].history).toHaveLength(3);
  });

  it('does not commit a completed download batch after cancellation', async () => {
    const first = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1)[0];
    const controller = new AbortController();
    mockRpc((request) => {
      if (request.method === 'blockchain.scripthash.get_history')
        return request.params[0] === first.scripthash ? [{ tx_hash: txid(1), height: 100 }] : [];
      controller.abort();
      return transaction(txid(1));
    });
    await expect(
      scanWallet(wallet, 'mainnet', {}, { gap: 10, maxIndex: 30, signal: controller.signal }),
    ).rejects.toThrow();
    expect(wallet.addresses).toEqual([]);
    expect(wallet.scannedAt).toBeUndefined();
  });

  it('uses Electrum when Core cannot retrieve a transaction and validates the returned identity', async () => {
    const methods: string[] = [];
    mockRpc((request) => {
      methods.push(request.method);
      if (request.target === 'core') throw new Error('No txindex');
      return transaction(txid(10));
    });
    expect((await fetchTransaction('mainnet', txid(10))).txid).toBe(txid(10));
    expect(methods).toEqual(['getrawtransaction', 'blockchain.transaction.get']);
    await expect(fetchTransaction('mainnet', txid(11))).rejects.toThrow('different transaction');
  });

  it('does not fall back to another upstream after a cancelled Core request', async () => {
    const controller = new AbortController();
    const methods: string[] = [];
    mockRpc((request) => {
      methods.push(request.method);
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(fetchTransaction('mainnet', txid(10), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(methods).toEqual(['getrawtransaction']);
  });

  it('keeps results in input order despite concurrent completion order', async () => {
    const result = await mapLimit([3, 2, 1], 3, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n * 2));
      return n * 2;
    });
    expect(result).toEqual([6, 4, 2]);
  });

  it('stops scheduling new tasks after a concurrent request fails', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        if (n === 0) throw new Error('Upstream unavailable');
        await new Promise((resolve) => setTimeout(resolve, 5));
        return n;
      }),
    ).rejects.toThrow('Upstream unavailable');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([0, 1]);
  });
});
