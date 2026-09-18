import { describe, expect, it } from 'vitest';
import { analysisTools } from './analysis';
import {
  analysisToolGroups,
  analysisToolRegistry,
  analysisToolsInDisplayOrder,
} from './toolRegistry';

describe('analysis tool registry', () => {
  it('keeps the stable tool IDs in functional scan order', () => {
    expect(analysisToolRegistry.map((tool) => tool.id)).toEqual([
      'equal-outputs',
      'cioh',
      'address-reuse',
      'value-flow',
      'transaction-shapes',
      'script-types',
      'wallet-intersections',
    ]);
    expect(analysisTools).toBe(analysisToolRegistry);
    expect(new Set(analysisToolRegistry.map((tool) => tool.id)).size).toBe(
      analysisToolRegistry.length,
    );
  });

  it('places every registered tool in one ordered presentation group', () => {
    expect(
      analysisToolGroups.map((group) => ({
        id: group.id,
        label: group.label,
        tools: group.tools.map((tool) => tool.id),
      })),
    ).toEqual([
      {
        id: 'privacy-patterns',
        label: 'Privacy patterns',
        tools: ['equal-outputs', 'cioh', 'address-reuse'],
      },
      {
        id: 'value-and-structure',
        label: 'Value and structure',
        tools: ['value-flow', 'transaction-shapes', 'script-types'],
      },
      {
        id: 'imported-wallets',
        label: 'Imported wallets',
        tools: ['wallet-intersections'],
      },
    ]);

    const groupedIds = analysisToolsInDisplayOrder.map((tool) => tool.id);
    expect(groupedIds).toHaveLength(new Set(groupedIds).size);
    expect(new Set(groupedIds)).toEqual(new Set(analysisToolRegistry.map((tool) => tool.id)));
  });
});
