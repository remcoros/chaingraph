import { describe, expect, it, vi } from 'vitest';
import { analysisDataGaps, recoverAnalysisData, recoveryLimits } from './analysisRecovery';
import { analysisTools } from './analysis';
import { newWorkspace } from '../../../Domain/Workspace/workspace';
import type { Transaction } from '../../../Domain/Chain/transaction';
import type { Workspace } from '../../../Domain/Workspace/workspaceTypes';
import { resolvePreviousOutput } from '../../../Domain/Chain/prevouts';
const id = (n: number) => n.toString(16).padStart(64, '0');
const output = { n: 0, value: 1, scriptPubKey: { hex: '00141111', type: 'witness_v0_keyhash' } };
const spend = (n = 10, parents = [1]): Transaction => ({
  txid: id(n),
  vin: parents.map((n) => ({ txid: id(n), vout: 0 })),
  vout: [{ ...output, value: 0.9999 }],
  vsize: 100,
});
const parent = (n = 1): Transaction => ({ txid: id(n), vin: [{ coinbase: '00' }], vout: [output] });
function workspace(...txs: Transaction[]) {
  const w = newWorkspace('Public fixture', 'mainnet');
  w.transactions = Object.fromEntries(txs.map((tx) => [tx.txid, tx]));
  return w;
}
const fees = (w: Workspace) => analysisTools.find((tool) => tool.id === 'value-flow')!.run(w);

describe('bounded Analysis missing-data recovery', () => {
  it('already attached or loaded prevouts reconcile fees without any RPC or workspace change', async () => {
    const tx = spend();
    tx.vin[0].prevout = output;
    for (const w of [workspace(tx), workspace(spend(), parent())]) {
      const fetch = vi.fn();
      expect(analysisDataGaps(w, [id(10)])).toEqual([]);
      expect(fees(w)[0].kind).toBe('observation');
      const result = await recoverAnalysisData(w, [id(10)], fetch, new AbortController().signal);
      expect(fetch).not.toHaveBeenCalled();
      expect(result.workspace).toBe(w);
    }
  });
  it('refreshes the spending transaction at verbosity 2 through the adapter before considering parents', async () => {
    const w = workspace(spend());
    const incoming = spend();
    incoming.vin[0].prevout = output;
    const fetch = vi.fn(async () => incoming);
    const result = await recoverAnalysisData(
      w,
      [id(10), id(10)],
      fetch,
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(['mainnet', id(10), expect.any(AbortSignal)]);
    expect(Object.keys(result.workspace.transactions)).toEqual([id(10)]);
    expect(result.workspace.view).toBe(w.view);
    expect(result.resolved).toBe(1);
    expect(fees(result.workspace)[0].title).toContain('Fee threshold reached');
    expect(w.transactions[id(10)].vin[0].prevout).toBeUndefined();
  });
  it('deduplicates shared parents, retains partial success and retries only unresolved data', async () => {
    const w = workspace(spend(10, [1, 2]), spend(11, [1]));
    const fetch = vi.fn(async (_network, txid: string) => {
      if (txid === id(2)) throw new Error('pruned');
      return w.transactions[txid] ?? parent(1);
    });
    const result = await recoverAnalysisData(
      w,
      [id(10), id(11)],
      fetch,
      new AbortController().signal,
    );
    expect(fetch.mock.calls.map((call) => call[1])).toEqual([id(10), id(11), id(1), id(2)]);
    expect(result.resolved).toBe(2);
    expect(result.remaining).toBe(1);
    expect(result.failed).toBe(1);
    expect(fees(result.workspace).find((f) => f.scopeTxids?.includes(id(10)))?.kind).toBe(
      'incomplete',
    );
    const retry = vi.fn(
      async (_network, txid: string) => result.workspace.transactions[txid] ?? parent(2),
    );
    const done = await recoverAnalysisData(
      result.workspace,
      [id(10), id(11)],
      retry,
      new AbortController().signal,
    );
    expect(retry.mock.calls.map((call) => call[1])).toEqual([id(10), id(2)]);
    expect(done.remaining).toBe(0);
    expect(Object.keys(done.workspace.transactions)).toHaveLength(2);
  });
  it('retains usable parent amounts even when script details remain unavailable', async () => {
    for (const scripts of [false, true]) {
      const w = workspace(spend());
      const valueOnly = { ...parent(), vout: [{ ...output, scriptPubKey: {} }] };
      const fetch = vi.fn(async (_network, txid: string) => w.transactions[txid] ?? valueOnly);
      const result = await recoverAnalysisData(
        w,
        [id(10)],
        fetch,
        new AbortController().signal,
        scripts,
      );
      expect(result.failed).toBe(0);
      expect(result.remaining).toBe(scripts ? 1 : 0);
      expect(result.workspace.transactions[id(10)].vin[0].prevout?.value).toBe(1);
      expect(fees(result.workspace)[0].kind).toBe('observation');
      expect(Object.keys(result.workspace.transactions)).toEqual([id(10)]);
      expect(fetch).toHaveBeenCalledTimes(2);
      const retry = vi.fn();
      await recoverAnalysisData(
        result.workspace,
        [id(10)],
        retry,
        new AbortController().signal,
        false,
      );
      expect(retry).not.toHaveBeenCalled();
    }
  });
  it('rejects conflicting enrichment and never converts missing evidence to zero', async () => {
    const tx = spend(10, [1, 2]);
    tx.vin[0].prevout = output;
    const w = workspace(tx);
    const incoming = structuredClone(tx);
    incoming.vin[0].prevout!.value = 2;
    const fetch = vi.fn(async (_network, txid: string) => (txid === id(10) ? incoming : parent(2)));
    const result = await recoverAnalysisData(w, [id(10)], fetch, new AbortController().signal);
    expect(result.conflicts).toBe(1);
    expect(result.workspace.transactions[id(10)].vin[0].prevout!.value).toBe(1);
    const conflict = workspace(tx, { ...parent(), vout: [{ ...output, value: 2 }] });
    expect(
      analysisDataGaps(conflict, [id(10)]).some((gap) => gap.conflict && !gap.recoverable),
    ).toBe(true);
    expect(fees(conflict)[0].title).toContain('conflicting');
    expect(fees(conflict)[0].kind).toBe('incomplete');
  });
  it('fills missing script details from attachments even when the parent is loaded', async () => {
    const incomplete = {
      ...parent(),
      vout: [{ ...output, scriptPubKey: {} }],
    };
    const w = workspace(spend(), incomplete);
    const incoming = spend();
    incoming.vin[0].prevout = output;
    const fetch = vi.fn(async () => incoming);
    expect(analysisDataGaps(w, [id(10)], false)).toEqual([]);
    const result = await recoverAnalysisData(w, [id(10)], fetch, new AbortController().signal);
    expect(result.remaining).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const resolved = resolvePreviousOutput(result.workspace, { txid: id(1), vout: 0 });
    expect(resolved.status).toBe('loaded');
    if (resolved.status === 'loaded')
      expect(resolved.output.scriptPubKey.type).toBe('witness_v0_keyhash');
  });
  it('discards cancelled work and never starts a parent lookup after cancellation', async () => {
    const w = workspace(spend());
    const controller = new AbortController();
    let finish!: (tx: Transaction) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Transaction>((resolve) => {
          finish = resolve;
        }),
    );
    const result = recoverAnalysisData(w, [id(10)], fetch, controller.signal);
    controller.abort();
    finish(spend());
    await expect(result).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(w.transactions[id(10)].vin[0].prevout).toBeUndefined();
  });
  it('caps concurrency and total unique transaction lookups without deep traversal', async () => {
    const w = workspace(...Array.from({ length: 12 }, (_, i) => spend(i + 100, [i + 1, i + 20])));
    let active = 0,
      max = 0;
    const fetch = vi.fn(async (_network, txid: string) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return w.transactions[txid] ?? parent(parseInt(txid, 16));
    });
    const result = await recoverAnalysisData(
      w,
      Object.keys(w.transactions),
      fetch,
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(recoveryLimits.transactions);
    expect(max).toBeLessThanOrEqual(3);
    expect(new Set(fetch.mock.calls.map((call) => call[1])).size).toBe(20);
    expect(result.budgetReached).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
    expect(Object.keys(result.workspace.transactions)).toHaveLength(12);
  });
});

it('treats contradictory script-type observations as conflicts without replacing existing evidence', async () => {
  const tx = spend(10, [1, 2]);
  tx.vin[0].prevout = output;
  const w = workspace(tx, {
    ...parent(),
    vout: [{ ...output, scriptPubKey: { ...output.scriptPubKey, type: 'witness_v1_taproot' } }],
  });
  expect(resolvePreviousOutput(w, { txid: id(1), vout: 0 }).status).toBe('conflict');
  const fetch = vi.fn(async (_network, txid: string) => w.transactions[txid] ?? parent(2));
  const result = await recoverAnalysisData(w, [id(10)], fetch, new AbortController().signal);
  expect(result.conflicts).toBeGreaterThan(0);
  expect(result.workspace.transactions[id(10)].vin[0].prevout!.scriptPubKey.type).toBe(
    'witness_v0_keyhash',
  );
  expect(fees(result.workspace)[0].kind).toBe('incomplete');
});

it('automatic enrichment uses a smaller fixed budget and reuses resolved evidence on the next scan', async () => {
  const w = workspace(...Array.from({ length: 6 }, (_, i) => spend(i + 100, [i + 1, i + 20])));
  const fetch = vi.fn(
    async (_network, txid: string) => w.transactions[txid] ?? parent(parseInt(txid, 16)),
  );
  const result = await recoverAnalysisData(
    w,
    Object.keys(w.transactions),
    fetch,
    new AbortController().signal,
    true,
    'automatic',
  );
  expect(fetch).toHaveBeenCalledTimes(8);
  expect(fetch.mock.calls.filter((call) => w.transactions[call[1]])).toHaveLength(4);
  expect(result.budgetReached).toBe(true);
  expect(result.remaining).toBeGreaterThan(0);
  const resolved = workspace(spend());
  resolved.transactions[id(10)].vin[0].prevout = output;
  fetch.mockClear();
  const unchanged = await recoverAnalysisData(
    resolved,
    [id(10)],
    fetch,
    new AbortController().signal,
    true,
    'automatic',
  );
  expect(unchanged.workspace).toBe(resolved);
  expect(fetch).not.toHaveBeenCalled();
});

it('the automatic deadline retains completed enrichment while explicit cancellation still rejects it', async () => {
  for (const cancel of [false, true]) {
    const deadline = new AbortController(),
      user = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    try {
      const w = workspace(spend(10), spend(11, [2]));
      const fetch = vi.fn(async (_network, txid: string, signal: AbortSignal) => {
        if (txid === id(10)) {
          const tx = spend();
          tx.vin[0].prevout = output;
          return tx;
        }
        return new Promise<Transaction>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      });
      const attempt = recoverAnalysisData(
        w,
        [id(10), id(11)],
        fetch,
        user.signal,
        true,
        'automatic',
      );
      const result = attempt.then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (cancel) user.abort();
      else deadline.abort();
      const completed = await result;
      if (cancel) expect(completed.error).toBeDefined();
      else {
        expect(completed.value?.resolved).toBe(1);
        expect(completed.value?.remaining).toBe(1);
        expect(completed.value?.timedOut).toBe(true);
      }
      expect(timeout).toHaveBeenCalledWith(5_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(w.transactions[id(10)].vin[0].prevout).toBeUndefined();
    } finally {
      timeout.mockRestore();
    }
  }
});

it('uses remaining automatic capacity for more spends when verbosity 2 resolves the first batch', async () => {
  const w = workspace(...Array.from({ length: 6 }, (_, i) => spend(i + 100, [i + 1])));
  const fetch = vi.fn(async (_network, txid: string) => ({
    ...w.transactions[txid],
    vin: w.transactions[txid].vin.map((input) => ({ ...input, prevout: output })),
  }));
  const result = await recoverAnalysisData(
    w,
    Object.keys(w.transactions),
    fetch,
    new AbortController().signal,
    true,
    'automatic',
  );
  expect(result.remaining).toBe(0);
  expect(result.resolved).toBe(6);
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(Object.keys(result.workspace.transactions)).toHaveLength(6);
});
