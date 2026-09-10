/** Bounded observed-edge search. Exploration and its budgets are deliberately transient. */
export type ScanDirection = 'upstream' | 'downstream';
export type ScanStopReason =
  'depth' | 'fan-out' | 'time' | 'transactions' | 'unknown' | 'failure' | 'results' | 'cancelled';
export interface ScanSettings {
  direction: ScanDirection | 'both';
  targetScope: 'visible' | 'added';
  maxHops: number;
  maxTransactions: number;
  maxMilliseconds: number;
  fanOut: number;
}
export interface ScanResult {
  id: string;
  kind: 'connection' | 'boundary';
  relationship?: 'direct' | 'shared-ancestor' | 'shared-descendant';
  endpoint: string;
  path: string[];
  /** Direction followed on each observed edge, in path order from the source. */
  directions: ScanDirection[];
  hops: number;
  reason?: ScanStopReason;
  dismissed?: boolean;
}
export interface ScanRun {
  id: string;
  source: string;
  targetIds: string[];
  settings: ScanSettings;
  startedAt: string;
  status: 'running' | 'complete' | 'cancelled' | 'interrupted' | 'failed';
  examined: number;
  stopReasons: ScanStopReason[];
  results: ScanResult[];
}
export const SCAN_LIMITS = {
  maxHops: 8,
  maxTransactions: 1000,
  maxMilliseconds: 60_000,
  fanOut: 200,
  maxTargets: 1000,
  maxResults: 50,
  maxRuns: 20,
} as const;
export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  direction: 'both',
  targetScope: 'visible',
  maxHops: 3,
  maxTransactions: 200,
  maxMilliseconds: 15_000,
  fanOut: 50,
};
export function isScanNodeId(id: string): boolean {
  return (
    /^tx:[0-9a-f]{64}$/.test(id) ||
    (/^out:[0-9a-f]{64}:(0|[1-9][0-9]*)$/.test(id) && Number(id.split(':')[2]) <= 0xffffffff)
  );
}
export function validateScanSettings(settings: ScanSettings): ScanSettings {
  if (
    !settings ||
    !['upstream', 'downstream', 'both'].includes(settings.direction) ||
    !['visible', 'added'].includes(settings.targetScope)
  )
    throw new Error('Invalid scan settings.');
  for (const key of ['maxHops', 'maxTransactions', 'maxMilliseconds', 'fanOut'] as const) {
    if (
      !Number.isSafeInteger(settings[key]) ||
      settings[key] < 1 ||
      settings[key] > SCAN_LIMITS[key]
    ) {
      throw new Error(`Scan ${key} must be between 1 and ${SCAN_LIMITS[key]}.`);
    }
  }
  return { ...settings };
}
/** A hop enters another transaction; its output edge does not add another hop. */
export function scanPathHops(path: readonly string[]): number {
  return path.slice(1).filter((node) => node.startsWith('tx:')).length;
}
export class ScanBudgetExceeded extends Error {
  constructor(public readonly reason: 'transactions' | 'time' | 'cancelled') {
    super(`Scan stopped: ${reason}.`);
    this.name = 'ScanBudgetExceeded';
  }
}
export interface ScanBudget {
  readonly examined: number;
  readonly examinedTxids: string[];
  /** Call before examining every transaction, including cached and fallback candidates. */
  examine(txid: string): void;
  checkpoint(): void;
}
export interface ScanNeighbors {
  nodeIds: string[];
  /** Partial known neighbors may accompany an unknown/failure boundary. */
  stopReason?: ScanStopReason;
}
export interface ConnectionScanOptions {
  id: string;
  source: string;
  targetIds: readonly string[];
  displayedNodeIds: readonly string[];
  settings: ScanSettings;
  signal?: AbortSignal;
  resolveNeighbors: (
    nodeId: string,
    direction: ScanDirection,
    budget: ScanBudget,
    signal: AbortSignal,
  ) => Promise<ScanNeighbors>;
  onProgress?: (run: ScanRun) => void;
  now?: () => number;
}
interface Visit {
  path: string[];
  hops: number;
}
interface Front {
  direction: ScanDirection;
  side: 'source' | 'target';
  queue: Visit[];
  cursor: number;
  visited: Map<string, Visit>;
}
const reverseDirection = (direction: ScanDirection): ScanDirection =>
  direction === 'upstream' ? 'downstream' : 'upstream';

export async function runConnectionScan(options: ConnectionScanOptions): Promise<ScanRun> {
  const settings = validateScanSettings(options.settings);
  if (!isScanNodeId(options.source) || options.targetIds.some((id) => !isScanNodeId(id))) {
    throw new Error('Scan source and targets must be transactions or outpoints.');
  }
  if (options.targetIds.length > SCAN_LIMITS.maxTargets) throw new Error('Too many scan targets.');
  const targets = new Set(options.targetIds.filter((id) => id !== options.source).sort());
  const displayed = new Set(options.displayedNodeIds);
  const now = options.now ?? Date.now;
  const start = now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, settings.maxMilliseconds);
  const examined = new Set<string>();
  const budget: ScanBudget = {
    get examined() {
      return examined.size;
    },
    get examinedTxids() {
      return [...examined];
    },
    checkpoint() {
      if (timedOut || now() - start >= settings.maxMilliseconds)
        throw new ScanBudgetExceeded('time');
      if (controller.signal.aborted) throw new ScanBudgetExceeded('cancelled');
    },
    examine(txid) {
      this.checkpoint();
      if (examined.has(txid)) return;
      if (examined.size >= settings.maxTransactions) throw new ScanBudgetExceeded('transactions');
      examined.add(txid);
    },
  };
  const run: ScanRun = {
    id: options.id,
    source: options.source,
    targetIds: [...targets],
    settings,
    startedAt: new Date(start).toISOString(),
    status: 'running',
    examined: 0,
    stopReasons: [],
    results: [],
  };
  const reasons = new Set<ScanStopReason>();
  const resultKeys = new Set<string>();
  const directions: ScanDirection[] =
    settings.direction === 'both' ? ['upstream', 'downstream'] : [settings.direction];
  const fronts: Front[] = directions.flatMap((direction) =>
    (['source', 'target'] as const).map((side) => {
      const ids = side === 'source' ? [options.source] : [...targets];
      const visits = ids.map((id) => ({ path: [id], hops: 0 }));
      return {
        direction,
        side,
        queue: visits,
        cursor: 0,
        visited: new Map(ids.map((id, i) => [id, visits[i]!])),
      };
    }),
  );
  const addResult = (result: Omit<ScanResult, 'id' | 'hops'>) => {
    if (result.kind === 'connection' && result.path.every((id) => displayed.has(id))) return;
    const hops = scanPathHops(result.path);
    if (hops > settings.maxHops || new Set(result.path).size !== result.path.length) return;
    const key = `${result.kind}:${result.reason ?? ''}:${result.path.join('|')}`;
    if (resultKeys.has(key)) return;
    if (run.results.length >= SCAN_LIMITS.maxResults) {
      reasons.add('results');
      return;
    }
    resultKeys.add(key);
    run.results.push({ ...result, hops, id: `${run.id}:${run.results.length + 1}` });
    // Publish actionable results before another frontier can wait on evidence.
    progress();
  };
  const boundary = (front: Front, visit: Visit, reason: ScanStopReason) => {
    reasons.add(reason);
    if (front.side === 'source' && reason !== 'depth')
      addResult({
        kind: 'boundary',
        endpoint: visit.path.at(-1)!,
        path: visit.path,
        directions: Array<ScanDirection>(visit.path.length - 1).fill(front.direction),
        reason,
      });
  };
  const meeting = (front: Front, visit: Visit) => {
    const endpoint = visit.path.at(-1)!;
    const other = fronts.find(
      (item) => item.direction === front.direction && item.side !== front.side,
    )!;
    const match = other.visited.get(endpoint);
    if (!match) return;
    const sourceVisit = front.side === 'source' ? visit : match;
    const targetVisit = front.side === 'target' ? visit : match;
    if (sourceVisit.path.length === 1 || targetVisit.path.length === 1) return;
    const path = [...sourceVisit.path, ...targetVisit.path.slice(0, -1).reverse()];
    addResult({
      kind: 'connection',
      relationship: front.direction === 'upstream' ? 'shared-ancestor' : 'shared-descendant',
      endpoint: targetVisit.path[0]!,
      path,
      directions: [
        ...Array<ScanDirection>(sourceVisit.path.length - 1).fill(front.direction),
        ...Array<ScanDirection>(targetVisit.path.length - 1).fill(
          reverseDirection(front.direction),
        ),
      ],
    });
  };
  const progress = () => {
    run.examined = budget.examined;
    run.stopReasons = [...reasons];
    options.onProgress?.({ ...run, results: [...run.results], stopReasons: [...run.stopReasons] });
  };
  let current: { front: Front; visit: Visit } | undefined;
  try {
    // Alternate source/target and directions, with FIFO order inside each front.
    while (fronts.some((front) => front.cursor < front.queue.length)) {
      for (const front of fronts) {
        if (front.cursor >= front.queue.length) continue;
        const visit = front.queue[front.cursor++]!;
        current = { front, visit };
        budget.checkpoint();
        const nodeId = visit.path.at(-1)!;
        meeting(front, visit);
        if (front.side === 'source' && targets.has(nodeId)) {
          addResult({
            kind: 'connection',
            relationship: 'direct',
            endpoint: nodeId,
            path: visit.path,
            directions: Array<ScanDirection>(visit.path.length - 1).fill(front.direction),
          });
          continue;
        }
        if (front.side === 'target' && nodeId === options.source) continue;
        // Entering the next transaction would exceed the hop limit. Do not
        // resolve a spender (including its history fallback) just to reject it.
        if (nodeId.startsWith('out:') && visit.hops >= settings.maxHops) {
          boundary(front, visit, 'depth');
          continue;
        }
        budget.examine(nodeId.split(':')[1]!);
        let neighbors: ScanNeighbors;
        try {
          neighbors = await options.resolveNeighbors(
            nodeId,
            front.direction,
            budget,
            controller.signal,
          );
          budget.checkpoint();
        } catch (error) {
          budget.checkpoint();
          if (error instanceof ScanBudgetExceeded) throw error;
          boundary(front, visit, 'failure');
          continue;
        }
        if (neighbors.stopReason) boundary(front, visit, neighbors.stopReason);
        const ids = [...new Set(neighbors.nodeIds)].sort();
        if (ids.length >= settings.fanOut) {
          boundary(front, visit, 'fan-out');
          continue;
        }
        for (const id of ids) {
          if (!isScanNodeId(id)) {
            boundary(front, visit, 'failure');
            continue;
          }
          if (front.visited.has(id) || visit.path.includes(id)) continue;
          const hops = visit.hops + (id.startsWith('tx:') ? 1 : 0);
          if (hops > settings.maxHops) {
            boundary(front, visit, 'depth');
            continue;
          }
          const next = { path: [...visit.path, id], hops };
          front.visited.set(id, next);
          front.queue.push(next);
          meeting(front, next);
        }
        progress();
        if (reasons.has('results')) break;
      }
      if (reasons.has('results')) break;
    }
    run.status = 'complete';
  } catch (error) {
    const reason = error instanceof ScanBudgetExceeded ? error.reason : 'failure';
    reasons.add(reason);
    if (current) boundary(current.front, current.visit, reason);
    // Keep an actionable source-side stopping point even if target-side work used the budget.
    if (current?.front.side === 'target') {
      for (const front of fronts.filter((item) => item.side === 'source')) {
        const visit = front.queue[Math.min(front.cursor, front.queue.length - 1)];
        if (visit) boundary(front, visit, reason);
      }
    }
    run.status =
      reason === 'cancelled' ? 'cancelled' : reason === 'failure' ? 'failed' : 'complete';
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
  progress();
  return run;
}
