import type { WorkspaceDocument } from '../../src/Core/Workspace/workspace';
import type { Transaction } from '../../src/Core/ChainData';

function legacyTransactions(records: Record<string, Transaction>) {
  return Object.fromEntries(
    Object.entries(records).map(([id, { status, ...tx }]) => {
      if (!status) return [id, tx];
      const { kind, ...placement } = status;
      return [id, { ...tx, ...placement, ...(kind === 'mempool' ? { mempool: true } : {}) }];
    }),
  );
}

/** Public synthetic legacy payloads. Never use this shape in application code. */
export function legacyWorkspace(document: WorkspaceDocument, version?: 1 | 2 | 3 | 4) {
  const { version: _version, chainData, wallets, annotations, analysis, ...rest } = document;
  const { inputContext, ...view } = rest.view;
  return {
    ...rest,
    view,
    ...(inputContext && { inputContext }),
    ...chainData,
    transactions: legacyTransactions(chainData.transactions),
    ...(rest.connectionScans && {
      connectionScans: {
        ...rest.connectionScans,
        evidence: legacyTransactions(rest.connectionScans.evidence),
      },
    }),
    wallets: wallets.definitions,
    walletReviews: wallets.reviews,
    annotations: annotations.entities,
    tags: annotations.tags,
    findings: analysis.findings,
    ...(version === undefined ? {} : { version }),
  };
}
