/** Bounded observed-edge search. Exploration and its budgets are deliberately transient. */
export type ScanDirection = 'upstream' | 'downstream';
export type ScanStopReason =
  | 'depth'
  | 'fan-out'
  | 'time'
  | 'transactions'
  | 'unknown'
  | 'failure'
  | 'results'
  | 'cancelled'
  | 'backend-unavailable'
  | 'rate-limited'
  | 'offline';
export type ScanFinding =
  | 'many-inputs'
  | 'many-outputs'
  | 'unspent'
  | 'coinbase'
  | 'unspendable'
  | 'transaction-unavailable'
  | 'spend-unknown'
  | 'lookup-failed'
  | 'conflicting-evidence';
/** These describe the run, never a transaction or outpoint finding. */
export const SCAN_STATUS_ONLY_REASONS: readonly ScanStopReason[] = [
  'depth',
  'time',
  'transactions',
  'results',
  'cancelled',
  'backend-unavailable',
  'rate-limited',
  'offline',
];
export interface ScanSettings {
  direction: ScanDirection | 'both';
  targetScope: 'visible' | 'added' | 'custom';
  maxHops: number;
  maxTransactions: number;
  maxMilliseconds: number;
  fanOut: number;
}
export interface ScanResult {
  id: string;
  kind: 'connection' | 'boundary' | 'endpoint';
  relationship?: 'direct' | 'shared-ancestor' | 'shared-descendant';
  endpoint: string;
  path: string[];
  /** Direction followed on each observed edge, in path order from the source. */
  directions: ScanDirection[];
  hops: number;
  reason?: ScanStopReason;
  dismissed?: boolean;
  finding?: ScanFinding;
  scanDirection?: ScanDirection;
  branchCount?: number;
  checkedAt?: string;
  bestBlock?: string;
  includesMempool?: boolean;
  issueCode?: 'timeout' | 'invalid-response' | 'lookup-failed';
  meetingNode?: string;
}
export type ScanObservation = Pick<
  ScanResult,
  'finding' | 'branchCount' | 'checkedAt' | 'bestBlock' | 'includesMempool' | 'issueCode'
> & { finding: ScanFinding };
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
  omittedResults?: { endpoints: number; issues: number };
}
export const SCAN_LIMITS = {
  maxHops: 8,
  maxTransactions: 1000,
  maxMilliseconds: 60_000,
  fanOut: 200,
  maxTargets: 1000,
  maxResults: 50,
  maxEndpointResults: 10,
  maxIssueResults: 10,
  maxRuns: 20,
} as const;
export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  direction: 'both',
  targetScope: 'visible',
  maxHops: 3,
  maxTransactions: 200,
  maxMilliseconds: 30_000,
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
    !['visible', 'added', 'custom'].includes(settings.targetScope)
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
  observation?: ScanObservation;
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
  /** A displayed-only arrival can continue where a novel target arrival stopped. */
  displayedVisits: Set<string>;
  /** Retain reconverging branches without fetching every possible path. */
  predecessors: Map<string, Set<string>>;
  successors: Map<string, Set<string>>;
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
  const resultCounts = { endpoints: 0, issues: 0 };
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
        displayedVisits: new Set(ids.filter((id) => displayed.has(id))),
        predecessors: new Map<string, Set<string>>(),
        successors: new Map<string, Set<string>>(),
      };
    }),
  );
  const addResult = (result: Omit<ScanResult, 'id' | 'hops'>) => {
    if (result.kind === 'connection' && result.path.every((id) => displayed.has(id))) return;
    const hops = scanPathHops(result.path);
    if (hops > settings.maxHops || new Set(result.path).size !== result.path.length) return;
    const key = `${result.kind}:${result.finding ?? result.reason ?? ''}:${result.scanDirection ?? ''}:${result.path.join('|')}`;
    if (resultKeys.has(key)) return;
    if (run.results.length >= SCAN_LIMITS.maxResults) {
      reasons.add('results');
      return;
    }
    resultKeys.add(key);
    const category =
      result.kind === 'endpoint'
        ? 'endpoints'
        : result.kind === 'boundary' &&
            result.finding !== 'many-inputs' &&
            result.finding !== 'many-outputs' &&
            result.reason !== 'fan-out'
          ? 'issues'
          : undefined;
    if (category) {
      const cap =
        category === 'endpoints' ? SCAN_LIMITS.maxEndpointResults : SCAN_LIMITS.maxIssueResults;
      if (resultCounts[category] >= cap) {
        run.omittedResults ??= { endpoints: 0, issues: 0 };
        run.omittedResults[category] = Math.min(1_000_000, run.omittedResults[category] + 1);
        return;
      }
      resultCounts[category]++;
    }
    run.results.push({ ...result, hops, id: `${run.id}:${run.results.length + 1}` });
    // Publish actionable results before another frontier can wait on evidence.
    progress();
  };
  const boundary = (
    front: Front,
    visit: Visit,
    reason?: ScanStopReason,
    observation?: ScanObservation,
  ) => {
    if (reason) reasons.add(reason);
    if (reason && SCAN_STATUS_ONLY_REASONS.includes(reason)) return;
    const finding =
      observation?.finding ??
      (reason === 'unknown'
        ? visit.path.at(-1)!.startsWith('out:') && front.direction === 'downstream'
          ? 'spend-unknown'
          : 'transaction-unavailable'
        : reason === 'failure'
          ? 'lookup-failed'
          : undefined);
    if (!finding && reason !== 'fan-out') return;
    if (['transaction-unavailable', 'spend-unknown'].includes(finding ?? ''))
      reasons.add('unknown');
    if (['lookup-failed', 'conflicting-evidence'].includes(finding ?? '')) reasons.add('failure');
    if (front.side !== 'source') return;
    addResult({
      ...observation,
      ...(finding ? { finding } : {}),
      ...(finding === 'lookup-failed' && !observation?.issueCode
        ? { issueCode: 'lookup-failed' as const }
        : {}),
      kind: ['unspent', 'coinbase', 'unspendable'].includes(finding ?? '')
        ? 'endpoint'
        : 'boundary',
      endpoint: visit.path.at(-1)!,
      path: visit.path,
      directions: Array<ScanDirection>(visit.path.length - 1).fill(front.direction),
      scanDirection: front.direction,
      ...(reason ? { reason } : {}),
    });
  };
  let reconstructionSteps = 0;
  const reconstructionCheckpoint = async () => {
    if (++reconstructionSteps % 256 === 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    budget.checkpoint();
  };
  const sourcePath = async (
    front: Front,
    witness: Visit,
    forbidden: Set<string>,
    maxHops: number,
    needsNewNode: boolean,
  ): Promise<Visit | undefined> => {
    const meetingNode = witness.path.at(-1)!;
    if (
      witness.hops <= maxHops &&
      !witness.path.some((id) => forbidden.has(id)) &&
      (!needsNewNode || witness.path.some((id) => !displayed.has(id)))
    )
      return witness;
    // A short displayed route, or one through the other leg, must not erase
    // a longer useful route. Each node has at most two reconstruction states.
    const queue = [{ path: [options.source], hops: 0, novel: !displayed.has(options.source) }];
    const seen = new Set([`${options.source}:${queue[0]!.novel}`]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      await reconstructionCheckpoint();
      if (reasons.has('results')) return;
      const visit = queue[cursor]!;
      const node = visit.path.at(-1)!;
      if (node === meetingNode && (!needsNewNode || visit.novel)) return visit;
      if (node !== options.source && targets.has(node) && visit.novel) continue;
      for (const next of front.successors.get(node) ?? []) {
        if (forbidden.has(next) || visit.path.includes(next)) continue;
        const hops = visit.hops + (next.startsWith('tx:') ? 1 : 0);
        if (hops > maxHops) continue;
        const novel = visit.novel || !displayed.has(next);
        const key = `${next}:${novel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ path: [...visit.path, next], hops, novel });
      }
    }
  };
  const reportMeetings = async (direction: ScanDirection, sourceVisit: Visit) => {
    if (sourceVisit.path.length === 1) return;
    const source = fronts.find(
      (front) => front.side === 'source' && front.direction === direction,
    )!;
    const target = fronts.find(
      (front) => front.side === 'target' && front.direction === direction,
    )!;
    const meetingNode = sourceVisit.path.at(-1)!;
    if (targets.has(meetingNode)) {
      const path = await sourcePath(source, sourceVisit, new Set(), settings.maxHops, true);
      if (path)
        addResult({
          kind: 'connection',
          relationship: 'direct',
          endpoint: meetingNode,
          scanDirection: direction,
          path: path.path,
          directions: Array<ScanDirection>(path.path.length - 1).fill(direction),
        });
    }
    if (!target.predecessors.has(meetingNode)) return;
    // Custom targets can sit beyond displayed non-target context. Preserve a
    // novel target leg even when a shorter displayed leg reaches the same node.
    const queue = [{ path: [meetingNode], hops: 0, novel: !displayed.has(meetingNode) }];
    const visited = new Set([`${meetingNode}:${queue[0]!.novel}`]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      await reconstructionCheckpoint();
      if (reasons.has('results')) return;
      const visit = queue[cursor]!;
      const node = visit.path.at(-1)!;
      if (visit.path.length > 1 && targets.has(node)) {
        const prefix = await sourcePath(
          source,
          sourceVisit,
          new Set(visit.path.slice(1)),
          settings.maxHops - visit.hops,
          !visit.novel,
        );
        if (!prefix) continue;
        addResult({
          kind: 'connection',
          relationship: direction === 'upstream' ? 'shared-ancestor' : 'shared-descendant',
          endpoint: node,
          meetingNode,
          scanDirection: direction,
          path: [...prefix.path, ...visit.path.slice(1)],
          directions: [
            ...Array<ScanDirection>(prefix.path.length - 1).fill(direction),
            ...Array<ScanDirection>(visit.path.length - 1).fill(reverseDirection(direction)),
          ],
        });
        continue;
      }
      for (const next of target.predecessors.get(node) ?? []) {
        budget.checkpoint();
        if (next === options.source || visit.path.includes(next)) continue;
        const hops = visit.hops + (next.startsWith('tx:') ? 1 : 0);
        if (hops > settings.maxHops) continue;
        const novel = visit.novel || !displayed.has(next);
        const key = `${next}:${novel}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ path: [...visit.path, next], hops, novel });
      }
    }
  };
  const meeting = async (front: Front, visit: Visit) => {
    const sourceVisit =
      front.side === 'source'
        ? visit
        : fronts
            .find((item) => item.side === 'source' && item.direction === front.direction)!
            .visited.get(visit.path.at(-1)!);
    if (sourceVisit) await reportMeetings(front.direction, sourceVisit);
  };
  const refreshMeetings = async (front: Front, node: string) => {
    // A late branch can join below an intersection already processed above it.
    // Refresh those intersections now so a later timeout cannot hide found paths.
    const source = fronts.find(
      (item) => item.side === 'source' && item.direction === front.direction,
    )!;
    const seen = new Set([node]);
    const queue = [node];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      await reconstructionCheckpoint();
      if (reasons.has('results')) return;
      const current = queue[cursor]!;
      const visit = source.visited.get(current);
      if (visit) await reportMeetings(front.direction, visit);
      for (const next of front.successors.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  };
  const progress = () => {
    run.examined = budget.examined;
    run.stopReasons = [...reasons];
    options.onProgress?.({
      ...run,
      results: [...run.results],
      stopReasons: [...run.stopReasons],
      ...(run.omittedResults ? { omittedResults: { ...run.omittedResults } } : {}),
    });
  };
  let current: { front: Front; visit: Visit } | undefined;
  try {
    // Alternate source/target and directions, with FIFO order inside each front.
    scan: while (fronts.some((front) => front.cursor < front.queue.length)) {
      for (const front of fronts) {
        if (reasons.has('results')) break scan;
        if (front.cursor >= front.queue.length) continue;
        const visit = front.queue[front.cursor++]!;
        current = { front, visit };
        budget.checkpoint();
        const nodeId = visit.path.at(-1)!;
        await meeting(front, visit);
        if (reasons.has('results')) break scan;
        if (front.side === 'source' && targets.has(nodeId)) {
          // A fully displayed prefix is existing graph context, not a new
          // connection. Keep tracing through it so a selected transaction's
          // visible inputs/outputs cannot fence off all undiscovered paths.
          if (visit.path.some((id) => !displayed.has(id))) continue;
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
        const ids = [...new Set(neighbors.nodeIds)].sort();
        if (neighbors.stopReason || neighbors.observation) {
          const observation =
            neighbors.observation ??
            (neighbors.stopReason === 'fan-out' && ids.length >= settings.fanOut
              ? {
                  finding:
                    front.direction === 'upstream'
                      ? ('many-inputs' as const)
                      : ('many-outputs' as const),
                  ...(ids.length > 0 ? { branchCount: ids.length } : {}),
                }
              : undefined);
          boundary(front, visit, neighbors.stopReason, observation);
          if (
            neighbors.stopReason &&
            [
              'time',
              'transactions',
              'results',
              'cancelled',
              'backend-unavailable',
              'rate-limited',
            ].includes(neighbors.stopReason)
          ) {
            if (neighbors.stopReason === 'cancelled') run.status = 'cancelled';
            break scan;
          }
          if (
            neighbors.stopReason === 'depth' ||
            neighbors.stopReason === 'fan-out' ||
            (observation &&
              ['many-inputs', 'many-outputs', 'unspent', 'coinbase', 'unspendable'].includes(
                observation.finding,
              ))
          )
            continue;
        }
        if (ids.length >= settings.fanOut) {
          boundary(front, visit, 'fan-out', {
            finding: front.direction === 'upstream' ? 'many-inputs' : 'many-outputs',
            branchCount: ids.length,
          });
          continue;
        }
        for (const id of ids) {
          if (reasons.has('results')) break scan;
          if (!isScanNodeId(id)) {
            boundary(front, visit, 'failure');
            continue;
          }
          if (visit.path.includes(id)) continue;
          const hops = visit.hops + (id.startsWith('tx:') ? 1 : 0);
          if (hops > settings.maxHops) {
            boundary(front, visit, 'depth');
            continue;
          }
          const predecessors = front.predecessors.get(id) ?? new Set<string>();
          predecessors.add(nodeId);
          front.predecessors.set(id, predecessors);
          const successors = front.successors.get(nodeId) ?? new Set<string>();
          successors.add(id);
          front.successors.set(nodeId, successors);
          const next = { path: [...visit.path, id], hops };
          if (front.visited.has(id)) {
            await refreshMeetings(front, id);
            if (
              front.side === 'source' &&
              !front.displayedVisits.has(id) &&
              next.path.every((node) => displayed.has(node))
            ) {
              front.displayedVisits.add(id);
              front.queue.push(next);
            }
            continue;
          }
          if (next.path.every((node) => displayed.has(node))) front.displayedVisits.add(id);
          front.visited.set(id, next);
          front.queue.push(next);
          await meeting(front, next);
        }
        progress();
        if (reasons.has('results')) break;
      }
      if (reasons.has('results')) break;
    }
    if (run.status === 'running') run.status = 'complete';
  } catch (error) {
    const reason = error instanceof ScanBudgetExceeded ? error.reason : 'failure';
    reasons.add(reason);
    if (current) boundary(current.front, current.visit, reason);
    run.status =
      reason === 'cancelled' ? 'cancelled' : reason === 'failure' ? 'failed' : 'complete';
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
  progress();
  return run;
}
