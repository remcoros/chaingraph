import {
  ScanBudgetExceeded,
  type ScanBudget,
  type ScanResult,
  type ScanObservation,
  type ScanStopReason,
  type ScanRun,
} from '../domain/connectionScan';
import { scanResultGroupKey } from '../domain/connectionScanGroups';
import { scanResultEvidenceIds } from '../domain/connectionScanRecords';
import { createConnectionScanFetch, type ConnectionScanFetchOptions } from './connectionScanFetch';

type Options = Omit<ConnectionScanFetchOptions, 'signal'> & {
  run: ScanRun;
  result: ScanResult;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

/** Recheck one endpoint; never resumes a frontier or silently replaces other findings. */
export async function retryConnectionScanResult(
  options: Options,
  factory = createConnectionScanFetch,
) {
  const deadline = Date.now() + options.run.settings.maxMilliseconds;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.run.settings.maxMilliseconds);
  const signal = AbortSignal.any([options.signal, timeout.signal, options.scope.signal]);
  const examined = new Set<string>();
  const checkpoint = () => {
    if (Date.now() >= deadline || timeout.signal.aborted) throw new ScanBudgetExceeded('time');
    signal.throwIfAborted();
    if (!options.isCurrent()) throw new DOMException('Scan session closed.', 'AbortError');
  };
  const budget: ScanBudget = {
    get examined() {
      return examined.size;
    },
    get examinedTxids() {
      return [...examined];
    },
    checkpoint,
    examine(id) {
      checkpoint();
      if (examined.has(id)) return;
      if (examined.size >= options.run.settings.maxTransactions)
        throw new ScanBudgetExceeded('transactions');
      examined.add(id);
    },
  };
  try {
    if (options.result.kind === 'connection')
      throw new Error('Recheck individual evidence problems or endpoints.');
    checkpoint();
    const adapter = factory({
      ...options,
      signal,
      fanOut: options.run.settings.fanOut,
      refresh: true,
    });
    const direction = options.result.scanDirection ?? options.result.directions[0];
    if (!direction) throw new Error('Scan again to reload this older result.');
    const neighbors = await adapter.resolveNeighbors(options.result.endpoint, direction, budget);
    checkpoint();
    if (
      neighbors.stopReason &&
      [
        'backend-unavailable',
        'rate-limited',
        'offline',
        'time',
        'transactions',
        'cancelled',
      ].includes(neighbors.stopReason)
    ) {
      return { globalReason: neighbors.stopReason, observation: undefined, evidence: {} };
    }
    const observation = neighbors.observation;
    // Only existing path proof can survive this single-step retry. Neighbors are transient.
    const ids = scanResultEvidenceIds({ ...options.result, ...observation });
    const evidence = Object.fromEntries(
      [...ids].flatMap((id) => (adapter.evidence[id] ? [[id, adapter.evidence[id]]] : [])),
    );
    return { globalReason: undefined, observation, evidence };
  } catch (error) {
    if (timeout.signal.aborted) throw new ScanBudgetExceeded('time');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** A successful recheck updates only alternative paths for that same finding. */
export function applyScanRecheck(
  run: ScanRun,
  result: ScanResult,
  observation?: ScanObservation,
): ScanRun {
  const key = scanResultGroupKey(result);
  return {
    ...run,
    results: run.results.flatMap((item) => {
      if (scanResultGroupKey(item) !== key) return [item];
      if (!observation) return [];
      const {
        finding,
        branchCount,
        checkedAt,
        bestBlock,
        includesMempool,
        issueCode,
        reason,
        ...path
      } = item;
      const kind = ['unspent', 'coinbase', 'unspendable'].includes(observation.finding)
        ? ('endpoint' as const)
        : ('boundary' as const);
      const nextReason: ScanStopReason | undefined =
        kind === 'endpoint'
          ? undefined
          : ['many-inputs', 'many-outputs'].includes(observation.finding)
            ? 'fan-out'
            : ['transaction-unavailable', 'spend-unknown'].includes(observation.finding)
              ? 'unknown'
              : 'failure';
      return [
        {
          ...path,
          ...observation,
          kind,
          reason: nextReason,
          ...(observation.finding === 'lookup-failed'
            ? { issueCode: observation.issueCode ?? ('lookup-failed' as const) }
            : {}),
          scanDirection: item.scanDirection ?? item.directions[0],
        },
      ];
    }),
  };
}
