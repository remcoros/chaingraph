import { analysisTools } from './analysis';
import type { AnalysisScan } from './analysisScan';
import { listTagsForNode } from './tags';
import type { Workspace } from './types';
import {
  REVIEW_REASONS,
  REASON_LABELS,
  type ReviewReason,
  type WalletReviewItem,
} from './walletReview';

export interface WalletReviewCategory {
  id: string;
  label: string;
  description: string;
  count: number;
  /** Registry-derived category, not an automatically executed analysis. */
  heuristic?: boolean;
  algorithm?: string;
  kind?: 'observation' | 'hypothesis';
}

const reasonDescriptions: Record<ReviewReason, string> = {
  'current-utxo':
    'All outputs reported unspent at the last verified UTXO check, regardless of metadata.',
  source:
    'Earlier wallet receipts directly spent in transactions creating the checked current UTXOs, not sender or exchange identities.',
  'source-address':
    'Direct input addresses with no match to the selected wallet, in loaded transactions paying it. No separate controller is proven.',
  'funding-source':
    'Direct funding outputs without address evidence, plus saved output-only decisions retained separately from address reviews.',
  'new-activity':
    'Activity retained for review after a wallet refresh, including unloaded history entries.',
  'destination-address':
    'Output addresses with no match to the selected wallet, in transactions spending its verified outputs. No controller is identified.',
  counterparty:
    'Destination outputs without address evidence, plus saved output-only decisions retained separately from address reviews.',
  link: 'Active, non-stale saved analysis findings affecting this wallet. Observations and hypotheses retain their original evidence.',
};

const metadataCategories = [
  {
    id: 'unidentified-sources',
    label: 'Unidentified direct sources',
    description:
      'Source address review subjects with neither a nonblank address label nor effective address tags. Output reviews and missing-address exceptions do not add to this count.',
  },
  {
    id: 'unidentified-destinations',
    label: 'Unidentified direct destinations',
    description:
      'Destination address review subjects with neither a nonblank address label nor effective address tags. Output reviews do not add to this count; no-match does not prove external ownership.',
  },
  {
    id: 'utxo-missing-label',
    label: 'UTXOs missing labels',
    description:
      'Current UTXO review subjects with no nonblank label on the output itself. Tags, notes and icons do not count as labels.',
  },
  {
    id: 'utxo-missing-tags',
    label: 'UTXOs missing tags',
    description:
      'Current UTXO review subjects with no effective output or verified-address tags. Labels do not count as tags.',
  },
  {
    id: 'utxo-unidentified',
    label: 'UTXOs missing labels and tags',
    description:
      'Current UTXO review subjects with neither a nonblank output label nor effective tags.',
  },
] as const;

function effectiveMetadata(workspace: Workspace, item: WalletReviewItem) {
  const label = (workspace.annotations[item.nodeId]?.label ?? item.label).trim();
  const tags = listTagsForNode(workspace, {
    id: item.nodeId,
    kind: item.nodeId.startsWith('tx:')
      ? 'transaction'
      : item.nodeId.startsWith('addr:')
        ? 'address'
        : 'output',
    label,
    address: item.address,
  });
  return { labelled: !!label, tagged: tags.some((tag) => !!tag.name.trim()) };
}

function algorithmFor(workspace: Workspace, item: WalletReviewItem): string | undefined {
  if (item.reason !== 'link') return undefined;
  return (
    item.algorithm ??
    workspace.findings.find((finding) => item.key.endsWith(`|link|${finding.id}`))?.algorithm
  );
}

function categoryIds(workspace: Workspace, item: WalletReviewItem): Set<string> {
  const ids = new Set<string>([item.reason]);
  const { labelled, tagged } = effectiveMetadata(workspace, item);
  if (item.reason === 'current-utxo') {
    if (!labelled) ids.add('utxo-missing-label');
    if (!tagged) ids.add('utxo-missing-tags');
    if (!labelled && !tagged) ids.add('utxo-unidentified');
  }
  if (!labelled && !tagged && item.nodeId.startsWith('addr:') && item.ownership === 'external') {
    if (item.reason === 'source-address') ids.add('unidentified-sources');
    if (item.reason === 'destination-address') ids.add('unidentified-destinations');
  }
  const algorithm = algorithmFor(workspace, item);
  for (const tool of analysisTools)
    if (algorithm === tool.id || algorithm?.startsWith(`${tool.id}-v`))
      ids.add(`heuristic:${tool.id}`);
  return ids;
}

/** Every supported category is present, including zero counts. Supply candidates
 * after other filters but before category selection; overlapping counts are intentional. */
export function walletReviewCategories(
  workspace: Workspace,
  items: readonly WalletReviewItem[],
): WalletReviewCategory[] {
  const counts = new Map<string, number>();
  for (const item of items)
    for (const id of categoryIds(workspace, item)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const definitions: Omit<WalletReviewCategory, 'count'>[] = [
    ...REVIEW_REASONS.map((reason) => ({
      id: reason,
      label: reason === 'current-utxo' ? 'All current UTXOs' : REASON_LABELS[reason],
      description: reasonDescriptions[reason],
    })),
    ...metadataCategories,
    ...analysisTools.map((tool) => ({
      id: `heuristic:${tool.id}`,
      label: tool.name,
      description: `${tool.description} Saved ${tool.kind === 'hypothesis' ? 'hypotheses, not ownership proof' : 'observations, not ownership claims'} only; choosing this type does not run a scan.`,
      heuristic: true,
      algorithm: tool.id,
      kind: tool.kind,
    })),
  ];
  return definitions.map((category) => ({ ...category, count: counts.get(category.id) ?? 0 }));
}

/** Union (OR), never an intersection. An empty selection intentionally matches nothing. */
export function matchesReviewCategories(
  item: WalletReviewItem,
  selected: readonly string[] | ReadonlySet<string>,
  workspace: Workspace,
): boolean {
  const ids = categoryIds(workspace, item);
  for (const id of selected) if (ids.has(id)) return true;
  return false;
}

export interface WalletReviewCategoryScanState {
  status: 'not-scanned' | 'saved-findings' | 'scanned';
  runAt?: string;
  /** Saved findings alone do not establish scan coverage or a successful zero result. */
  partial: boolean;
  tools: {
    id: string;
    status: 'not-scanned' | 'saved-findings' | 'complete' | 'skipped' | 'error';
  }[];
}

/** Scan execution is session state, separate from category counts. An absent
 * report never establishes that an algorithm ran and found zero results. */
export function walletReviewCategoryScanState(
  workspace: Workspace,
  scan?: AnalysisScan,
): WalletReviewCategoryScanState {
  const tools: WalletReviewCategoryScanState['tools'] = analysisTools.map((tool) => {
    const report = scan?.reports.find((entry) => entry.toolId === tool.id);
    const saved = workspace.findings.some(
      (finding) => finding.algorithm === tool.id || finding.algorithm.startsWith(`${tool.id}-v`),
    );
    return {
      id: tool.id,
      status: report?.status ?? (saved ? 'saved-findings' : 'not-scanned'),
    };
  });
  return {
    status: scan
      ? 'scanned'
      : tools.some((tool) => tool.status === 'saved-findings')
        ? 'saved-findings'
        : 'not-scanned',
    runAt: scan?.runAt,
    partial:
      !scan || scan.scope.kind !== 'workspace' || tools.some((tool) => tool.status !== 'complete'),
    tools,
  };
}
