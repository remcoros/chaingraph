import { z } from 'zod';
import type { ScanResult, ScanRun } from './connectionScan';
import { SCAN_LIMITS, scanPathHops } from './connectionScan';
import { addGraphNodes, ensureGraphMembership } from './graphMembership';
import { indexPreviousOutputs } from './prevouts';
import type { Transaction, Workspace } from './types';
import { outputNodeId } from './types';
import { clearContextProvenance } from './workspace';

export const MAX_SCAN_EVIDENCE_TRANSACTIONS = 200;
export const MAX_SCAN_RECORD_BYTES = 2 * 1024 * 1024;
export interface ConnectionScanRecords {
  runs: ScanRun[];
  evidence: Record<string, Transaction>;
}
const txid = z.string().regex(/^[0-9a-f]{64}$/);
const nodeId = z
  .string()
  .regex(/^(?:tx:[0-9a-f]{64}|out:[0-9a-f]{64}:(?:0|[1-9]\d{0,9}))$/)
  .refine((id) => !id.startsWith('out:') || Number(id.split(':')[2]) <= 0xffffffff);
const direction = z.enum(['upstream', 'downstream']);
const reason = z.enum([
  'depth',
  'fan-out',
  'time',
  'transactions',
  'unknown',
  'failure',
  'results',
  'cancelled',
]);
const settingsSchema = z
  .object({
    direction: z.enum(['upstream', 'downstream', 'both']),
    targetScope: z.enum(['visible', 'added']),
    maxHops: z.number().int().min(1).max(SCAN_LIMITS.maxHops),
    maxTransactions: z.number().int().min(1).max(SCAN_LIMITS.maxTransactions),
    maxMilliseconds: z.number().int().min(1).max(SCAN_LIMITS.maxMilliseconds),
    fanOut: z.number().int().min(1).max(SCAN_LIMITS.fanOut),
  })
  .strict();
const resultSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(['connection', 'boundary']),
    relationship: z.enum(['direct', 'shared-ancestor', 'shared-descendant']).optional(),
    endpoint: nodeId,
    path: z
      .array(nodeId)
      .min(1)
      .max(2 * SCAN_LIMITS.maxHops + 3),
    directions: z.array(direction).max(2 * SCAN_LIMITS.maxHops + 2),
    hops: z.number().int().min(0).max(SCAN_LIMITS.maxHops),
    reason: reason.optional(),
    dismissed: z.boolean().optional(),
  })
  .strict();
export const scanRunSchema = z
  .object({
    id: z.string().min(1).max(100),
    source: nodeId,
    targetIds: z.array(nodeId).max(SCAN_LIMITS.maxTargets),
    settings: settingsSchema,
    startedAt: z.iso.datetime({ offset: true }),
    status: z.enum(['running', 'complete', 'cancelled', 'interrupted', 'failed']),
    examined: z.number().int().min(0).max(SCAN_LIMITS.maxTransactions),
    stopReasons: z.array(reason).max(8),
    results: z.array(resultSchema).max(SCAN_LIMITS.maxResults),
  })
  .strict();

/** Reject unknown scan fields instead of ever serializing a frontier or transport state. */
export function connectionScansSchema(transaction: z.ZodType<Transaction>) {
  return z
    .object({
      runs: z.array(scanRunSchema).max(SCAN_LIMITS.maxRuns),
      evidence: z.record(txid, transaction),
    })
    .strict();
}

export function assertConnectionScanBudget(data: unknown, checkBytes = true): void {
  if (!data || typeof data !== 'object') return;
  const raw = data as { runs?: unknown; evidence?: unknown };
  if (Array.isArray(raw.runs) && raw.runs.length > SCAN_LIMITS.maxRuns)
    throw new Error('Scan storage holds at most 20 runs. Remove a previous scan and retry.');
  if (Array.isArray(raw.runs)) {
    for (const run of raw.runs) {
      if (!run || typeof run !== 'object') continue;
      if (Array.isArray(run.results) && run.results.length > SCAN_LIMITS.maxResults)
        throw new Error('A scan stores at most 50 results.');
      if (Array.isArray(run.targetIds) && run.targetIds.length > SCAN_LIMITS.maxTargets)
        throw new Error('A scan stores at most 1,000 frozen targets.');
    }
  }
  if (
    raw.evidence &&
    typeof raw.evidence === 'object' &&
    Object.keys(raw.evidence).length > MAX_SCAN_EVIDENCE_TRANSACTIONS
  )
    throw new Error(
      'Scan storage holds at most 200 path transactions. Remove a previous scan and retry.',
    );
  if (
    checkBytes &&
    new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_SCAN_RECORD_BYTES
  )
    throw new Error('Scan records exceed 2 MiB. Remove a previous scan and retry.');
}

function transactionId(id: string) {
  return id.split(':')[1];
}
function edgeEvidence(a: string, b: string, travel: 'upstream' | 'downstream') {
  const [from, to] = travel === 'downstream' ? [a, b] : [b, a];
  if (from.startsWith('tx:') && to.startsWith('out:') && transactionId(from) === transactionId(to))
    return { txid: transactionId(from), creates: Number(to.split(':')[2]) };
  if (from.startsWith('out:') && to.startsWith('tx:') && transactionId(from) !== transactionId(to))
    return { txid: transactionId(to), spends: from };
  throw new Error('Scan path contains an invalid directed transaction edge.');
}

function requiredEvidence(result: ScanResult): Set<string> {
  const ids = new Set(result.path.filter((id) => id.startsWith('tx:')).map(transactionId));
  if (result.path.length === 1 && result.path[0].startsWith('out:'))
    ids.add(transactionId(result.path[0]));
  result.directions.forEach((direction, i) =>
    ids.add(edgeEvidence(result.path[i], result.path[i + 1], direction).txid),
  );
  return ids;
}

/** Verify semantics and every edge whose evidence remains available. Missing evidence is explicit at Add path. */
export function validateConnectionScanRecords(
  records: ConnectionScanRecords,
  workspace: Pick<Workspace, 'transactions' | 'network'>,
  verifyWorkspaceConsistency = true,
): void {
  assertConnectionScanBudget(records);
  const retained = new Set<string>();
  if (new Set(records.runs.map((run) => run.id)).size !== records.runs.length)
    throw new Error('Scan records contain duplicate run IDs.');
  for (const run of records.runs) {
    if (
      run.examined > run.settings.maxTransactions ||
      new Set(run.targetIds).size !== run.targetIds.length ||
      run.targetIds.includes(run.source)
    )
      throw new Error('Scan record has invalid frozen targets or transaction count.');
    if (new Set(run.results.map((result) => result.id)).size !== run.results.length)
      throw new Error('Scan record contains duplicate result IDs.');
    for (const result of run.results) {
      if (
        result.path[0] !== run.source ||
        result.path.at(-1) !== result.endpoint ||
        result.directions.length !== result.path.length - 1 ||
        new Set(result.path).size !== result.path.length ||
        result.hops > run.settings.maxHops ||
        result.hops !== scanPathHops(result.path)
      )
        throw new Error('Scan result has an invalid source, endpoint or path.');
      const switches = result.directions
        .slice(1)
        .filter((item, i) => item !== result.directions[i]).length;
      if (result.kind === 'connection') {
        if (
          !result.relationship ||
          result.reason !== undefined ||
          !run.targetIds.includes(result.endpoint) ||
          result.path.length < 2
        )
          throw new Error('Scan connection does not match its target snapshot.');
        if (result.relationship === 'direct' ? switches !== 0 : switches !== 1)
          throw new Error('Scan connection relationship does not match its path directions.');
        if (
          (result.relationship === 'shared-ancestor' && result.directions[0] !== 'upstream') ||
          (result.relationship === 'shared-descendant' && result.directions[0] !== 'downstream')
        )
          throw new Error('Scan meeting relationship has reversed evidence.');
      } else if (!result.reason || result.relationship !== undefined || switches !== 0) {
        throw new Error('Scan boundary needs a stopping reason and a directed path.');
      }
      if (
        run.settings.direction !== 'both' &&
        result.directions.length &&
        result.directions[0] !== run.settings.direction
      )
        throw new Error('Scan result does not match the requested direction.');
      for (const id of requiredEvidence(result)) retained.add(id);
      for (const [i, direction] of result.directions.entries()) {
        const edge = edgeEvidence(result.path[i], result.path[i + 1], direction);
        const tx = workspace.transactions[edge.txid] ?? records.evidence[edge.txid];
        if (!tx) continue;
        if (
          (edge.creates !== undefined && !tx.vout.some((output) => output.n === edge.creates)) ||
          (edge.spends !== undefined &&
            !tx.vin.some(
              (input) =>
                input.txid !== undefined &&
                input.vout !== undefined &&
                outputNodeId(input.txid, input.vout) === edge.spends,
            ))
        )
          throw new Error('Scan path is not supported by its transaction observations.');
      }
    }
  }
  for (const [id, transaction] of Object.entries(records.evidence)) {
    if (id !== transaction.txid || !retained.has(id))
      throw new Error('Scan evidence must support a retained result path.');
  }
  if (
    verifyWorkspaceConsistency &&
    [
      ...indexPreviousOutputs({
        network: workspace.network,
        transactions: { ...records.evidence, ...workspace.transactions },
      }).values(),
    ].some((item) => item.status === 'conflict')
  )
    throw new Error('Scan evidence conflicts with previous-output observations.');
}

function compactRecords(
  workspace: Workspace,
  runs: ScanRun[],
  supplied: Record<string, Transaction> = {},
): ConnectionScanRecords {
  const available = { ...workspace.connectionScans?.evidence, ...supplied };
  const needed = new Set(
    runs.flatMap((run) => run.results.flatMap((result) => [...requiredEvidence(result)])),
  );
  const evidence = Object.fromEntries(
    [...needed]
      .filter((id) => !workspace.transactions[id] && available[id])
      .map((id) => [id, available[id]]),
  );
  const records = { runs, evidence };
  assertConnectionScanBudget(records);
  return records;
}

export function appendScanRun(
  workspace: Workspace,
  run: ScanRun,
  evidence: Record<string, Transaction> = {},
): Workspace {
  scanRunSchema.parse(run);
  const previous = workspace.connectionScans?.runs ?? [];
  const exists = previous.some((item) => item.id === run.id);
  const runs = exists
    ? previous.map((item) => (item.id === run.id ? run : item))
    : [...previous, run];
  const records = compactRecords(workspace, runs, evidence);
  validateConnectionScanRecords(records, workspace, false);
  return { ...workspace, connectionScans: records };
}
export function removeScanRun(workspace: Workspace, id: string): Workspace {
  const runs = workspace.connectionScans?.runs.filter((run) => run.id !== id);
  return runs
    ? { ...workspace, connectionScans: runs.length ? compactRecords(workspace, runs) : undefined }
    : workspace;
}
export function clearScanRuns(workspace: Workspace): Workspace {
  return workspace.connectionScans ? { ...workspace, connectionScans: undefined } : workspace;
}
export function dismissScanResult(
  workspace: Workspace,
  runId: string,
  resultId: string,
): Workspace {
  if (!workspace.connectionScans) return workspace;
  return {
    ...workspace,
    connectionScans: {
      ...workspace.connectionScans,
      runs: workspace.connectionScans.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              results: run.results.map((result) =>
                result.id === resultId ? { ...result, dismissed: true } : result,
              ),
            }
          : run,
      ),
    },
  };
}

const membershipCache = new WeakMap<string[], Set<string>>();
function scanMembership(workspace: Workspace): Set<string> {
  const ids = ensureGraphMembership(workspace).view.graphNodeIds!;
  let membership = membershipCache.get(ids);
  if (!membership) {
    membership = new Set(ids);
    membershipCache.set(ids, membership);
  }
  return membership;
}

export function prepareScanPath(
  workspace: Workspace,
  result: ScanResult,
  prefixLength = result.path.length,
) {
  if (!Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > result.path.length)
    throw new Error('Choose an explicit nonempty path prefix.');
  const nodeIds = result.path.slice(0, prefixLength);
  const prefix = {
    ...result,
    path: nodeIds,
    directions: result.directions.slice(0, prefixLength - 1),
  };
  const observation = (id: string) =>
    workspace.transactions[id] ?? workspace.connectionScans?.evidence[id];
  const needed = requiredEvidence(prefix);
  // A single isolated outpoint also needs a creator or a loaded spending observation.
  if (
    nodeIds.length === 1 &&
    nodeIds[0].startsWith('out:') &&
    Object.values(workspace.transactions).some((tx) =>
      tx.vin.some(
        (input) =>
          input.txid !== undefined &&
          input.vout !== undefined &&
          outputNodeId(input.txid, input.vout) === nodeIds[0],
      ),
    )
  )
    needed.delete(transactionId(nodeIds[0]));
  const missingTxids = [...needed].filter((id) => !observation(id));
  const transactions = Object.fromEntries(
    [...needed].filter((id) => observation(id)).map((id) => [id, observation(id)!]),
  );
  const membership = scanMembership(workspace);
  return {
    nodeIds,
    newNodeIds: nodeIds.filter((id) => !membership.has(id)),
    missingTxids,
    transactions,
  };
}

/** Caller wraps this one immutable mutation in the existing undo action. No sibling membership or fetch. */
export function addScanPath(
  workspace: Workspace,
  result: ScanResult,
  prefixLength?: number,
): Workspace {
  const prepared = prepareScanPath(workspace, result, prefixLength);
  if (prepared.missingTxids.length)
    throw new Error(
      'Path evidence is missing. Rerun the scan to reload it before adding this path.',
    );
  const merged = {
    ...workspace,
    transactions: { ...workspace.transactions, ...prepared.transactions },
    view: { ...workspace.view, filters: undefined, smallAmountThreshold: 0 },
  };
  const added = addGraphNodes(
    clearContextProvenance(merged, Object.keys(prepared.transactions)),
    prepared.nodeIds,
  );
  return added.connectionScans
    ? { ...added, connectionScans: compactRecords(added, added.connectionScans.runs) }
    : added;
}
