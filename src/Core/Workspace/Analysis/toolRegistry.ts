import { reuseTool } from './tools/addressReuse';
import { ciohTool } from './tools/coSpentInputs';
import { equalOutputCount, equalOutputGroups, equalOutputTool } from './tools/equalOutputs';
import { scriptTool } from './tools/scriptTypes';
import { structureTool } from './tools/transactionShapes';
import { valueFlowTool } from './tools/valueFlow';
import { walletTool } from './tools/walletIntersections';
import { toolGroupsInDisplayOrder } from './toolGroups';

export { equalOutputCount, equalOutputGroups };

// Functional scan order. Presentation order is owned separately by toolGroups.
export const analysisToolRegistry = [
  equalOutputTool,
  ciohTool,
  reuseTool,
  valueFlowTool,
  structureTool,
  scriptTool,
  walletTool,
] as const;

export const analysisToolGroups = toolGroupsInDisplayOrder.map((group) => ({
  id: group.id,
  label: group.label,
  tools: analysisToolRegistry
    .filter((tool) => tool.group.id === group.id)
    .sort((a, b) => a.displayOrder - b.displayOrder),
}));

export const analysisToolsInDisplayOrder = analysisToolGroups.flatMap((group) => group.tools);
