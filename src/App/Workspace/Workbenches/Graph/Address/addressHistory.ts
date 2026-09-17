import { addressToScriptHash, sats } from '../../../../../Core/Bitcoin';
import { canonicalAddress } from '../../../../../Core/Workspace/entityReferences';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type Transaction,
  type AddressBalanceObservation,
  type AddressHistoryObservation,
  type AddressUtxoObservation,
} from '../../../../../Core/ChainData';
import { createWalletOutputEvidenceResolver } from '../../../../../Core/Workspace/Wallets/walletOutputEvidence';

import type { GraphNode } from '../../../GraphState/types';

import { verifiedWalletAddresses } from '../../../../../Core/Workspace/Wallets/walletRecords';

export type AddressHistoryDirection = 'received' | 'spent' | 'activity' | 'unknown';

export interface AddressHistoryEntry {
  txid: string;
  height?: number;
  mempool: boolean;
  transaction?: Transaction;
  direction: AddressHistoryDirection;
  receivedSats?: number;
  spentSats?: number;
  onGraph: boolean;
  hidden: boolean;
}

export interface AddressHistory {
  address: string;
  entries: AddressHistoryEntry[];
  knownCount: number;
  loadedCount: number;
  unloadedCount: number;
  /** False means the list is loaded-only or the upstream/detail bound was reached. */
  complete: boolean;
  checkedAt?: string;
  source: 'address history' | 'wallet history' | 'loaded transactions';
}

/** A selected address needs a network check when no direct history is known yet. */
export function shouldLoadAddressHistory(history: AddressHistory | undefined): boolean {
  return !history || history.knownCount === 0 || history.source === 'loaded transactions';
}

export const RECENT_ADDRESS_GRAPH_LIMIT = 10;

/** History projections are already ordered newest-first, including pending entries. */
export function recentAddressHistoryEntries(
  history: AddressHistory | undefined,
  limit = RECENT_ADDRESS_GRAPH_LIMIT,
): AddressHistoryEntry[] {
  return history?.entries.slice(0, Math.max(0, limit)) ?? [];
}

/** Electrum does not promise list order, so order UTXOs by height explicitly. */
export function recentAddressUtxos(
  observation: AddressUtxoObservation | undefined,
  limit = RECENT_ADDRESS_GRAPH_LIMIT,
): AddressUtxoObservation['utxos'] {
  return [...(observation?.utxos ?? [])]
    .sort(
      (a, b) =>
        (b.height === 0 ? Number.MAX_SAFE_INTEGER : b.height) -
          (a.height === 0 ? Number.MAX_SAFE_INTEGER : a.height) ||
        b.txid.localeCompare(a.txid) ||
        b.vout - a.vout,
    )
    .slice(0, Math.max(0, limit));
}

interface AddressHistoryTransactionMatch {
  receivedSats?: number;
  spentSats?: number;
}

export interface AddressHistoryTransactionIndex {
  network: Workspace['network'];
  matchesByScripthash: ReadonlyMap<string, ReadonlyMap<string, AddressHistoryTransactionMatch>>;
}

export type AddressHistoryWorkspace = Pick<Workspace, 'network'> & {
  chainData: Pick<Workspace['chainData'], 'transactions' | 'addressHistories'>;
  wallets: Pick<Workspace['wallets'], 'definitions'>;
} & {
  view: Pick<Workspace['view'], 'graphNodeIds' | 'hiddenNodeIds'>;
};

// Workspace updates are immutable. Reusing the index for an unchanged transaction
// snapshot keeps history projections focused on the selected address and its
// observation metadata instead of rebuilding previous-output evidence each render.
const transactionIndexCache = new WeakMap<object, AddressHistoryTransactionIndex>();

export function addressBalanceSats(
  observation: AddressBalanceObservation | undefined,
): number | undefined {
  if (!observation) return undefined;
  const total = observation.confirmedSats + observation.unconfirmedSats;
  return Number.isSafeInteger(total) && total >= 0 ? total : undefined;
}

function addAmount(previous: number | undefined, value: number | undefined): number | undefined {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) return undefined;
  if (previous === undefined) return value;
  const total = previous + value;
  return Number.isSafeInteger(total) && total >= 0 ? total : undefined;
}

function historyObservation(
  workspace: AddressHistoryWorkspace,
  address: string,
): {
  observation?: AddressHistoryObservation;
  source: AddressHistory['source'];
  complete: boolean;
  checkedAt?: string;
} {
  const direct = workspace.chainData.addressHistories?.[address];
  if (direct)
    return {
      observation: direct,
      source: 'address history',
      complete: !direct.truncated,
      checkedAt: direct.scannedAt,
    };

  let matched = false;
  let complete = true;
  const entries: { tx_hash: string; height: number }[] = [];
  const target = addressToScriptHash(address, workspace.network);
  for (const wallet of workspace.wallets.definitions) {
    for (const item of verifiedWalletAddresses(wallet, workspace.network)) {
      if (addressToScriptHash(item.address, workspace.network) !== target) continue;
      matched = true;
      complete = complete && wallet.scanComplete === true;
      entries.push(...(item.history ?? []));
    }
  }
  if (!matched) return { source: 'loaded transactions', complete: false };
  return {
    observation: { history: entries, truncated: !complete },
    source: 'wallet history',
    complete,
    checkedAt: workspace.wallets.definitions
      .map((wallet) => wallet.scannedAt)
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1),
  };
}

export function buildAddressHistoryTransactionIndex(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  },
): AddressHistoryTransactionIndex {
  const matchesByScripthash = new Map<string, Map<string, AddressHistoryTransactionMatch>>();
  const evidence = createWalletOutputEvidenceResolver(workspace.network);
  const previousOutputs = indexPreviousOutputs({
    network: workspace.network,
    transactions: workspace.chainData.transactions,
  });
  const addMatch = (
    scripthash: string,
    txid: string,
    side: 'receivedSats' | 'spentSats',
    value: number | undefined,
  ) => {
    const byTransaction = matchesByScripthash.get(scripthash) ?? new Map();
    const match = byTransaction.get(txid) ?? {};
    match[side] = addAmount(match[side], value);
    if (match.receivedSats !== undefined || match.spentSats !== undefined)
      byTransaction.set(txid, match);
    else byTransaction.delete(txid);
    if (byTransaction.size) matchesByScripthash.set(scripthash, byTransaction);
    else matchesByScripthash.delete(scripthash);
  };

  for (const transaction of Object.values(workspace.chainData.transactions)) {
    const txid = transaction.txid.toLowerCase();
    for (const output of transaction.vout) {
      const scripthash = evidence(output).scripthash;
      if (scripthash) addMatch(scripthash, txid, 'receivedSats', sats(output.value));
    }
    for (const input of transaction.vin) {
      if (input.coinbase !== undefined || input.txid === undefined || input.vout === undefined)
        continue;
      const previous = resolvePreviousOutput(
        { network: workspace.network, transactions: workspace.chainData.transactions },
        input,
        previousOutputs,
      );
      if (previous.status !== 'loaded' && previous.status !== 'attached') continue;
      const scripthash = evidence(previous.output).scripthash;
      if (scripthash) addMatch(scripthash, txid, 'spentSats', sats(previous.output.value));
    }
  }

  const index = { network: workspace.network, matchesByScripthash };
  return index;
}

export function indexAddressHistoryTransactions(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  },
): AddressHistoryTransactionIndex {
  const cached = transactionIndexCache.get(workspace.chainData.transactions);
  if (cached?.network === workspace.network) return cached;
  const index = buildAddressHistoryTransactionIndex(workspace);
  transactionIndexCache.set(workspace.chainData.transactions, index);
  return index;
}

function historyHeight(
  transaction: Transaction | undefined,
  heights: Set<number> | undefined,
): number | undefined {
  if (transaction?.status?.blockHeight !== undefined) return transaction.status?.blockHeight;
  const confirmed = [...(heights ?? [])].filter((height) => height > 0);
  return confirmed.length === 1 ? confirmed[0] : undefined;
}

/**
 * Projects observed address history into a navigable list. History membership
 * is observation only; loaded script matches add direction and amounts, never
 * an ownership or balance conclusion.
 */
export function projectAddressHistory(
  workspace: AddressHistoryWorkspace,
  address: string,
  index: AddressHistoryTransactionIndex,
): AddressHistory | undefined {
  let scripthash: string;
  let canonical: string;
  try {
    scripthash = addressToScriptHash(address, workspace.network);
    canonical = canonicalAddress(address);
  } catch {
    return undefined;
  }
  const observed = historyObservation(workspace, canonical);
  const heights = new Map<string, Set<number>>();
  for (const entry of observed.observation?.history ?? []) {
    const txid = entry.tx_hash.toLowerCase();
    const values = heights.get(txid) ?? new Set<number>();
    values.add(entry.height);
    heights.set(txid, values);
  }
  const matches =
    index.network === workspace.network
      ? (index.matchesByScripthash.get(scripthash) ?? new Map())
      : new Map<string, AddressHistoryTransactionMatch>();
  for (const txid of matches.keys()) if (!heights.has(txid)) heights.set(txid, new Set());

  const hidden = new Set(workspace.view.hiddenNodeIds ?? []);
  const onGraph = new Set(workspace.view.graphNodeIds ?? []);
  const entries = [...heights.entries()]
    .map(([txid, txHeights]): AddressHistoryEntry => {
      const transaction = workspace.chainData.transactions[txid];
      const match = matches.get(txid);
      const received = match?.receivedSats !== undefined;
      const spent = match?.spentSats !== undefined;
      return {
        txid,
        height: historyHeight(transaction, txHeights),
        mempool:
          (transaction?.status?.kind === 'mempool') === true ||
          (transaction?.status?.blockHeight === undefined &&
            [...txHeights].some((height) => height <= 0)),
        transaction,
        direction:
          received && spent ? 'activity' : received ? 'received' : spent ? 'spent' : 'unknown',
        receivedSats: match?.receivedSats,
        spentSats: match?.spentSats,
        onGraph: onGraph.has(`tx:${txid}`),
        hidden: hidden.has(`tx:${txid}`),
      };
    })
    .sort(
      (a, b) =>
        Number(b.mempool) - Number(a.mempool) ||
        (b.height ?? -1) - (a.height ?? -1) ||
        a.txid.localeCompare(b.txid),
    );
  return {
    address: canonical,
    entries,
    knownCount: entries.length,
    loadedCount: entries.filter((entry) => !!entry.transaction).length,
    unloadedCount: entries.filter((entry) => !entry.transaction).length,
    complete: observed.complete,
    checkedAt: observed.checkedAt,
    source: observed.source,
  };
}

export function listAddressHistory(
  workspace: AddressHistoryWorkspace,
  address: string,
): AddressHistory | undefined {
  return projectAddressHistory(workspace, address, indexAddressHistoryTransactions(workspace));
}

/** The address carried by a selected output is safe to use only after network validation. */
export function selectedAddress(selected: GraphNode | undefined, network: Workspace['network']) {
  if (!selected || selected.kind === 'transaction' || !selected.address) return undefined;
  try {
    addressToScriptHash(selected.address, network);
    return canonicalAddress(selected.address);
  } catch {
    return undefined;
  }
}
