import { assertTagBudget } from './Annotations/annotations';
import { assertConnectionScanBudget } from './ConnectionScan/records';
import { assertGraphNodeBudget, assertHiddenNodeBudget } from './view';

import { assertWalletHistoryBudget, assertWalletReviewBudget } from './Wallets/wallets';

const MAX_GRAPH_RECORDS = 50_000;

export class WorkspaceValidationError extends Error {
  constructor(
    readonly code:
      | 'graph-limit'
      | 'wallet-address-limit'
      | 'transaction-limit'
      | 'input-context-limit'
      | 'wallet-identity'
      | 'wallet-address',
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceValidationError';
  }
}

/** Rejects structures that exceed the workspace's in-memory and persisted budgets. */
export function assertWorkspaceBudget(data: unknown, validateScanBytes = false) {
  if (!data || typeof data !== 'object') return;
  const document = data as {
    chainData?: {
      transactions?: unknown;
      contextTransactionIds?: unknown;
      addressHistories?: unknown;
      addressBalances?: unknown;
      addressUtxos?: unknown;
    };
    wallets?: { definitions?: unknown; reviews?: unknown };
    annotations?: { tags?: unknown };
    view?: { inputContext?: unknown };
  };
  // Budgets run before schema parsing, on the v5 groups, including invalid input.
  const raw = {
    ...document.chainData,
    wallets: document.wallets?.definitions,
    walletReviews: document.wallets?.reviews,
    tags: document.annotations?.tags,
    inputContext: document.view?.inputContext,
  };
  if (Array.isArray(raw.contextTransactionIds) && raw.contextTransactionIds.length > 10000)
    throw new WorkspaceValidationError(
      'input-context-limit',
      'Workspace exceeds the 10,000 context transaction limit.',
    );
  if (
    raw.inputContext &&
    typeof raw.inputContext === 'object' &&
    !Array.isArray(raw.inputContext)
  ) {
    const scopes = Object.values(raw.inputContext);
    if (scopes.length > 10000)
      throw new WorkspaceValidationError(
        'input-context-limit',
        'Workspace exceeds the 10,000 input-context transaction limit.',
      );
    let outputs = 0;
    for (const scope of scopes) {
      outputs += Array.isArray(scope) ? scope.length : 0;
      if (outputs > MAX_GRAPH_RECORDS)
        throw new WorkspaceValidationError(
          'input-context-limit',
          'Workspace exceeds the 50,000 input-context output limit.',
        );
    }
  }
  if (
    raw.addressHistories &&
    typeof raw.addressHistories === 'object' &&
    !Array.isArray(raw.addressHistories)
  ) {
    const histories = Object.values(raw.addressHistories);
    if (histories.length > 10000)
      throw new WorkspaceValidationError(
        'wallet-address-limit',
        'Workspace exceeds the 10,000 watched address history limit.',
      );
    let entries = 0;
    for (const history of histories) {
      if (!history || typeof history !== 'object') continue;
      entries += Array.isArray((history as { history?: unknown }).history)
        ? (history as { history: unknown[] }).history.length
        : 0;
      if (entries > MAX_GRAPH_RECORDS)
        throw new WorkspaceValidationError(
          'graph-limit',
          'Workspace exceeds the 50,000 address history entry limit.',
        );
    }
  }
  for (const [kind, observations] of [
    ['addressBalances', raw.addressBalances],
    ['addressUtxos', raw.addressUtxos],
  ] as const) {
    if (!observations || typeof observations !== 'object' || Array.isArray(observations)) continue;
    const records = Object.values(observations);
    if (records.length > 10000)
      throw new WorkspaceValidationError(
        'wallet-address-limit',
        `Workspace exceeds the 10,000 ${kind} limit.`,
      );
    if (kind !== 'addressUtxos') continue;
    let entries = 0;
    for (const observation of records) {
      if (!observation || typeof observation !== 'object') continue;
      entries += Array.isArray((observation as { utxos?: unknown }).utxos)
        ? (observation as { utxos: unknown[] }).utxos.length
        : 0;
      if (entries > MAX_GRAPH_RECORDS)
        throw new WorkspaceValidationError(
          'graph-limit',
          'Workspace exceeds the 50,000 address UTXO entry limit.',
        );
    }
  }
  assertConnectionScanBudget(
    (data as { connectionScans?: unknown }).connectionScans,
    validateScanBytes,
  );
  assertTagBudget(raw.tags);
  assertWalletHistoryBudget(raw.wallets);
  assertWalletReviewBudget(raw.walletReviews);
  const view = (data as { view?: unknown }).view;
  if (view && typeof view === 'object') {
    assertHiddenNodeBudget((view as { hiddenNodeIds?: unknown }).hiddenNodeIds);
    assertGraphNodeBudget((view as { graphNodeIds?: unknown }).graphNodeIds);
  }
  if (
    raw.transactions &&
    typeof raw.transactions === 'object' &&
    !Array.isArray(raw.transactions)
  ) {
    const transactions = Object.values(raw.transactions);
    if (transactions.length > 10000)
      throw new WorkspaceValidationError(
        'transaction-limit',
        'Workspace exceeds the 10,000 transaction limit.',
      );
    let records = transactions.length;
    for (const item of transactions) {
      if (!item || typeof item !== 'object') continue;
      const tx = item as { vin?: unknown; vout?: unknown };
      records +=
        (Array.isArray(tx.vin) ? tx.vin.length : 0) + (Array.isArray(tx.vout) ? tx.vout.length : 0);
      if (records > MAX_GRAPH_RECORDS)
        throw new WorkspaceValidationError(
          'graph-limit',
          'Workspace exceeds the 50,000 transaction/input/output record limit. Split this investigation into separate workspaces.',
        );
    }
  }
  if (Array.isArray(raw.wallets)) {
    if (raw.wallets.length > 100)
      throw new WorkspaceValidationError(
        'wallet-identity',
        'Workspace supports at most 100 wallets.',
      );
    let addresses = 0;
    for (const wallet of raw.wallets) {
      if (wallet && typeof wallet === 'object' && Array.isArray(wallet.addresses))
        addresses += wallet.addresses.length;
      if (addresses > MAX_GRAPH_RECORDS)
        throw new WorkspaceValidationError(
          'wallet-address-limit',
          'Workspace exceeds the 50,000 wallet address limit.',
        );
    }
  }
}
