import { equalOutputTool, ciohTool, reuseTool } from './analysis/privacy';
import { valueFlowTool, structureTool, scriptTool } from './analysis/value';
import { walletTool } from './analysis/wallets';

export { equalOutputCount, equalOutputGroups } from './analysis/privacy';
export { defaultsFor } from './analysis/shared';
export type {
  AnalysisTool,
  AnalysisScope,
  AnalysisKind,
  AnalysisOptions,
  AnalysisParameter,
  AnalysisRunReport,
} from './analysis/shared';

// Pure client-side tools. Omitted transaction IDs include loaded history; [] means an empty scope.
export const analysisTools = [
  equalOutputTool,
  ciohTool,
  reuseTool,
  valueFlowTool,
  structureTool,
  scriptTool,
  walletTool,
];
