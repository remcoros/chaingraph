import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHistory, fetchTransaction, fetchIndexedSpenders } from '../src/lib/api';
import { fetchCurrentUtxo } from '../src/lib/utxoStatus';
import { newWorkspace } from '../src/domain/workspace';
import {
  continuationHint,
  loadedSpenders,
  searchTraceSpenders,
  selectedOutpoint,
  TRACE_CANDIDATE_LIMIT,
} from '../src/domain/traceWorkbench';
import type { Transaction } from '../src/domain/types';

vi.mock('../src/lib/api', () => ({
  fetchHistory: vi.fn(),
  fetchTransaction: vi.fn(),
  fetchIndexedSpenders: vi.fn(),
}));
vi.mock('../src/lib/utxoStatus', () => ({ fetchCurrentUtxo: vi.fn() }));
const id = (n: number) => n.toString(16).padStart(64, '0');
const point = { txid: id(1), vout: 0 };
const tx = (n: number, inputs = 1, values = [1]): Transaction => ({
  txid: id(n),
  vin: Array.from({ length: inputs }, (_, i) => ({ txid: id(i + 1), vout: 0 })),
  vout: values.map((value, n) => ({ n, value, scriptPubKey: { hex: '51' } })),
});
const workspace = () => ({
  ...newWorkspace('Public trace fixture', 'testnet4'),
  transactions: { [id(1)]: tx(1) },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchCurrentUtxo).mockResolvedValue({
    ...point,
    network: 'testnet4',
    checkedAt: '2026-09-09T00:00:00Z',
    includeMempool: true,
    status: 'absent',
  });
  vi.mocked(fetchHistory).mockResolvedValue([]);
});

describe('trace branch semantics', () => {
  it('accepts only explicit outpoint selections, never guesses for transactions or addresses', () => {
    expect(
      selectedOutpoint({ id: 'tx', kind: 'transaction', txid: id(1), label: '' }),
    ).toBeUndefined();
    expect(selectedOutpoint({ id: 'address', kind: 'address', label: '' })).toBeUndefined();
    expect(selectedOutpoint({ id: 'out', kind: 'output', ...point, label: '' })).toEqual(point);
    expect(selectedOutpoint({ id: 'out', kind: 'output', txid: id(1), label: '' })).toBeUndefined();
  });
  it('distinguishes exact spends by both transaction ID and output index', () => {
    const w = workspace();
    const wrongOutput = { ...tx(3), vin: [{ txid: id(1), vout: 1 }] };
    w.transactions = { [id(2)]: tx(2), [id(3)]: wrongOutput };
    expect(loadedSpenders(w, point).map((item) => item.txid)).toEqual([id(2)]);
  });
  it('offers sole output and consolidation only as explicitly confirmed structural hints', () => {
    expect(continuationHint(tx(2))).toMatchObject({
      title: 'Sole-output continuation',
      automatic: false,
    });
    expect(continuationHint(tx(2, 3))).toMatchObject({
      title: 'Possible consolidation',
      automatic: false,
    });
    expect(continuationHint(tx(2, 3)).explanation).toContain('does not prove common ownership');
  });
  it('stops at equal-output and PayJoin ambiguity, with no largest-output recommendation', () => {
    expect(continuationHint(tx(2, 3, [1, 1, 4]))).toMatchObject({
      title: 'Ambiguous continuation',
      automatic: false,
    });
    expect(continuationHint(tx(2, 3, [1, 1, 4])).explanation).toContain('CoinJoin');
    expect(continuationHint(tx(2, 2, [1, 20])).explanation).toContain('PayJoin');
    expect(continuationHint(tx(2, 1, [1, 20])).explanation).toContain(
      'Amount alone does not identify',
    );
  });
});

describe('bounded network-scoped spender lookup', () => {
  it('uses shared exact lookup without script history or UTXO inference', async () => {
    vi.mocked(fetchIndexedSpenders).mockResolvedValue({
      transactions: [tx(2)],
      unresolved: [],
      inspected: 1,
      unavailableTxids: [],
    });
    const result = await searchTraceSpenders(workspace(), point, new AbortController().signal);
    expect(result).toMatchObject({ transactions: [tx(2)], inspected: 1, failed: 0 });
    expect(result.observation).toBeUndefined();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(fetchCurrentUtxo).not.toHaveBeenCalled();
  });
  it('retains known indexed transaction failures when fallback history is empty', async () => {
    vi.mocked(fetchIndexedSpenders).mockResolvedValue({
      transactions: [],
      unresolved: [point],
      inspected: 1,
      unavailableTxids: [id(2)],
    });
    expect(
      await searchTraceSpenders(workspace(), point, new AbortController().signal),
    ).toMatchObject({ inspected: 1, failed: 1, remaining: 0 });
  });
  it('resolves indexed failures from bounded exact history matches', async () => {
    vi.mocked(fetchIndexedSpenders).mockResolvedValue({
      transactions: [],
      unresolved: [point],
      inspected: 1,
      unavailableTxids: [id(2)],
    });
    vi.mocked(fetchHistory).mockResolvedValue(
      Array.from({ length: 20 }, (_, n) => ({ tx_hash: id(n + 2), height: 1 })),
    );
    vi.mocked(fetchTransaction).mockImplementation(async (_network, txid) => ({ ...tx(2), txid }));
    const result = await searchTraceSpenders(workspace(), point, new AbortController().signal);
    expect(result).toMatchObject({ inspected: 12, remaining: 9, failed: 0 });
    expect(fetchTransaction).toHaveBeenCalledTimes(11);
  });
  it('reports failed history as partial after an indexed failure', async () => {
    vi.mocked(fetchIndexedSpenders).mockResolvedValue({
      transactions: [],
      unresolved: [point],
      inspected: 1,
      unavailableTxids: [id(2)],
    });
    vi.mocked(fetchHistory).mockRejectedValue(new Error('Synthetic history failure'));
    expect(
      await searchTraceSpenders(workspace(), point, new AbortController().signal),
    ).toMatchObject({ failed: 2 });
  });
  it('queries only the workspace network and selected outpoint; absence remains unknown', async () => {
    const signal = new AbortController().signal;
    const result = await searchTraceSpenders(workspace(), point, signal);
    expect(fetchCurrentUtxo).toHaveBeenCalledWith(
      'testnet4',
      id(1),
      0,
      workspace().transactions[id(1)].vout[0],
      signal,
    );
    expect(fetchHistory).toHaveBeenCalledWith('testnet4', expect.any(String), signal);
    expect(result).toMatchObject({
      transactions: [],
      observation: { status: 'absent' },
      inspected: 0,
    });
  });
  it('keeps an observed unspent result distinct and avoids unnecessary history downloads', async () => {
    vi.mocked(fetchCurrentUtxo).mockResolvedValue({
      ...point,
      network: 'testnet4',
      checkedAt: '2026-09-09T00:00:00Z',
      includeMempool: true,
      status: 'unspent',
    });
    const result = await searchTraceSpenders(workspace(), point, new AbortController().signal);
    expect(result.observation?.status).toBe('unspent');
    expect(fetchHistory).not.toHaveBeenCalled();
  });
  it('caps candidate work, preserves only exact spending matches and reports omitted history', async () => {
    vi.mocked(fetchHistory).mockResolvedValue(
      Array.from({ length: 30 }, (_, n) => ({ tx_hash: id(n + 2), height: 1 })),
    );
    vi.mocked(fetchTransaction).mockImplementation(async (_network, hash) => ({
      ...tx(2),
      txid: hash,
      vin: [{ txid: id(1), vout: hash === id(2) ? 0 : 1 }],
    }));
    const result = await searchTraceSpenders(workspace(), point, new AbortController().signal);
    expect(fetchTransaction).toHaveBeenCalledTimes(TRACE_CANDIDATE_LIMIT);
    expect(result).toMatchObject({ inspected: 12, remaining: 18, failed: 0 });
    expect(result.transactions.map((item) => item.txid)).toEqual([id(2)]);
    expect(
      vi.mocked(fetchTransaction).mock.calls.every(([network]) => network === 'testnet4'),
    ).toBe(true);
  });
  it('reports partial failures without discarding other observed exact links', async () => {
    vi.mocked(fetchCurrentUtxo).mockRejectedValue(new Error('synthetic unavailable'));
    vi.mocked(fetchHistory).mockResolvedValue([
      { tx_hash: id(2), height: 1 },
      { tx_hash: id(3), height: 1 },
    ]);
    vi.mocked(fetchTransaction)
      .mockResolvedValueOnce(tx(2))
      .mockRejectedValueOnce(new Error('synthetic unavailable'));
    const result = await searchTraceSpenders(workspace(), point, new AbortController().signal);
    expect(result).toMatchObject({ inspected: 2, failed: 1, statusUnavailable: true });
    expect(result.transactions).toHaveLength(1);
  });
  it('honors cancellation even if an upstream promise resolves after abort, without the next lookup', async () => {
    const controller = new AbortController();
    vi.mocked(fetchHistory).mockResolvedValue([
      { tx_hash: id(2), height: 1 },
      { tx_hash: id(3), height: 1 },
    ]);
    vi.mocked(fetchTransaction).mockImplementation(async () => {
      controller.abort();
      return tx(2);
    });
    await expect(searchTraceSpenders(workspace(), point, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchTransaction).toHaveBeenCalledTimes(1);
  });
  it('rejects already cancelled work without querying', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchTraceSpenders(workspace(), point, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchCurrentUtxo).not.toHaveBeenCalled();
  });
});
