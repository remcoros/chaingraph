import { stableKey } from '../Analysis/tools/shared';
import { findingAssessmentInputs } from '../Analysis/findingStaleness';
import type { AnalysisFinding } from '../Analysis/finding';
import { indexPreviousOutputs, type PreviousOutputIndex } from '../../ChainData';
import type { Workspace } from '../workspace';

function findingReferences(finding: AnalysisFinding): string {
  return `link|${finding.algorithm}|${[...(finding.subjects ?? [])].sort().join(',')}|${[...finding.nodeIds].sort().join(',')}|${[...finding.txids].sort().join(',')}`;
}

/** The pre-goal assessment format, retained only to recognize migration eligibility. */
export function legacyWalletFindingEvidence(finding: AnalysisFinding): string {
  return stableKey(findingReferences(finding)).slice(0, 16);
}

/** Analysis supplies material support; observations such as confirmation dates are excluded. */
export function walletFindingEvidence(
  workspace: Workspace,
  finding: AnalysisFinding,
  previousOutputs?: PreviousOutputIndex,
): string {
  return stableKey(
    `${findingReferences(finding)}|${findingAssessmentInputs(workspace, finding, previousOutputs)}`,
  ).slice(0, 16);
}

/**
 * Run once when decoding a pre-v8, validated document. Preserve the original
 * assessment and baseline its currently saved support, never fresh network data.
 */
export function initializeLegacyFindingEvidence(workspace: Workspace): Workspace {
  if (!workspace.wallets.reviews) return workspace;
  const findings = new Map(workspace.analysis.findings.map((finding) => [finding.id, finding]));
  const evidence = new Map<string, string>();
  let reviews = workspace.wallets.reviews;
  let previousOutputs: PreviousOutputIndex | undefined;
  for (const [key, record] of Object.entries(workspace.wallets.reviews)) {
    if (record.kind || record.supportEvidence !== undefined) continue;
    const match = /^[^|]+\|link\|(.+)$/.exec(key);
    const finding = match ? findings.get(match[1]) : undefined;
    if (
      !finding ||
      finding.stale ||
      !finding.subjects?.length ||
      record.evidence !== legacyWalletFindingEvidence(finding)
    )
      continue;
    let supportEvidence = evidence.get(finding.id);
    if (!supportEvidence) {
      previousOutputs ??= indexPreviousOutputs({
        network: workspace.network,
        transactions: workspace.chainData.transactions,
      });
      supportEvidence = walletFindingEvidence(workspace, finding, previousOutputs);
      evidence.set(finding.id, supportEvidence);
    }
    if (reviews === workspace.wallets.reviews) reviews = { ...reviews };
    reviews[key] = { ...record, supportEvidence };
  }
  return reviews === workspace.wallets.reviews
    ? workspace
    : { ...workspace, wallets: { ...workspace.wallets, reviews } };
}
