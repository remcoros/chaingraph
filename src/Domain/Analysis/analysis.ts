import { equalOutputTool, ciohTool, reuseTool } from './tools/privacy';
import { valueFlowTool, structureTool, scriptTool } from './tools/value';
import { walletTool } from './tools/wallets';

export { equalOutputCount, equalOutputGroups } from './tools/privacy';
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
export const analysisTools = [
  equalOutputTool,
  ciohTool,
  reuseTool,
  valueFlowTool,
  structureTool,
  scriptTool,
  walletTool,
];
