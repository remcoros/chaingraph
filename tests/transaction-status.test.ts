import { afterEach, describe, expect, it, vi } from 'vitest';
import { transactionStatus, withHistoryHeight } from '../src/domain/transactionStatus';
import { parseTransaction } from '../src/domain/workspace';
import type { Transaction } from '../src/domain/types';
import { fetchTransaction } from '../src/lib/api';
import { parseRpc } from '../server/rpc-schema';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number, extra: Partial<Transaction> = {}): Transaction => ({
  txid: hash(n),
  vin: [{ txid: hash(99999), vout: 0 }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  ...extra,
});
type Request = { network: string; target: string; method: string; params: unknown[] };
function mockRpc(
  handler: (request: Request, signal?: AbortSignal | null) => unknown | Promise<unknown>,
) {
  const calls: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted();
      const request = JSON.parse(init.body as string) as Request;
      calls.push(request);
      const result = await handler(request, init.signal);
      return { ok: true, json: async () => ({ result }) };
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('saved transaction status', () => {
  it('never invents a height or labels missing or zero confirmations as mempool', () => {
    expect(transactionStatus()).toMatchObject({ kind: 'unknown' });
    expect(transactionStatus(tx(1))).toMatchObject({ kind: 'unknown' });
    expect(transactionStatus(tx(1, { confirmations: 0 }))).toMatchObject({ kind: 'unknown' });
    expect(transactionStatus(tx(1, { confirmations: 123 }))).toMatchObject({ label: 'Confirmed' });
    expect(transactionStatus(tx(1, { blockHeight: 900001 }))).toMatchObject({
      label: 'Block 900,001',
    });
    expect(transactionStatus(tx(1, { mempool: true }))).toMatchObject({ label: 'Unconfirmed' });
    expect(transactionStatus(tx(1, { confirmations: -1 }))).toMatchObject({
      kind: 'conflicted',
      label: 'Outside active chain',
    });
  });
  it('validates persisted observations and rejects contradictory status metadata', () => {
    expect(parseTransaction(tx(1, { blockHeight: 0 }))).toMatchObject({ blockHeight: 0 });
    expect(parseTransaction(tx(1, { mempool: true, confirmations: 0 }))).toMatchObject({
      mempool: true,
    });
    for (const extra of [
      { blockHeight: -1 },
      { blockHeight: 1.5 },
      { blockHeight: 0x80000000 },
      { blockHeight: 100, confirmations: 0 },
      { blockHeight: 100, confirmations: -1 },
      { blockHeight: 100, mempool: true },
      { blockhash: hash(100), mempool: true },
      { confirmations: 1, mempool: true },
    ])
      expect(() => parseTransaction(tx(1, extra))).toThrow();
  });
  it('uses history observations without retaining conflicting old block metadata', () => {
    const old = tx(1, {
      blockHeight: 100,
      blockhash: hash(100),
      confirmations: 20,
      time: 1000,
      blocktime: 1000,
    });
    const moved = withHistoryHeight(old, 101);
    expect(moved).toMatchObject({ blockHeight: 101 });
    for (const key of ['blockhash', 'confirmations', 'time', 'blocktime'] as const)
      expect(moved[key]).toBeUndefined();
    expect(moved.vin).toBe(old.vin);
    expect(moved.vout).toBe(old.vout);
    expect(withHistoryHeight(old, 100)).toBe(old);
    expect(
      withHistoryHeight(tx(1, { blockhash: hash(100), confirmations: 20 }), 101).blockhash,
    ).toBeUndefined();
    for (const height of [0, -1]) {
      const unconfirmed = withHistoryHeight(old, height);
      expect(unconfirmed).toMatchObject({ confirmations: 0, mempool: true });
      expect(unconfirmed.blockHeight).toBeUndefined();
      expect(unconfirmed.blockhash).toBeUndefined();
      expect(() => parseTransaction(unconfirmed)).not.toThrow();
    }
    expect(() => withHistoryHeight(old, -2)).toThrow();
    expect(old.blockHeight).toBe(100);
  });
});

describe('transaction status provenance and bounded header reuse', () => {
  it('accepts only bounded read-only header RPC arguments', () => {
    expect(
      parseRpc({
        network: 'mainnet',
        target: 'core',
        method: 'getblockheader',
        params: [hash(1), true],
      }),
    ).toMatchObject({ method: 'getblockheader' });
    for (const params of [[], ['bad'], [hash(1), 1], [hash(1), true, 0]])
      expect(() =>
        parseRpc({ network: 'mainnet', target: 'core', method: 'getblockheader', params }),
      ).toThrow();
  });
  it('observes Core mempool membership without an extra RPC, but does not infer it from Electrum zero confirmations', async () => {
    let coreAvailable = true;
    const calls = mockRpc((request) => {
      if (request.target === 'core' && !coreAvailable) throw new Error('No txindex');
      return tx(1001, { confirmations: 0 });
    });
    expect(await fetchTransaction('mainnet', hash(1001))).toMatchObject({ mempool: true });
    expect(calls).toHaveLength(1);
    coreAvailable = false;
    expect((await fetchTransaction('mainnet', hash(1001))).mempool).toBeUndefined();
    expect(await fetchTransaction('mainnet', hash(1001), undefined, -1)).toMatchObject({
      mempool: true,
      confirmations: 0,
    });
  });
  it('prefers the fresh Core header over an earlier history height and reuses one request for concurrent transactions in the same block', async () => {
    const controller = new AbortController();
    const blockhash = hash(2001);
    const calls = mockRpc(async (request) => {
      if (request.method === 'getrawtransaction')
        return tx(Number.parseInt(request.params[0] as string, 16), {
          blockhash,
          confirmations: 3,
        });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { hash: blockhash, height: 900123, confirmations: 3 };
    });
    const results = await Promise.all(
      [1002, 1003, 1004, 1005].map((id) =>
        fetchTransaction('mainnet', hash(id), controller.signal, 900100),
      ),
    );
    expect(results.every((result) => result.blockHeight === 900123)).toBe(true);
    expect(calls.filter((request) => request.method === 'getblockheader')).toHaveLength(1);
    await fetchTransaction('mainnet', hash(1006));
    expect(calls.filter((request) => request.method === 'getblockheader')).toHaveLength(1);
    await fetchTransaction('testnet4', hash(1007));
    expect(calls.filter((request) => request.method === 'getblockheader')).toHaveLength(2);
  });
  it('does not revive cached active-chain status after the transaction becomes conflicted', async () => {
    const blockhash = hash(2002);
    let confirmations = 3;
    const calls = mockRpc((request) =>
      request.method === 'getrawtransaction'
        ? tx(1008, { blockhash, confirmations })
        : { hash: blockhash, height: 100, confirmations: 3 },
    );
    expect((await fetchTransaction('mainnet', hash(1008))).blockHeight).toBe(100);
    confirmations = -1;
    const conflicted = await fetchTransaction('mainnet', hash(1008));
    expect(conflicted.blockHeight).toBeUndefined();
    expect(transactionStatus(conflicted).kind).toBe('conflicted');
    expect(calls.filter((request) => request.method === 'getblockheader')).toHaveLength(1);
  });
  it('preserves transaction data when optional header metadata fails and never binds a mismatched header or stale history to the verbose blockhash', async () => {
    const blockhash = hash(2003);
    mockRpc((request) =>
      request.method === 'getrawtransaction'
        ? tx(1009, { blockhash, confirmations: 3 })
        : { hash: hash(2004), height: 101, confirmations: 3 },
    );
    const unknownHeight = await fetchTransaction('mainnet', hash(1009));
    expect(unknownHeight.blockHeight).toBeUndefined();
    expect(transactionStatus(unknownHeight).label).toBe('Confirmed');
    const fromHistory = await fetchTransaction('mainnet', hash(1009), undefined, 99);
    expect(fromHistory.blockHeight).toBe(99);
    expect(fromHistory.blockhash).toBeUndefined();
    expect(fromHistory.confirmations).toBeUndefined();
    expect(() => parseTransaction(fromHistory)).not.toThrow();
  });
  it('handles a reorganization observed by the header lookup as outside the active chain', async () => {
    const blockhash = hash(2005);
    mockRpc((request) =>
      request.method === 'getrawtransaction'
        ? tx(1010, { blockhash, confirmations: 1 })
        : { hash: blockhash, height: 100, confirmations: -1 },
    );
    const result = await fetchTransaction('mainnet', hash(1010));
    expect(result.blockHeight).toBeUndefined();
    expect(result.confirmations).toBe(-1);
  });
  it('propagates cancellation during metadata lookup without mixing separately cancellable requests', async () => {
    const blockhash = hash(2006);
    const cancelled = new AbortController();
    const survivor = new AbortController();
    mockRpc(async (request, signal) => {
      if (request.method === 'getrawtransaction') return tx(1011, { blockhash, confirmations: 2 });
      if (signal === cancelled.signal) cancelled.abort();
      return { hash: blockhash, height: 102, confirmations: 2 };
    });
    const results = await Promise.allSettled([
      fetchTransaction('mainnet', hash(1011), cancelled.signal),
      fetchTransaction('mainnet', hash(1011), survivor.signal),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { blockHeight: 102 } });
  });
  it('bounds retained immutable block coordinates to 512 records', async () => {
    let headers = 0;
    mockRpc((request) => {
      if (request.method === 'getrawtransaction')
        return tx(Number.parseInt(request.params[0] as string, 16), {
          blockhash: request.params[0] as string,
          confirmations: 1,
        });
      headers++;
      return { hash: request.params[0], height: 100, confirmations: 1 };
    });
    for (let id = 3000; id < 3513; id++) await fetchTransaction('mainnet', hash(id));
    expect(headers).toBe(513);
    await fetchTransaction('mainnet', hash(3000));
    expect(headers).toBe(514);
  });
});
