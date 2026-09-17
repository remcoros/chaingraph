import type { ScanResult } from '../../../../../Core/Workspace/ConnectionScan/connectionScans';
import { isScanNodeId } from '../../../../../Core/Workspace/ConnectionScan/scanNode';
import {
  compactConnectionScanRecords,
  scanResultConflicts,
  scanResultEvidenceIds,
} from '../../../../../Core/Workspace/ConnectionScan/records';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import { outpointReference } from '../../../../../Core/Workspace/entityReferences';

import { addGraphNodes } from '../../../GraphState/graphMembership';
import { previousOutputsConflict } from '../../../../../Core/Bitcoin';

import { buildGraph, type GraphEvidenceWorkspace } from '../../../GraphState/graphEvidence';
import { clearContextProvenance } from '../../../../../Core/Workspace/transactionContext';

export type ScanPathWorkspace = GraphEvidenceWorkspace &
  Pick<Workspace, 'connectionScans'> & {
    view: Pick<Workspace['view'], 'showAddresses' | 'graphNodeIds'>;
  };

const transactionId = (id: string) => id.split(':')[1];

/** Update one scan, keeping the newest copy of repeated finding paths. */
const membershipCache = new WeakMap<string[], Set<string>>();
function scanMembership(workspace: ScanPathWorkspace): Set<string> {
  const ids = workspace.view.graphNodeIds ?? buildGraph(workspace).nodes.map((node) => node.id);
  let membership = membershipCache.get(ids);
  if (!membership) {
    membership = new Set(ids);
    membershipCache.set(ids, membership);
  }
  return membership;
}

export function prepareScanPath(
  workspace: ScanPathWorkspace,
  result: ScanResult,
  prefixLength = result.path.length,
) {
  if (!Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > result.path.length)
    throw new Error('Choose an explicit nonempty path prefix.');
  const nodeIds = result.path.slice(0, prefixLength);
  const prefix = {
    ...result,
    context: undefined,
    path: nodeIds,
    endpoint: nodeIds.at(-1)!,
    finding: prefixLength === result.path.length ? result.finding : undefined,
    directions: result.directions.slice(0, prefixLength - 1),
  };
  const observation = (id: string) =>
    workspace.chainData.transactions[id] ?? workspace.connectionScans?.evidence[id];
  let blockedByConflict =
    (result.finding === 'conflicting-evidence' && prefixLength === result.path.length) ||
    result.directions.length !== result.path.length - 1 ||
    nodeIds.some(
      (id) => !isScanNodeId(id) || (observation(transactionId(id))?.status?.confirmations ?? 0) < 0,
    ) ||
    new Set(nodeIds).size !== nodeIds.length;
  let needed: Set<string>;
  try {
    needed = scanResultEvidenceIds(prefix);
  } catch {
    blockedByConflict = true;
    needed = new Set(nodeIds.filter((id) => id.startsWith('tx:')).map(transactionId));
  }
  // A single isolated outpoint also needs a creator or a loaded spending observation.
  if (
    nodeIds.length === 1 &&
    nodeIds[0].startsWith('out:') &&
    !['unspent', 'unspendable'].includes(prefix.finding ?? '') &&
    Object.values(workspace.chainData.transactions).some((tx) =>
      tx.vin.some(
        (input) =>
          input.txid !== undefined &&
          input.vout !== undefined &&
          outpointReference(input.txid, input.vout) === nodeIds[0],
      ),
    )
  )
    needed.delete(transactionId(nodeIds[0]));
  const missingTxids = [...needed].filter((id) => !observation(id));
  const transactions = Object.fromEntries(
    [...needed].filter((id) => observation(id)).map((id) => [id, observation(id)!]),
  );
  try {
    blockedByConflict ||= scanResultConflicts(prefix, observation, workspace.network);
  } catch {
    blockedByConflict = true;
  }
  // Adding complete transaction observations must not introduce a contradictory
  // input outside the selected canvas prefix either.
  blockedByConflict ||= Object.values(transactions).some((tx) =>
    tx.vin.some((input) => {
      if (input.txid === undefined || input.vout === undefined) return false;
      const creator = observation(input.txid);
      if (!creator) return false;
      const output = creator.vout.find((output) => output.n === input.vout);
      return (
        !output ||
        (!!input.prevout &&
          previousOutputsConflict(output, { n: input.vout, ...input.prevout }, workspace.network))
      );
    }),
  );
  const membership = scanMembership(workspace);
  return {
    blockedByConflict,
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
  if (prepared.blockedByConflict)
    throw new Error('Path evidence conflicts. Choose a preceding verified prefix.');
  if (prepared.missingTxids.length)
    throw new Error(
      'Path evidence is missing. Rerun the scan to reload it before adding this path.',
    );
  const merged = {
    ...workspace,
    view: { ...workspace.view, filters: undefined, smallAmountThreshold: 0 },
    chainData: {
      ...workspace.chainData,
      transactions: { ...workspace.chainData.transactions, ...prepared.transactions },
    },
  };
  const added = addGraphNodes(
    clearContextProvenance(merged, Object.keys(prepared.transactions)),
    prepared.nodeIds,
  );
  return added.connectionScans
    ? {
        ...added,
        connectionScans: compactConnectionScanRecords(
          added.connectionScans,
          added.chainData.transactions,
          added.connectionScans.runs,
        ),
      }
    : added;
}
