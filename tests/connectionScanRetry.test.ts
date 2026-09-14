import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  type ScanResult,
  type ScanRun,
} from '../src/Domain/ConnectionScan/connectionScan';
import {
  applyScanRecheck,
  retryConnectionScanResult,
} from '../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanRetry';
import { TransactionFetchScope } from '../src/Infra/Bitcoin/transactionScheduler';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import { replaceScanRun } from '../src/Domain/ConnectionScan/connectionScanRecords';
import type { Transaction } from '../src/Domain/types';
const id = (n: number) => n.toString(16).padStart(64, '0');
const source = `tx:${id(1)}`;
const result: ScanResult = {
  id: 'issue',
  kind: 'boundary',
  finding: 'spend-unknown',
  reason: 'unknown',
  scanDirection: 'downstream',
  endpoint: `out:${id(1)}:0`,
  path: [source, `out:${id(1)}:0`],
  directions: ['downstream'],
  hops: 0,
};
const run: ScanRun = {
  id: 'public-run',
  source,
  targetIds: [`tx:${id(2)}`],
  settings: { ...DEFAULT_SCAN_SETTINGS },
  startedAt: '2026-09-10T00:00:00Z',
  status: 'complete',
  examined: 4,
  stopReasons: ['unknown'],
  results: [result],
};
const tx: Transaction = {
  txid: id(1),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
};
const options = () => ({
  run,
  result,
  network: 'testnet4' as const,
  transactions: { [id(1)]: tx },
  scope: new TransactionFetchScope('testnet4'),
  signal: new AbortController().signal,
  isCurrent: () => true,
});
describe('bounded endpoint recheck', () => {
  it.each([
    'transaction-unavailable',
    'spend-unknown',
    'lookup-failed',
    'conflicting-evidence',
  ] as const)('retains a still-unresolved %s through real record validation', (finding) => {
    const workspace = {
      ...newWorkspace('Public retry fixture', 'testnet4'),
      transactions: { [id(1)]: tx },
    };
    const updated = applyScanRecheck(run, result, { finding });
    expect(() => replaceScanRun(workspace, updated)).not.toThrow();
    expect(updated.results[0].reason).toBe(
      ['transaction-unavailable', 'spend-unknown'].includes(finding) ? 'unknown' : 'failure',
    );
  });
  it('cancels a delayed endpoint recheck at its deadline', async () => {
    vi.useFakeTimers();
    try {
      const input = options();
      input.run = { ...run, settings: { ...run.settings, maxMilliseconds: 100 } };
      const factory: Parameters<typeof retryConnectionScanResult>[1] = (settings) => ({
        evidence: input.transactions,
        resolveNeighbors: () =>
          new Promise((_resolve, reject) =>
            settings.signal.addEventListener(
              'abort',
              () => reject(new DOMException('Cancelled', 'AbortError')),
              { once: true },
            ),
          ),
      });
      const pending = retryConnectionScanResult(input, factory);
      const assertion = expect(pending).rejects.toMatchObject({ reason: 'time' });
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it('rechecks exactly one endpoint and retains path proof without the explored neighbor', async () => {
    const resolveNeighbors = vi.fn(async (_nodeId: string) => ({ nodeIds: [`tx:${id(2)}`] }));
    const factory = vi.fn((_options: { refresh?: boolean }) => ({
      resolveNeighbors,
      evidence: { [id(1)]: tx, [id(2)]: { ...tx, txid: id(2) } },
    }));
    const checked = await retryConnectionScanResult(options(), factory);
    expect(resolveNeighbors).toHaveBeenCalledOnce();
    expect(resolveNeighbors.mock.calls[0][0]).toBe(result.endpoint);
    expect(factory.mock.calls[0][0].refresh).toBe(true);
    expect(checked.observation).toBeUndefined();
    expect(Object.keys(checked.evidence)).toEqual([id(1)]);
  });
  it('does not accept an observation after the workspace closes', async () => {
    const input = options();
    let current = true;
    input.isCurrent = () => current;
    const factory = () => ({
      evidence: input.transactions,
      resolveNeighbors: async () => {
        current = false;
        return { nodeIds: [] };
      },
    });
    await expect(retryConnectionScanResult(input, factory)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('enforces the original transaction allowance during retry', async () => {
    const input = options();
    input.run = { ...run, settings: { ...run.settings, maxTransactions: 1 } };
    const factory: Parameters<typeof retryConnectionScanResult>[1] = () => ({
      evidence: input.transactions,
      resolveNeighbors: async (_node, _direction, budget) => {
        budget.examine(id(1));
        budget.examine(id(2));
        return { nodeIds: [] };
      },
    });
    await expect(retryConnectionScanResult(input, factory)).rejects.toMatchObject({
      reason: 'transactions',
    });
  });
  it('keeps systemic errors global without replacing a finding', async () => {
    const factory = () => ({
      evidence: {},
      resolveNeighbors: async () => ({ nodeIds: [], stopReason: 'rate-limited' as const }),
    });
    expect(await retryConnectionScanResult(options(), factory)).toMatchObject({
      globalReason: 'rate-limited',
      evidence: {},
    });
  });
  it('updates the matching issue and its alternatives without reviving dismissed paths or changing other findings', () => {
    const other: ScanResult = { ...result, id: 'other', endpoint: `out:${id(3)}:0` };
    const original = {
      ...run,
      results: [result, { ...result, id: 'alternative', dismissed: true }, other],
    };
    const changed = applyScanRecheck(original, result, {
      finding: 'unspent',
      checkedAt: run.startedAt,
      bestBlock: id(9),
      includesMempool: true,
    });
    expect(changed.results[0]).toMatchObject({
      kind: 'endpoint',
      finding: 'unspent',
      checkedAt: run.startedAt,
    });
    expect(changed.results[0].reason).toBeUndefined();
    expect(changed.results[1].dismissed).toBe(true);
    expect(changed.results[2]).toBe(other);
    expect(applyScanRecheck(original, result).results).toEqual([other]);
    expect(original.results[0].finding).toBe('spend-unknown');
  });
});
