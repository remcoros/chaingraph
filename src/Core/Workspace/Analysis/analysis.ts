import { analysisToolRegistry } from './toolRegistry';

export { equalOutputCount, equalOutputGroups } from './toolRegistry';
export { defaultsFor } from './tools/shared';
export type {
  AnalysisTool,
  AnalysisScope,
  AnalysisKind,
  AnalysisOptions,
  AnalysisParameter,
  AnalysisRunReport,
} from './tools/shared';

// Pure client-side tools. Omitted transaction IDs include loaded history; [] means an empty scope.
export const analysisTools = analysisToolRegistry;
