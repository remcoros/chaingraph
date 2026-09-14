import { analysisTools } from './analysis';
import type { AnalysisFinding } from '../types';

export const reviewPriorities = ['high', 'medium', 'low'] as const;
export type ReviewPriority = (typeof reviewPriorities)[number];

/** Review order, never confidence, ownership certainty or a security rating.
 * Legacy findings remain readable; a rerun supplies domain-specific rules.
 */
export function findingReview(finding: AnalysisFinding): {
  priority: ReviewPriority;
  reason: string;
} {
  if (finding.kind === 'incomplete')
    return {
      priority: 'low',
      reason: 'The available data is incomplete or cannot be reconciled.',
    };
  if (finding.reviewRule === 'fee-threshold')
    return { priority: 'high', reason: 'The reconciled fee rate meets your scan threshold.' };
  if (finding.reviewRule === 'repeated-address')
    return {
      priority: 'medium',
      reason: 'The same address appears in separate scoped transactions.',
    };
  if (finding.reviewRule === 'distinct-wallet-inputs')
    return {
      priority: 'medium',
      reason:
        'Inputs match different wallet records without overlapping import coverage. This does not identify owners.',
    };
  if (finding.kind === 'hypothesis' || !finding.kind)
    return { priority: 'medium', reason: 'Review the assumptions before using this hypothesis.' };
  return {
    priority: 'low',
    reason:
      'Useful context with no higher-priority review trigger. Older findings may need a rerun.',
  };
}

export const findingToolId = (finding: AnalysisFinding) =>
  analysisTools.find((tool) => finding.algorithm.startsWith(`${tool.id}-`))?.id;

export interface FindingFilters {
  types: readonly string[];
  priorities: readonly ReviewPriority[];
  kind: string;
}

/** OR within each facet, AND across facets. Counts ignore their own facet. */
export function filterAnalysisFindings(findings: AnalysisFinding[], filters: FindingFilters) {
  const evidence = findings.filter(
    (finding) => filters.kind === 'all' || (finding.kind ?? 'hypothesis') === filters.kind,
  );
  const matchesType = (finding: AnalysisFinding) =>
    filters.types.includes(findingToolId(finding) ?? 'unregistered');
  const matchesPriority = (finding: AnalysisFinding) =>
    filters.priorities.includes(findingReview(finding).priority);
  const types = new Map(analysisTools.map((tool) => [tool.id, 0]));
  const priorities = { high: 0, medium: 0, low: 0 };
  for (const finding of evidence) {
    const id = findingToolId(finding) ?? 'unregistered';
    if (matchesPriority(finding)) types.set(id, (types.get(id) ?? 0) + 1);
    if (matchesType(finding)) priorities[findingReview(finding).priority]++;
  }
  return {
    findings: evidence.filter((finding) => matchesType(finding) && matchesPriority(finding)),
    types,
    priorities,
  };
}
