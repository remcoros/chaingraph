import { analysisTools } from '../../../Analysis/analysis';
import type { AnalysisScan } from '../../../Analysis/analysisScan';
import { listTagsForNode } from '../../../Annotations/tagProjection';
import type { Workspace } from '../../../workspace';
import {
  REVIEW_REASONS,
  REASON_LABELS,
  type ReviewReason,
  type WalletReviewItem,
} from '../../../Wallet/walletReview';

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
    'Coins in this wallet that were unspent at the last UTXO check. This includes coins you have already labelled or tagged, so you can review everything the check found.',
  'wallet-address':
    'Receiving and change addresses in this wallet that have been used. Add labels to remember what you used them for; unused addresses are left out of the review list.',
  source:
    'Earlier coins received by this wallet and later spent in transactions that created your current UTXOs. These receipts let you look back one step in your wallet’s history.',
  'source-address':
    'Addresses used to fund transactions that paid this wallet. They do not match its known addresses, but may still belong to you. Add a label if you recognize the sender or source.',
  'funding-source':
    'Your saved reviews of individual outputs that funded this wallet. These earlier decisions remain available to revisit; new source reviews are grouped by address.',
  'new-activity':
    'Transaction activity found during a wallet refresh and kept here for you to review. Some transactions may still need to be loaded before you can see their details.',
  'destination-address':
    'Addresses paid by transactions that spent coins from this wallet. They do not match its known addresses, but may still belong to you. Add a label if you recognize the recipient or purpose.',
  counterparty:
    'Your saved reviews of individual outputs created when this wallet spent coins. These earlier decisions remain available to revisit; new destination reviews are grouped by address.',
  link: 'Analysis findings involving this wallet that are still current. Open a finding to see the pattern it detected and the transactions behind it, then decide whether it helps explain your wallet’s activity.',
};

const metadataCategories = [
  {
    id: 'unidentified-sources',
    label: 'Unidentified direct sources',
    description:
      'Source addresses with no label or tags to help you recognize them. Use this list to record where incoming payments came from. Labels on individual coins do not label the address itself.',
  },
  {
    id: 'unidentified-destinations',
    label: 'Unidentified direct destinations',
    description:
      'Destination addresses with no label or tags to help you recognize them. Use this list to record who you paid or why you moved the coins. An address here may still belong to you.',
  },
  {
    id: 'utxo-missing-label',
    label: 'UTXOs missing labels',
    description:
      'Current unspent coins that have no label of their own. Add a short name to remember where a coin came from or what you are keeping it for. Coins with tags or notes can still appear here.',
  },
  {
    id: 'utxo-missing-tags',
    label: 'UTXOs missing tags',
    description:
      'Current unspent coins with no tags, either on the coin itself or inherited from its address. Tags help you group coins by source, purpose or another meaning you choose.',
  },
  {
    id: 'utxo-unidentified',
    label: 'UTXOs missing labels and tags',
    description:
      'Current unspent coins with neither a label of their own nor any tags, including tags inherited from their address. Use this list to start organizing your coins.',
  },
] as const;

export type WalletReviewCategoryWorkspace = Pick<
  Workspace,
  'annotations' | 'tags' | 'findings' | 'walletReviews'
>;

function effectiveMetadata(workspace: WalletReviewCategoryWorkspace, item: WalletReviewItem) {
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

function algorithmFor(
  workspace: Pick<WalletReviewCategoryWorkspace, 'findings'>,
  item: WalletReviewItem,
): string | undefined {
  if (item.reason !== 'link') return undefined;
  return (
    item.algorithm ??
    workspace.findings.find((finding) => item.key.endsWith(`|link|${finding.id}`))?.algorithm
  );
}

function categoryIds(
  workspace: WalletReviewCategoryWorkspace,
  item: WalletReviewItem,
): Set<string> {
  const ids = new Set<string>([item.reason]);
  if (item.reason === 'counterparty' || item.reason === 'funding-source')
    ids.add('saved-output-reviews');
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
  workspace: WalletReviewCategoryWorkspace,
  items: readonly WalletReviewItem[],
): WalletReviewCategory[] {
  const counts = new Map<string, number>();
  for (const item of items)
    for (const id of categoryIds(workspace, item)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const definitions: Omit<WalletReviewCategory, 'count'>[] = [
    ...REVIEW_REASONS.filter(
      (reason) => reason !== 'counterparty' && reason !== 'funding-source',
    ).map((reason) => ({
      id: reason,
      label: reason === 'current-utxo' ? 'All current UTXOs' : REASON_LABELS[reason],
      description: reasonDescriptions[reason],
    })),
    ...(items.some((item) => item.reason === 'counterparty' || item.reason === 'funding-source') ||
    Object.keys(workspace.walletReviews ?? {}).some(
      (key) => key.includes('|counterparty|') || key.includes('|funding-source|'),
    )
      ? [
          {
            id: 'saved-output-reviews',
            label: 'Previous output decisions',
            description:
              'Decisions you saved when reviews were made for individual outputs. You can revisit those decisions here. New source and destination reviews bring related activity together under each address.',
          },
        ]
      : []),
    ...metadataCategories,
    ...analysisTools.map((tool) => ({
      id: `heuristic:${tool.id}`,
      label: tool.name,
      description: tool.description,
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
  workspace: WalletReviewCategoryWorkspace,
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
  workspace: Pick<Workspace, 'findings'>,
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
