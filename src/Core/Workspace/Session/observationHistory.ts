import { mergeTransactionObservations } from '../../ChainData';
import { invalidateFindings } from '../Analysis/findingStaleness';
import type { WorkspaceDocument } from '../workspace';

function carryMap<T>(
  snapshot: Record<string, T> | undefined,
  before: Record<string, T> | undefined,
  after: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (before === after) return snapshot;
  let result = snapshot;
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (before?.[key] === after?.[key]) continue;
    if (result === snapshot) result = { ...snapshot };
    if (after?.[key] !== undefined) result![key] = after[key];
    else delete result![key];
  }
  return result;
}

/** Apply only the observation delta, preserving each history entry's user-owned membership. */
export function carryAcceptedObservations(
  snapshot: WorkspaceDocument,
  before: WorkspaceDocument,
  after: WorkspaceDocument,
): WorkspaceDocument {
  if (
    before.chainData.transactions === after.chainData.transactions &&
    before.chainData.addressHistories === after.chainData.addressHistories &&
    before.chainData.addressBalances === after.chainData.addressBalances &&
    before.chainData.addressUtxos === after.chainData.addressUtxos &&
    before.wallets.definitions === after.wallets.definitions
  )
    return snapshot;
  let transactions = snapshot.chainData.transactions;
  for (const id of new Set([
    ...Object.keys(before.chainData.transactions),
    ...Object.keys(after.chainData.transactions),
  ])) {
    const previous = before.chainData.transactions[id],
      next = after.chainData.transactions[id];
    if (previous === next) continue;
    // If Undo removes a user-added transaction, a refresh must not resurrect it.
    if (!transactions[id] && previous) continue;
    if (transactions === snapshot.chainData.transactions) transactions = { ...transactions };
    if (next)
      transactions[id] = mergeTransactionObservations(transactions[id], next, after.network);
    else delete transactions[id];
  }
  const chainData = {
    ...snapshot.chainData,
    transactions,
    addressHistories: carryMap(
      snapshot.chainData.addressHistories,
      before.chainData.addressHistories,
      after.chainData.addressHistories,
    ),
    addressBalances: carryMap(
      snapshot.chainData.addressBalances,
      before.chainData.addressBalances,
      after.chainData.addressBalances,
    ),
    addressUtxos: carryMap(
      snapshot.chainData.addressUtxos,
      before.chainData.addressUtxos,
      after.chainData.addressUtxos,
    ),
  };
  const latest = new Map(after.wallets.definitions.map((wallet) => [wallet.id, wallet]));
  const previous = new Map(before.wallets.definitions.map((wallet) => [wallet.id, wallet]));
  let changedWallet = false;
  const updatedDefinitions = snapshot.wallets.definitions.map((wallet) => {
    const next = latest.get(wallet.id),
      old = previous.get(wallet.id);
    if (
      !next ||
      next.key !== wallet.key ||
      next.scriptType !== wallet.scriptType ||
      next.addresses === old?.addresses
    )
      return wallet;
    changedWallet = true;
    return { ...wallet, addresses: next.addresses };
  });
  const definitions = changedWallet ? updatedDefinitions : snapshot.wallets.definitions;
  return invalidateFindings(snapshot, {
    ...snapshot,
    chainData,
    wallets: { ...snapshot.wallets, definitions },
  });
}
