import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  rpc,
  classifyRpcFailure,
  backendNetworks,
  fetchIndexedSpenders,
  fetchTransaction,
} from '../../ChainData/api';
import { createConnectionScanFetch } from './connectionScanFetch';
import { TransactionFetchScope } from '../../ChainData/transactionScheduler';
import type { ScanBudget } from './connectionScan';
import { fetchScanUtxo, isVerifiedCoinbase, scanLookupFailure } from './connectionScanEvidence';
import { isProvablyUnspendable } from '../../Bitcoin';
import type { Transaction } from '../../ChainData';

const txid = 'a'.repeat(64);
const output = { value: 0.00000546, scriptPubKey: { hex: '51' } };
const observation = {
  bestblock: 'b'.repeat(64),
  confirmations: 3,
  value: output.value,
  scriptPubKey: { hex: '51' },
  coinbase: false,
};
const respond = (result: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result }))));
afterEach(() => vi.unstubAllGlobals());

describe('scan endpoint proof', () => {
  it('publishes only a validated current unspent observation, including mempool and check metadata', async () => {
    respond(observation);
    const result = await fetchScanUtxo('testnet4', txid, 3, output, new AbortController().signal);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      network: 'testnet4',
      target: 'core',
      method: 'gettxout',
      params: [txid, 3, true],
    });
    expect(result).toMatchObject({
      finding: 'unspent',
      bestBlock: observation.bestblock,
      includesMempool: true,
    });
    expect(Number.isFinite(Date.parse(result!.checkedAt!))).toBe(true);
  });
  it('does not publish unspent for null or when exact script evidence is missing', async () => {
    respond(null);
    expect(
      await fetchScanUtxo('mainnet', txid, 0, output, new AbortController().signal),
    ).toBeUndefined();
    vi.mocked(fetch).mockClear();
    expect(
      await fetchScanUtxo(
        'mainnet',
        txid,
        0,
        { value: 1, scriptPubKey: {} },
        new AbortController().signal,
      ),
    ).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...observation, value: 1 },
    { ...observation, scriptPubKey: { hex: '52' } },
  ])('reports mismatched output observations as conflicting, never unspent', async (value) => {
    respond(value);
    const error = await fetchScanUtxo(
      'mainnet',
      txid,
      0,
      output,
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(scanLookupFailure(error, 'spend')).toEqual({
      nodeIds: [],
      stopReason: 'failure',
      observation: { finding: 'conflicting-evidence' },
    });
  });
  it('rejects malformed observation metadata without retaining a raw error', async () => {
    respond({ ...observation, bestblock: 'private synthetic upstream detail' });
    const error = await fetchScanUtxo(
      'mainnet',
      txid,
      0,
      output,
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(scanLookupFailure(error, 'spend')).toEqual({
      nodeIds: [],
      stopReason: 'failure',
      observation: { finding: 'lookup-failed', issueCode: 'invalid-response' },
    });
  });
  it('rejects a known output address from another network before RPC', async () => {
    respond(observation);
    await expect(
      fetchScanUtxo(
        'testnet4',
        txid,
        0,
        { ...output, scriptPubKey: { hex: '51', address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' } },
        new AbortController().signal,
      ),
    ).rejects.toThrow('conflicts');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires an actual sole coinbase input, not an empty input list or mixed input', () => {
    const base: Transaction = { txid, vout: [{ ...output, n: 0 }], vin: [{ coinbase: '00' }] };
    expect(isVerifiedCoinbase(base)).toBe(true);
    expect(isVerifiedCoinbase({ ...base, vin: [] })).toBe(false);
    expect(isVerifiedCoinbase({ ...base, vin: [{ coinbase: 'not script bytes' }] })).toBe(false);
    expect(isVerifiedCoinbase({ ...base, vin: [{ coinbase: '00', txid, vout: 0 }] })).toBe(false);
    expect(isVerifiedCoinbase({ ...base, vin: [{ coinbase: '00' }, { txid, vout: 0 }] })).toBe(
      false,
    );
  });
  it('requires an initial OP_RETURN opcode in valid raw script bytes', () => {
    for (const hex of ['6a', '6A026162'])
      expect(isProvablyUnspendable({ value: 0, scriptPubKey: { hex } })).toBe(true);
    for (const hex of ['516a', '6az', '6a0', ''])
      expect(isProvablyUnspendable({ value: 0, scriptPubKey: { hex, type: 'nulldata' } })).toBe(
        false,
      );
  });
});

describe('safe scan transport classifications', () => {
  it('propagates systemic index failures for scans instead of continuing repeated fallback work', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ networks: ['testnet4'], spenderIndexNetworks: ['testnet4'] }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Synthetic limit' }), { status: 429 }),
        ),
    );
    await backendNetworks();
    const error = await fetchIndexedSpenders(
      'testnet4',
      [{ txid, vout: 0 }],
      {},
      undefined,
      {},
      () => {},
    ).catch((error: unknown) => error);
    expect(classifyRpcFailure(error)).toBe('rate-limited');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    [429, undefined, 'rate-limited'],
    [503, undefined, 'backend-unavailable'],
    [400, 'network_not_configured', 'backend-unavailable'],
    [504, undefined, 'timeout'],
    [502, undefined, 'lookup-failed'],
    [503, 'core_spender_unavailable', 'lookup-failed'],
    [502, 'private-unknown-code', 'lookup-failed'],
  ] as const)(
    'classifies status %s and code %s without copying error text',
    async (status, code, expected) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ error: 'private synthetic message', code }), { status }),
          ),
      );
      const error = await rpc('testnet4', 'core', 'gettxout', [txid, 0, true]).catch(
        (error: unknown) => error,
      );
      expect(classifyRpcFailure(error)).toBe(expected);
      const classified = scanLookupFailure(error, 'spend');
      expect(JSON.stringify(classified)).not.toContain('private');
      if (expected === 'backend-unavailable' || expected === 'rate-limited')
        expect(classified).toEqual({ nodeIds: [], stopReason: expected });
    },
  );
  it('retains transaction-specific unavailability rather than declaring a backend outage for generic failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'upstream rejected lookup' }), { status: 502 }),
        ),
    );
    const error = await rpc('testnet4', 'core', 'getrawtransaction', [txid, 2]).catch(
      (error: unknown) => error,
    );
    expect(scanLookupFailure(error, 'transaction')).toEqual({
      nodeIds: [],
      stopReason: 'unknown',
      observation: { finding: 'transaction-unavailable' },
    });
  });
  it('classifies malformed transport JSON and backend connection failures separately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('synthetic non-JSON')));
    let error = await rpc('testnet4', 'core', 'gettxout', [txid, 0, true]).catch(
      (error: unknown) => error,
    );
    expect(classifyRpcFailure(error)).toBe('invalid-response');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private connection detail')));
    error = await rpc('testnet4', 'core', 'gettxout', [txid, 0, true]).catch(
      (error: unknown) => error,
    );
    expect(classifyRpcFailure(error)).toBe('backend-unavailable');
  });
  it('does not trust arbitrary thrown properties as a systemic outage classification', () => {
    expect(
      classifyRpcFailure({ status: 503, code: 'network_not_configured', message: 'synthetic' }),
    ).toBe('lookup-failed');
  });
});

describe('transaction HTTP evidence reaches scan classifications', () => {
  const transaction: Transaction = { txid, vin: [{ coinbase: '00' }], vout: [{ ...output, n: 0 }] };
  async function scanTransaction() {
    const examined = new Set<string>();
    const budget: ScanBudget = {
      get examined() {
        return examined.size;
      },
      get examinedTxids() {
        return [...examined];
      },
      examine(id) {
        examined.add(id);
      },
      checkpoint() {},
    };
    const adapter = createConnectionScanFetch({
      network: 'testnet4',
      transactions: {},
      scope: new TransactionFetchScope('testnet4'),
      signal: new AbortController().signal,
    });
    const result = await adapter.resolveNeighbors(`tx:${txid}`, 'upstream', budget);
    return { result, evidence: adapter.evidence };
  }
  it('classifies an actual HTTP transaction-ID mismatch as conflicting evidence', async () => {
    respond({ ...transaction, txid: 'c'.repeat(64) });
    const { result, evidence } = await scanTransaction();
    expect(result).toEqual({
      nodeIds: [],
      stopReason: 'failure',
      observation: { finding: 'conflicting-evidence' },
    });
    expect(evidence).toEqual({});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('classifies an actual HTTP transaction network mismatch as conflicting evidence', async () => {
    respond({
      ...transaction,
      vout: [
        {
          ...output,
          n: 0,
          scriptPubKey: { hex: '51', address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' },
        },
      ],
    });
    const { result, evidence } = await scanTransaction();
    expect(result).toEqual({
      nodeIds: [],
      stopReason: 'failure',
      observation: { finding: 'conflicting-evidence' },
    });
    expect(evidence).toEqual({});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not attempt Electrum fallback after a Core HTTP rate limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Synthetic rate limit' }), { status: 429 }),
        ),
    );
    expect((await scanTransaction()).result).toEqual({ nodeIds: [], stopReason: 'rate-limited' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('also stops when the explicit Core prevout-capability fallback is rate limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: 'Synthetic prevout unavailable',
              code: 'core_prevout_unavailable',
            }),
            { status: 502 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Synthetic rate limit' }), { status: 429 }),
        ),
    );
    expect((await scanTransaction()).result).toEqual({ nodeIds: [], stopReason: 'rate-limited' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([, options]) => JSON.parse(options!.body as string).params[1]),
    ).toEqual([2, 1]);
  });
  it('preserves ordinary missing-transaction fallback and existing mismatch error text', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Synthetic Core miss' }), { status: 502 }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ result: transaction }))),
    );
    expect((await fetchTransaction('testnet4', txid)).txid).toBe(txid);
    expect(
      vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(options!.body as string).target),
    ).toEqual(['core', 'electrum']);
    respond({ ...transaction, txid: 'c'.repeat(64) });
    await expect(fetchTransaction('testnet4', txid)).rejects.toThrow(
      'Upstream returned a different transaction.',
    );
  });
});
