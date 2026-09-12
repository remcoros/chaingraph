import type { ScanResult } from './connectionScan';
import {
  addScanPath,
  prepareScanPath,
  scanContextPath,
  type ScanPathWorkspace,
} from './connectionScanRecords';
import { ensureGraphMembership } from './graphMembership';
import { indexPreviousOutputs, type PreviousOutputIndex } from './prevouts';
import { outputNodeId, type Workspace } from './types';

function additionResult(result: ScanResult, nodeIds: string[], creatorId: string): ScanResult {
  return {
    ...result,
    path: [...nodeIds, creatorId],
    endpoint: creatorId,
    directions: [...result.directions.slice(0, nodeIds.length - 1), 'upstream'],
    // The saved observation belongs to the original endpoint, checked separately.
    finding: undefined,
  };
}

const emptyEvidence: Workspace['transactions'] = Object.freeze({});
const previousOutputIndexes = new WeakMap<
  Workspace['transactions'],
  WeakMap<Workspace['transactions'], Partial<Record<Workspace['network'], PreviousOutputIndex>>>
>();

/** Card plans share an index while their immutable transaction and evidence maps are unchanged. */
function additionPreviousOutputs(workspace: ScanPathWorkspace): PreviousOutputIndex {
  const evidence = workspace.connectionScans?.evidence ?? emptyEvidence;
  let byEvidence = previousOutputIndexes.get(workspace.transactions);
  if (!byEvidence) {
    byEvidence = new WeakMap();
    previousOutputIndexes.set(workspace.transactions, byEvidence);
  }
  let byNetwork = byEvidence.get(evidence);
  if (!byNetwork) {
    byNetwork = {};
    byEvidence.set(evidence, byNetwork);
  }
  return (byNetwork[workspace.network] ??= indexPreviousOutputs({
    network: workspace.network,
    transactions:
      evidence === emptyEvidence
        ? workspace.transactions
        : { ...evidence, ...workspace.transactions },
  }));
}

function addedTransactionConflicts(workspace: ScanPathWorkspace, txid: string): boolean {
  const transaction = workspace.transactions[txid] ?? workspace.connectionScans?.evidence[txid];
  if (!transaction) return false;
  const index = additionPreviousOutputs(workspace);
  // New proof can contradict attached output facts outside the selected path.
  const affected = [
    ...transaction.vout.map((output) => outputNodeId(txid, output.n)),
    ...transaction.vin.flatMap((input) =>
      input.txid !== undefined && input.vout !== undefined
        ? [outputNodeId(input.txid, input.vout)]
        : [],
    ),
  ];
  return affected.some((id) => index.get(id)?.status === 'conflict');
}

/** The terminal creator is display context, included in Add without changing saved search hops. */
function prepareScanPrimaryPath(
  workspace: ScanPathWorkspace,
  result: ScanResult,
  prefixLength = result.path.length,
) {
  const base = prepareScanPath(workspace, result, prefixLength);
  const terminal = base.nodeIds.at(-1)!;
  const creatorId = terminal.startsWith('out:') ? `tx:${terminal.split(':')[1]}` : undefined;
  if (!creatorId || base.nodeIds.includes(creatorId)) return { ...base, creatorId: undefined };

  const prepared = prepareScanPath(workspace, additionResult(result, base.nodeIds, creatorId));
  let blockedByConflict = base.blockedByConflict || prepared.blockedByConflict;
  const creatorTxid = creatorId.slice(3);
  const creator = prepared.transactions[creatorTxid];
  if (creator) blockedByConflict ||= addedTransactionConflicts(workspace, creatorTxid);
  return { ...prepared, blockedByConflict, creatorId };
}

/** Full connection actions include both routes; a partial prefix stays explicitly bounded. */
export function prepareScanPathAddition(
  workspace: ScanPathWorkspace,
  result: ScanResult,
  prefixLength = result.path.length,
) {
  const primary = prepareScanPrimaryPath(workspace, result, prefixLength);
  if (prefixLength !== result.path.length || !result.context) return primary;
  try {
    const context = scanContextPath(result)!;
    const prepared = prepareScanPath(workspace, context);
    const transactions = { ...primary.transactions, ...prepared.transactions };
    return {
      ...primary,
      blockedByConflict:
        primary.blockedByConflict ||
        prepared.blockedByConflict ||
        Object.keys(transactions).some((txid) => addedTransactionConflicts(workspace, txid)),
      nodeIds: [...new Set([...primary.nodeIds, ...prepared.nodeIds])],
      newNodeIds: [...new Set([...primary.newNodeIds, ...prepared.newNodeIds])],
      missingTxids: [...new Set([...primary.missingTxids, ...prepared.missingTxids])],
      transactions,
    };
  } catch {
    return { ...primary, blockedByConflict: true };
  }
}

/** Add exactly the verified path and its displayed terminal creator in one undoable mutation. */
export function addScanPathAddition(
  workspace: Workspace,
  result: ScanResult,
  prefixLength = result.path.length,
): Workspace {
  const prepared = prepareScanPathAddition(workspace, result, prefixLength);
  if (prepared.blockedByConflict)
    throw new Error('Path evidence conflicts. Choose a preceding verified prefix.');
  if (prepared.missingTxids.length)
    throw new Error('Path evidence is missing. Reload it before adding this path.');
  // Seed legacy membership before new transaction observations enter the workspace.
  const initialized = ensureGraphMembership(workspace);
  const added = prepared.creatorId
    ? addScanPath(
        initialized,
        additionResult(result, result.path.slice(0, prefixLength), prepared.creatorId),
      )
    : addScanPath(initialized, result, prefixLength);
  const context = prefixLength === result.path.length ? scanContextPath(result) : undefined;
  return context ? addScanPath(added, context) : added;
}

function nodeResult(nodeId: string): ScanResult {
  return {
    id: 'node-addition',
    kind: 'boundary',
    reason: 'unknown',
    endpoint: nodeId,
    path: [nodeId],
    directions: [],
    hops: 0,
  };
}

/** Selecting one path node adds only that node, with its required transaction proof. */
export function prepareScanNodeAddition(workspace: Workspace, nodeId: string) {
  const prepared = prepareScanPath(workspace, nodeResult(nodeId));
  if (nodeId.startsWith('tx:')) {
    prepared.blockedByConflict ||= addedTransactionConflicts(workspace, nodeId.slice(3));
  } else if (nodeId.startsWith('out:')) {
    const [, txid, vout] = nodeId.split(':');
    const creator = workspace.transactions[txid] ?? workspace.connectionScans?.evidence[txid];
    const index = additionPreviousOutputs(workspace);
    prepared.blockedByConflict ||=
      !!creator && !creator.vout.some((output) => output.n === Number(vout));
    prepared.blockedByConflict ||= index.get(nodeId)?.status === 'conflict';
  }
  return prepared;
}

export function addScanNodeAddition(workspace: Workspace, nodeId: string): Workspace {
  const prepared = prepareScanNodeAddition(workspace, nodeId);
  if (prepared.blockedByConflict) throw new Error('Node evidence conflicts.');
  return addScanPath(ensureGraphMembership(workspace), nodeResult(nodeId));
}
