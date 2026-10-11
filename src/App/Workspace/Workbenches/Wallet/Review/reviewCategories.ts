import { analysisTools } from '../../../../../Core/Workspace/Analysis/analysis';
import { analysisToolGroups } from '../../../../../Core/Workspace/Analysis/toolRegistry';
import type { AnalysisScan } from '../../../../../Core/Workspace/Analysis/analysisScan';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type {
  WalletReviewGroup,
  WalletReviewItem,
} from '../../../../../Core/Workspace/Wallets/walletReview';
import {
  olderOrUnknownFindingsCategory,
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

function algorithmFor(
  workspace: Pick<WalletReviewCategoryWorkspace, 'analysis'>,
  item: WalletReviewItem,
): string | undefined {
  if (item.kind !== 'finding' || item.reason !== 'link') return undefined;
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
  const ids = new Set<string>();
  if (item.legacyOutputReview) return ids;
  if (item.kind === 'annotation-goal') {
    if (item.goal === 'activity-context') ids.add('wallet-transaction');
    else if (item.goal === 'coin-context') ids.add('current-utxo');
    else if (item.goal === 'counterparty-context') {
      if (item.relationshipKinds?.includes('source')) ids.add('source-address');
      if (item.relationshipKinds?.includes('destination')) ids.add('destination-address');
    }
    return ids;
  }
  const algorithm = algorithmFor(workspace, item);
  const tool = analysisTools.find(
    (candidate) => algorithm === candidate.id || algorithm?.startsWith(`${candidate.id}-v`),
  );
  if (tool) ids.add(`heuristic:${tool.id}`);
  else if (item.kind === 'finding' && item.reason === 'link')
    ids.add(olderOrUnknownFindingsCategory.id);
  return ids;
}

/** Count transaction groups, not questions, coins or repeated finding scopes.
 * The caller supplies the population and may retain resolved goals for history. */
export function walletReviewCategoryGroups(
  workspace: WalletReviewCategoryWorkspace,
  items: readonly WalletReviewItem[],
  taskGroups?: readonly Pick<WalletReviewGroup, 'key' | 'items'>[],
): WalletReviewCategoryGroup[] {
  const groupKeys = new Map<string, Set<string>>();
  for (const group of taskGroups ?? [])
    for (const item of group.items) {
      const keys = groupKeys.get(item.key) ?? new Set<string>();
      keys.add(group.key);
      groupKeys.set(item.key, keys);
    }
  const matches = new Map<string, Set<string>>();
  for (const item of items) {
    const transactionId = item.txid ?? item.transactionIds?.[0];
    const keys =
      groupKeys.get(item.key) ??
      new Set([transactionId ? `tx:${transactionId}` : `task:${item.key}`]);
    for (const id of categoryIds(workspace, item)) {
      const matchingGroups = matches.get(id) ?? new Set<string>();
      for (const key of keys) matchingGroups.add(key);
      matches.set(id, matchingGroups);
    }
  }
  const counts = new Map([...matches].map(([id, keys]) => [id, keys.size]));
  const counted = (definitions: readonly Omit<WalletReviewCategory, 'count'>[]) =>
    definitions.map((category) => ({ ...category, count: counts.get(category.id) ?? 0 }));
  const fixedDefinitions: WalletReviewCategoryDefinition[] = [
    ...walletReviewReasonCategoryDefinitions,
    ...(counts.has(olderOrUnknownFindingsCategory.id) ? [olderOrUnknownFindingsCategory] : []),
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
  groups?: readonly Pick<WalletReviewGroup, 'key' | 'items'>[],
): WalletReviewCategory[] {
  return walletReviewCategoryGroups(workspace, items, groups).flatMap((group) => group.options);
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
