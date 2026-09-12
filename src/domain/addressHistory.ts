import { addressToScriptHash } from '../lib/wallet';
import { canonicalAddress } from './entityReferences';
import { indexPreviousOutputs, resolvePreviousOutput } from './prevouts';
import { createWalletOutputEvidenceResolver } from './walletOutputEvidence';
import {
  sats,
  type AddressBalanceObservation,
  type AddressHistoryObservation,
  type GraphNode,
  type Transaction,
  type Workspace,
} from './types';
import { verifiedWalletAddresses } from './walletRecords';

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
  workspace: Workspace,
  address: string,
): {
  observation?: AddressHistoryObservation;
  source: AddressHistory['source'];
  complete: boolean;
  checkedAt?: string;
} {
  const direct = workspace.addressHistories?.[address];
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
  for (const wallet of workspace.wallets) {
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
    checkedAt: workspace.wallets
      .map((wallet) => wallet.scannedAt)
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1),
  };
}

function transactionMatchesAddress(
  workspace: Workspace,
  transaction: Transaction,
  scripthash: string,
  evidence: ReturnType<typeof createWalletOutputEvidenceResolver>,
  previousOutputs: ReturnType<typeof indexPreviousOutputs>,
) {
  let receivedSats: number | undefined;
  let spentSats: number | undefined;
  for (const output of transaction.vout) {
    if (evidence(output).scripthash !== scripthash) continue;
    receivedSats = addAmount(receivedSats, sats(output.value));
  }
  for (const input of transaction.vin) {
    if (input.coinbase === undefined && input.txid !== undefined && input.vout !== undefined) {
      const previous = resolvePreviousOutput(workspace, input, previousOutputs);
      if (
        (previous.status === 'loaded' || previous.status === 'attached') &&
        evidence(previous.output).scripthash === scripthash
      )
        spentSats = addAmount(spentSats, sats(previous.output.value));
    }
  }
  return { receivedSats, spentSats };
}

function historyHeight(
  transaction: Transaction | undefined,
  heights: Set<number> | undefined,
): number | undefined {
  if (transaction?.blockHeight !== undefined) return transaction.blockHeight;
  const confirmed = [...(heights ?? [])].filter((height) => height > 0);
  return confirmed.length === 1 ? confirmed[0] : undefined;
}

/**
 * Projects observed address history into a navigable list. History membership
 * is observation only; loaded script matches add direction and amounts, never
 * an ownership or balance conclusion.
 */
export function listAddressHistory(
  workspace: Workspace,
  address: string,
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
  const matches = new Map<string, { receivedSats?: number; spentSats?: number }>();
  const evidence = createWalletOutputEvidenceResolver(workspace.network);
  const previousOutputs = indexPreviousOutputs(workspace);
  for (const transaction of Object.values(workspace.transactions)) {
    const match = transactionMatchesAddress(
      workspace,
      transaction,
      scripthash,
      evidence,
      previousOutputs,
    );
    if (match.receivedSats !== undefined || match.spentSats !== undefined)
      matches.set(transaction.txid.toLowerCase(), match);
  }
  for (const txid of matches.keys()) if (!heights.has(txid)) heights.set(txid, new Set());

  const hidden = new Set(workspace.view.hiddenNodeIds ?? []);
  const onGraph = new Set(workspace.view.graphNodeIds ?? []);
  const entries = [...heights.entries()]
    .map(([txid, txHeights]): AddressHistoryEntry => {
      const transaction = workspace.transactions[txid];
      const match = matches.get(txid);
      const received = match?.receivedSats !== undefined;
      const spent = match?.spentSats !== undefined;
      return {
        txid,
        height: historyHeight(transaction, txHeights),
        mempool:
          transaction?.mempool === true ||
          (transaction?.blockHeight === undefined && [...txHeights].some((height) => height <= 0)),
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
