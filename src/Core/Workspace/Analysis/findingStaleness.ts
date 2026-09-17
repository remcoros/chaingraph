import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputIndex,
  type Transaction,
} from '../../ChainData';

import type { WorkspaceDocument } from '../workspace';
import type { AnalysisFinding } from './finding';

function inputStructure(transaction: Transaction) {
  return transaction.vin.map(({ prevout: _prevout, ...input }) => input);
}

/** Analysis owns these dependencies. A new confirmation is not new structure. */
export function findingInputs(
  workspace: WorkspaceDocument,
  finding: Pick<AnalysisFinding, 'algorithm' | 'txids' | 'scopeTxids'>,
  previousOutputs?: PreviousOutputIndex,
) {
  const tool = finding.algorithm.replace(/-v\d+$/, '');
  const scope = tool === 'address-reuse' ? (finding.scopeTxids ?? finding.txids) : finding.txids;
  const native = { network: workspace.network, transactions: workspace.chainData.transactions };
  const needsInputs = !['equal-outputs', 'address-reuse'].includes(tool);
  const index = needsInputs ? (previousOutputs ?? indexPreviousOutputs(native)) : undefined;
  const transactions = [...new Set(scope)].sort().map((id) => {
    const tx = native.transactions[id];
    if (!tx) return [id, null];
    return [
      id,
      {
        outputs: tx.vout,
        inputs: inputStructure(tx),
        ...(needsInputs
          ? {
              previousOutputs: tx.vin.map((input) => {
                const result = resolvePreviousOutput(native, input, index);
                // Loading a previously attached output does not change its meaning.
                return result.status === 'loaded' || result.status === 'attached'
                  ? { output: result.output }
                  : { status: result.status };
              }),
            }
          : {}),
        ...(tool === 'value-flow' ? { vsize: tx.vsize } : {}),
      },
    ];
  });
  return JSON.stringify({
    network: workspace.network,
    transactions,
    ...(tool === 'wallet-intersections'
      ? {
          wallets: workspace.wallets.definitions
            .map((wallet) => ({
              id: wallet.id,
              name: wallet.name,
              key: wallet.key,
              scriptType: wallet.scriptType,
              addresses: wallet.addresses.map(({ address, scripthash }) => ({
                address,
                scripthash,
              })),
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        }
      : {}),
  });
}

/** Keep saved explanations, exclusions and IDs; only the owner marks changed support stale. */
export function invalidateFindings(
  before: WorkspaceDocument,
  after: WorkspaceDocument,
): WorkspaceDocument {
  if (!after.analysis.findings.length) return after;
  if (
    before.chainData.transactions === after.chainData.transactions &&
    before.wallets.definitions === after.wallets.definitions
  )
    return after;
  let changed = false;
  const beforeIndex = indexPreviousOutputs({
    network: before.network,
    transactions: before.chainData.transactions,
  });
  const afterIndex = indexPreviousOutputs({
    network: after.network,
    transactions: after.chainData.transactions,
  });
  const existing = new Map(before.analysis.findings.map((finding) => [finding.id, finding]));
  const findings = after.analysis.findings.map((finding) => {
    // New/recomputed findings already describe the new document.
    if (finding.stale || existing.get(finding.id) !== finding) return finding;
    if (findingInputs(before, finding, beforeIndex) === findingInputs(after, finding, afterIndex))
      return finding;
    changed = true;
    return { ...finding, stale: true };
  });
  return changed ? { ...after, analysis: { ...after.analysis, findings } } : after;
}
