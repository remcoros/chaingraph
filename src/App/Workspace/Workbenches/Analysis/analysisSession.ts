import type { AnalysisScan, scanDefaults } from '../../../../Domain/Analysis/analysisScan';
import type { ReviewPriority } from '../../../../Domain/Analysis/analysisReview';

/**
 * Retained analysis state for one workspace: the last scan, its scope and the
 * reader's filters.
 *
 * The workspace controller holds the cache across workbench switches, so the
 * shape is a contract both sides import rather than one reaching into the other.
 */
export interface AnalysisSession {
  scopeMode?: string;
  options: ReturnType<typeof scanDefaults>;
  scan?: AnalysisScan;
  selectedId?: string;
  kind: string;
  types?: string[];
  priorities?: ReviewPriority[];
  notice?: string;
  limit: number;
  autoLoad?: boolean;
}
