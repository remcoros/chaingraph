export const toolGroups = {
  privacyPatterns: {
    id: 'privacy-patterns',
    label: 'Privacy patterns',
    order: 10,
  },
  valueAndStructure: {
    id: 'value-and-structure',
    label: 'Value and structure',
    order: 20,
  },
  importedWallets: {
    id: 'imported-wallets',
    label: 'Imported wallets',
    order: 30,
  },
} as const;

export type AnalysisToolGroup = (typeof toolGroups)[keyof typeof toolGroups];

export const toolGroupsInDisplayOrder: readonly AnalysisToolGroup[] = Object.values(
  toolGroups,
).sort((a, b) => a.order - b.order);
