import { analysisTools } from '../../../../../Core/Workspace/Analysis/analysis';
import { analysisToolGroups } from '../../../../../Core/Workspace/Analysis/toolRegistry';
import type { AnalysisScan } from '../../../../../Core/Workspace/Analysis/analysisScan';
import { listTagsForNode } from '../../../../../Core/Workspace/Annotations/tagMembership';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { WalletReviewItem } from '../../../../../Core/Workspace/Wallets/walletReview';
import {
  previousOutputDecisionsCategory,
  walletMetadataCategoryDefinitions,
  walletReviewGroups,
  walletReviewGroupsInDisplayOrder,
  walletReviewReasonCategoryDefinitions,
  type WalletReviewCategoryDefinition,
} from './reviewCategoryDefinitions';

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

export interface WalletReviewCategoryGroup {
  id: string;
  label: string;
  options: WalletReviewCategory[];
}

export type WalletReviewCategoryWorkspace = Pick<Workspace, 'annotations' | 'analysis'> & {
  wallets: Pick<Workspace['wallets'], 'reviews'>;
};

function effectiveMetadata(workspace: WalletReviewCategoryWorkspace, item: WalletReviewItem) {
  const label = (workspace.annotations.entities[item.nodeId]?.label ?? item.label).trim();
  const tags = listTagsForNode(workspace, {
    id: item.nodeId,
    kind: item.nodeId.startsWith('tx:')
      ? 'transaction'
      : item.nodeId.startsWith('addr:')
        ? 'address'
        : 'output',
    address: item.address,
  });
  return { labelled: !!label, tagged: tags.some((tag) => !!tag.name.trim()) };
}

function algorithmFor(
  workspace: Pick<WalletReviewCategoryWorkspace, 'analysis'>,
  item: WalletReviewItem,
): string | undefined {
  if (item.reason !== 'link') return undefined;
  return (
    item.algorithm ??
    workspace.analysis.findings.find((finding) => item.key.endsWith(`|link|${finding.id}`))
      ?.algorithm
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

/** Every supported category is present, including zero counts. The caller chooses
 * the count population; overlapping counts are intentional. */
export function walletReviewCategoryGroups(
  workspace: WalletReviewCategoryWorkspace,
  items: readonly WalletReviewItem[],
): WalletReviewCategoryGroup[] {
  const counts = new Map<string, number>();
  for (const item of items)
    for (const id of categoryIds(workspace, item)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const counted = (definitions: readonly Omit<WalletReviewCategory, 'count'>[]) =>
    definitions.map((category) => ({ ...category, count: counts.get(category.id) ?? 0 }));
  const fixedDefinitions: WalletReviewCategoryDefinition[] = [
    ...walletReviewReasonCategoryDefinitions,
    ...(items.some((item) => item.reason === 'counterparty' || item.reason === 'funding-source') ||
    Object.keys(workspace.wallets.reviews ?? {}).some(
      (key) => key.includes('|counterparty|') || key.includes('|funding-source|'),
    )
      ? [previousOutputDecisionsCategory]
      : []),
    ...walletMetadataCategoryDefinitions,
  ];
  const groups: WalletReviewCategoryGroup[] = [
    ...Object.values(walletReviewGroups).map((group) => ({
      id: group.id,
      label: group.label,
      options: fixedDefinitions
        .filter((definition) => definition.group.id === group.id)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((definition) => ({
          id: definition.id,
          label: definition.label,
          description: definition.description,
          count: counts.get(definition.id) ?? 0,
        })),
    })),
    ...analysisToolGroups.map((group) => ({
      id: group.id,
      label: group.label,
      options: counted(
        group.tools.map((tool) => ({
          id: `heuristic:${tool.id}`,
          label: tool.name,
          description: tool.description,
          heuristic: true,
          algorithm: tool.id,
          kind: tool.kind,
        })),
      ),
    })),
  ];
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return walletReviewGroupsInDisplayOrder.map((group) => groupsById.get(group.id)!);
}

export function walletReviewCategories(
  workspace: WalletReviewCategoryWorkspace,
  items: readonly WalletReviewItem[],
): WalletReviewCategory[] {
  return walletReviewCategoryGroups(workspace, items).flatMap((group) => group.options);
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
  workspace: { analysis: Pick<Workspace['analysis'], 'findings'> },
  scan?: AnalysisScan,
): WalletReviewCategoryScanState {
  const tools: WalletReviewCategoryScanState['tools'] = analysisTools.map((tool) => {
    const report = scan?.reports.find((entry) => entry.toolId === tool.id);
    const saved = workspace.analysis.findings.some(
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
