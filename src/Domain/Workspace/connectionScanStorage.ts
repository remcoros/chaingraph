import { z } from 'zod';
import { indexPreviousOutputs, previousOutputsConflict } from '../Chain/prevouts';
import type { Transaction } from '../Chain/transaction';
import { outputNodeId } from '../Metadata/entityReferences';
import {
  type ConnectionScanRecords,
  type StoredScanResult as ScanResult,
  type StoredScanRun as ScanRun,
  type StoredScanStopReason as ScanStopReason,
} from './connectionScanTypes';
import type { Workspace } from './workspaceTypes';

const SCAN_LIMITS = {
  maxHops: 8,
  maxTransactions: 1000,
  maxMilliseconds: 60_000,
  fanOut: 1000,
  maxTargets: 1000,
  maxResults: 50,
  maxEndpointResults: 10,
  maxIssueResults: 10,
  maxRuns: 20,
} as const;

function isScanNodeId(id: string): boolean {
  return (
    /^tx:[0-9a-f]{64}$/.test(id) ||
    (/^out:[0-9a-f]{64}:(0|[1-9][0-9]*)$/.test(id) && Number(id.split(':')[2]) <= 0xffffffff)
  );
}

function scanPathHops(path: readonly string[]): number {
  return path.slice(1).filter((node) => node.startsWith('tx:')).length;
}

export const MAX_SCAN_EVIDENCE_TRANSACTIONS = 200;
export const MAX_SCAN_RECORD_BYTES = 2 * 1024 * 1024;

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
  'backend-unavailable',
  'rate-limited',
  'offline',
]);
const settingsSchema = z
  .object({
    direction: z.enum(['upstream', 'downstream', 'both']),
    targetScope: z.enum(['neighbours', 'visible', 'added', 'custom']),
    maxHops: z.number().int().min(1).max(SCAN_LIMITS.maxHops),
    maxTransactions: z.number().int().min(1).max(SCAN_LIMITS.maxTransactions),
    maxMilliseconds: z.number().int().min(1).max(SCAN_LIMITS.maxMilliseconds),
    fanOut: z.number().int().min(1).max(SCAN_LIMITS.fanOut),
  })
  .strict();
const resultSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(['connection', 'boundary', 'endpoint']),
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
    finding: z
      .enum([
        'many-inputs',
        'many-outputs',
        'unspent',
        'coinbase',
        'unspendable',
        'transaction-unavailable',
        'spend-unknown',
        'lookup-failed',
        'conflicting-evidence',
      ])
      .optional(),
    scanDirection: direction.optional(),
    branchCount: z.number().int().min(1).max(10000).optional(),
    checkedAt: z.iso.datetime({ offset: true }).optional(),
    bestBlock: txid.optional(),
    includesMempool: z.boolean().optional(),
    issueCode: z.enum(['timeout', 'invalid-response', 'lookup-failed']).optional(),
    meetingNode: nodeId.optional(),
    bridge: z.literal(true).optional(),
    context: z
      .object({
        path: z
          .array(nodeId)
          .min(2)
          .max(2 * SCAN_LIMITS.maxHops + 3),
        directions: z
          .array(direction)
          .min(1)
          .max(2 * SCAN_LIMITS.maxHops + 2),
      })
      .strict()
      .optional(),
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
    deepestHop: z.number().int().min(0).max(SCAN_LIMITS.maxHops).optional(),
    stopReasons: z
      .array(reason)
      .max(11)
      .refine((items) => new Set(items).size === items.length, 'Duplicate scan stopping reasons.'),
    results: z.array(resultSchema).max(SCAN_LIMITS.maxResults),
    omittedResults: z
      .object({
        endpoints: z.number().int().min(0).max(1_000_000),
        issues: z.number().int().min(0).max(1_000_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((run) => run.deepestHop === undefined || run.deepestHop <= run.settings.maxHops, {
    path: ['deepestHop'],
    message: 'Scan depth exceeds its hop limit.',
  });

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
    throw new Error('Scan results span 20 scans. Clear results before starting another scan.');
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
    throw new Error('Scan results exceed 200 path transactions. Reduce the scan limits and retry.');
  if (
    checkBytes &&
    new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_SCAN_RECORD_BYTES
  )
    throw new Error('Scan results exceed 2 MiB. Reduce the scan limits and retry.');
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

export function scanResultEvidenceIds(result: ScanResult): Set<string> {
  const ids = new Set(result.path.filter((id) => id.startsWith('tx:')).map(transactionId));
  if (result.path.length === 1 && result.path[0].startsWith('out:'))
    ids.add(transactionId(result.path[0]));
  if (['unspent', 'unspendable'].includes(result.finding ?? ''))
    ids.add(transactionId(result.endpoint));
  result.directions.forEach((direction, i) =>
    ids.add(edgeEvidence(result.path[i], result.path[i + 1], direction).txid),
  );
  if (result.context) {
    for (const id of scanResultEvidenceIds({ ...result, ...result.context, context: undefined }))
      ids.add(id);
  }
  return ids;
}

/** A bounded known route closes the found path into a cycle without becoming search state. */
export function scanContextPath(result: ScanResult): ScanResult | undefined {
  const context = result.context;
  if (!context) return undefined;
  const edges = (path: string[]) =>
    new Set(path.slice(1).map((node, i) => [path[i], node].sort().join('|')));
  const foundEdges = edges(result.path);
  const contextEdges = edges(context.path);
  if (
    result.kind !== 'connection' ||
    context.path.length < 2 ||
    context.path.length > 2 * SCAN_LIMITS.maxHops + 3 ||
    context.path[0] !== result.path[0] ||
    context.path.at(-1) !== result.endpoint ||
    new Set(context.path).size !== context.path.length ||
    context.path.some((id) => !isScanNodeId(id)) ||
    context.directions.length !== context.path.length - 1 ||
    context.directions.some(
      (direction) => direction !== 'upstream' && direction !== 'downstream',
    ) ||
    scanPathHops(context.path) > SCAN_LIMITS.maxHops ||
    (foundEdges.size === contextEdges.size &&
      [...foundEdges].every((edge) => contextEdges.has(edge)))
  )
    throw new Error('Scan context must be a distinct bounded route between the result endpoints.');
  return {
    ...result,
    ...context,
    context: undefined,
    finding: undefined,
    hops: scanPathHops(context.path),
  };
}

function validateFindingMetadata(result: ScanResult, run: ScanRun): void {
  const finding = result.finding;
  const natural = finding === 'unspent' || finding === 'coinbase' || finding === 'unspendable';
  const many = finding === 'many-inputs' || finding === 'many-outputs';
  if (
    result.scanDirection &&
    (result.directions.length
      ? result.scanDirection !== result.directions[0]
      : run.settings.direction !== 'both' && result.scanDirection !== run.settings.direction)
  )
    throw new Error('Scan finding direction does not match its path.');
  if (!finding) {
    if (
      result.kind === 'endpoint' ||
      result.branchCount !== undefined ||
      result.checkedAt !== undefined ||
      result.bestBlock !== undefined ||
      result.includesMempool !== undefined ||
      result.issueCode !== undefined
    )
      throw new Error('Scan observation metadata needs a finding type.');
    return;
  }
  if (
    !result.scanDirection ||
    result.kind !== (natural ? 'endpoint' : 'boundary') ||
    result.relationship !== undefined ||
    result.meetingNode !== undefined
  )
    throw new Error('Scan finding has an invalid kind or direction.');
  const expectedDirection =
    finding === 'coinbase' || finding === 'many-inputs'
      ? 'upstream'
      : finding === 'unspent' ||
          finding === 'unspendable' ||
          finding === 'many-outputs' ||
          finding === 'spend-unknown'
        ? 'downstream'
        : undefined;
  if (expectedDirection && result.scanDirection !== expectedDirection)
    throw new Error('Scan finding has the wrong direction.');
  if (
    ((many || finding === 'coinbase') && !result.endpoint.startsWith('tx:')) ||
    (['unspent', 'unspendable', 'spend-unknown'].includes(finding) &&
      !result.endpoint.startsWith('out:'))
  )
    throw new Error('Scan finding has the wrong endpoint kind.');
  const expectedReason = natural
    ? undefined
    : many
      ? 'fan-out'
      : finding === 'transaction-unavailable' || finding === 'spend-unknown'
        ? 'unknown'
        : 'failure';
  if (result.reason !== expectedReason)
    throw new Error('Scan finding has an inconsistent stopping reason.');
  if (
    many
      ? result.branchCount === undefined || result.branchCount < run.settings.fanOut
      : result.branchCount !== undefined
  )
    throw new Error('Scan branch finding needs its exact observed branch count.');
  if (finding === 'unspent') {
    if (!result.checkedAt || !result.bestBlock || result.includesMempool !== true)
      throw new Error(
        'Unspent observations need a check time, best block and mempool-inclusive check.',
      );
  } else if (
    result.checkedAt !== undefined ||
    result.bestBlock !== undefined ||
    result.includesMempool !== undefined
  )
    throw new Error('Only an unspent observation carries a UTXO check snapshot.');
  if (result.issueCode !== undefined && finding !== 'lookup-failed')
    throw new Error('Lookup issue codes belong to failed lookup findings.');
}

function findingEvidenceConflicts(
  result: ScanResult,
  observation: (id: string) => Transaction | undefined,
): boolean {
  const transaction = observation(transactionId(result.endpoint));
  if (!transaction) return false;
  if (result.finding === 'coinbase')
    return (
      transaction.vin.length !== 1 ||
      !/^(?:[0-9a-f]{2})+$/i.test(transaction.vin[0].coinbase ?? '') ||
      transaction.vin[0].txid !== undefined ||
      transaction.vin[0].vout !== undefined ||
      transaction.vin[0].prevout !== undefined
    );
  if (result.finding === 'many-inputs')
    return (
      transaction.vin.filter((input) => input.txid !== undefined && input.vout !== undefined)
        .length !== result.branchCount
    );
  if (result.finding === 'many-outputs') return transaction.vout.length !== result.branchCount;
  if (result.finding === 'unspent' || result.finding === 'unspendable') {
    const output = transaction.vout.find(
      (output) => output.n === Number(result.endpoint.split(':')[2]),
    );
    if (!output) return true;
    if (result.finding === 'unspendable')
      return !/^6a(?:[0-9a-f]{2})*$/i.test(output.scriptPubKey.hex ?? '');
  }
  return false;
}

function edgeConflicts(
  a: string,
  b: string,
  direction: 'upstream' | 'downstream',
  observation: (id: string) => Transaction | undefined,
  workspace: Pick<Workspace, 'network'>,
): boolean {
  const edge = edgeEvidence(a, b, direction);
  const tx = observation(edge.txid);
  if (!tx) return false;
  if (edge.creates !== undefined) return !tx.vout.some((output) => output.n === edge.creates);
  const input = tx.vin.find(
    (input) =>
      input.txid !== undefined &&
      input.vout !== undefined &&
      outputNodeId(input.txid, input.vout) === edge.spends,
  );
  if (!input) return true;
  const creator = observation(input.txid!);
  if (!creator) return false;
  const output = creator.vout.find((output) => output.n === input.vout);
  return (
    !output ||
    (!!input.prevout &&
      previousOutputsConflict(output, { n: input.vout!, ...input.prevout }, workspace.network))
  );
}

/** Check a retained path against every observation that is still available. */
export function scanResultConflicts(
  result: ScanResult,
  observation: (id: string) => Transaction | undefined,
  workspace: Pick<Workspace, 'network'>,
): boolean {
  return (
    findingEvidenceConflicts(result, observation) ||
    result.directions.some((direction, index) =>
      edgeConflicts(result.path[index], result.path[index + 1], direction, observation, workspace),
    )
  );
}

/** Verify semantics and every edge whose evidence remains available. Missing evidence is explicit at Add path. */
export function validateConnectionScanRecords(
  records: ConnectionScanRecords,
  workspace: Pick<Workspace, 'transactions' | 'network'>,
  verifyWorkspaceConsistency = true,
): void {
  assertConnectionScanBudget(records);
  const retained = new Set<string>();
  const disputedTerminalOutpoints = new Set<string>();
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
      } else if (
        (result.kind === 'boundary' && !result.reason) ||
        result.relationship !== undefined ||
        switches !== 0
      ) {
        throw new Error('Scan boundary needs a stopping reason and a directed path.');
      }
      if (
        run.settings.direction !== 'both' &&
        result.directions.length &&
        result.directions[0] !== run.settings.direction
      )
        throw new Error('Scan result does not match the requested direction.');
      validateFindingMetadata(result, run);
      if (
        result.bridge !== undefined &&
        (result.bridge !== true || result.kind !== 'connection' || result.context)
      )
        throw new Error(
          'A scan bridge connects separate graph anchors without a known context route.',
        );
      const context = scanContextPath(result);
      if (result.meetingNode !== undefined) {
        const switchIndex = result.directions.findIndex(
          (item, i) => i > 0 && item !== result.directions[i - 1],
        );
        if (
          result.kind !== 'connection' ||
          result.relationship === 'direct' ||
          switchIndex < 0 ||
          result.meetingNode !== result.path[switchIndex]
        )
          throw new Error('Scan meeting node does not match the direction switch.');
      }
      const observation = (id: string) => workspace.transactions[id] ?? records.evidence[id];
      if (findingEvidenceConflicts(result, observation))
        throw new Error('Scan finding is not supported by its transaction observations.');
      if (context) {
        if (
          context.path.some((id) => (observation(transactionId(id))?.confirmations ?? 0) < 0) ||
          context.directions.some((direction, i) =>
            edgeConflicts(context.path[i], context.path[i + 1], direction, observation, workspace),
          )
        )
          throw new Error('Scan context is not supported by its transaction observations.');
      }
      for (const id of scanResultEvidenceIds(result)) retained.add(id);
      if (result.finding === 'conflicting-evidence') {
        const terminal = result.path.at(-1)!;
        const prior = result.path.at(-2);
        if (terminal.startsWith('out:')) disputedTerminalOutpoints.add(terminal);
        else if (prior?.startsWith('out:')) disputedTerminalOutpoints.add(prior);
      }
      for (const [i, direction] of result.directions.entries()) {
        // A conflict finding can retain its disputed final edge for review,
        // while every preceding edge must still match the observed transactions.
        if (
          !(result.finding === 'conflicting-evidence' && i === result.directions.length - 1) &&
          edgeConflicts(result.path[i], result.path[i + 1], direction, observation, workspace)
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
      }).entries(),
    ].some(([id, item]) => item.status === 'conflict' && !disputedTerminalOutpoints.has(id))
  )
    throw new Error('Scan evidence conflicts with previous-output observations.');
}

const SCAN_STATUS_ONLY_REASONS: readonly ScanStopReason[] = [
  'depth',
  'time',
  'transactions',
  'results',
  'cancelled',
  'backend-unavailable',
  'rate-limited',
  'offline',
];

const scanEdgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function scanReconnectionKey(result: ScanResult): string | undefined {
  if (!result.context) return;
  const edges = new Set<string>();
  for (const path of [result.path, result.context.path])
    path.slice(1).forEach((node, index) => edges.add(scanEdgeKey(path[index], node)));
  return JSON.stringify([result.path[0], [...edges].sort()]);
}

function scanMeetingNode(result: ScanResult): string | undefined {
  if (result.meetingNode) return result.meetingNode;
  const turn = result.directions.findIndex(
    (direction, index) => index > 0 && direction !== result.directions[index - 1],
  );
  return turn > 0 ? result.path[turn] : undefined;
}

function resultFinding(result: ScanResult): string | undefined {
  if (result.reason && SCAN_STATUS_ONLY_REASONS.includes(result.reason)) return;
  if (result.kind === 'connection') {
    if (result.relationship === 'shared-ancestor' || result.relationship === 'shared-descendant')
      return result.relationship;
    const direction = result.scanDirection ?? result.directions[0];
    return direction ? `${direction}-connection` : undefined;
  }
  if (result.finding) return result.finding;
  const direction = result.scanDirection ?? result.directions[0];
  if (result.reason === 'fan-out')
    return direction === 'upstream'
      ? 'many-inputs'
      : direction === 'downstream'
        ? 'many-outputs'
        : undefined;
  if (result.reason === 'unknown')
    return result.endpoint.startsWith('out:') && direction === 'downstream'
      ? 'spend-unknown'
      : 'transaction-unavailable';
  if (result.reason === 'failure') return 'lookup-failed';
}

function scanResultIdentity(source: string, result: ScanResult): string {
  const reconnection = scanReconnectionKey(result);
  if (reconnection) return JSON.stringify([source, 'reconnection', reconnection]);
  const group = [
    resultFinding(result),
    result.endpoint,
    scanMeetingNode(result) ?? '',
    result.scanDirection ?? result.directions[0] ?? '',
  ].join('|');
  return JSON.stringify([source, result.kind, group, result.path, result.directions]);
}

function deduplicateScanRuns(
  runs: readonly ScanRun[],
  previous: readonly ScanRun[] = [],
): ScanRun[] {
  const dismissed = new Set<string>();
  for (const run of [...previous, ...runs])
    for (const result of run.results)
      if (result.dismissed) dismissed.add(scanResultIdentity(run.source, result));
  const seen = new Set<string>();
  const retained: ScanRun[] = [];
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    const results: ScanResult[] = [];
    for (let resultIndex = run.results.length - 1; resultIndex >= 0; resultIndex--) {
      const result = run.results[resultIndex];
      const key = scanResultIdentity(run.source, result);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(
        dismissed.has(key) && !result.dismissed ? { ...result, dismissed: true } : result,
      );
    }
    results.reverse();
    if (results.length || index === runs.length - 1)
      retained.push(
        results.length === run.results.length &&
          results.every((result, resultIndex) => result === run.results[resultIndex])
          ? run
          : { ...run, results },
      );
  }
  return retained.reverse();
}

export function compactConnectionScanRecords(
  workspace: Workspace,
  runs: ScanRun[],
  supplied: Record<string, Transaction> = {},
): ConnectionScanRecords {
  runs = deduplicateScanRuns(runs, workspace.connectionScans?.runs);
  const available = { ...workspace.connectionScans?.evidence, ...supplied };
  const needed = new Set(
    runs.flatMap((run) => run.results.flatMap((result) => [...scanResultEvidenceIds(result)])),
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

/** Normalize validated imports and compact repeated finding paths with their proof. */
export function latestConnectionScanRecords(
  workspace: Workspace,
): ConnectionScanRecords | undefined {
  const runs = workspace.connectionScans?.runs;
  return runs?.length ? compactConnectionScanRecords(workspace, runs) : undefined;
}
