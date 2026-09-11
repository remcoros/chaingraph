import {
  createWalletOutputEvidenceResolver,
  type WalletOutputEvidenceResolver,
} from './walletOutputEvidence';
import { indexPreviousOutputs, type PreviousOutputIndex } from './prevouts';
import { verifiedWalletAddresses } from './walletRecords';
import {
  canonicalTransactionId,
  loadedWalletTransactions,
  validOutputIndex,
} from './walletRelationships';
import { outputNodeId, type Network, type Transaction, type Wallet, type Workspace } from './types';

/** Session-owned projection of one immutable chain snapshot. Never persisted. */
export interface WalletSelectionIndex {
  transactions: ReadonlyMap<string, Transaction>;
  prevouts: PreviousOutputIndex;
  scriptTransactionIds: ReadonlyMap<string, readonly string[]>;
  addressOutputIds: ReadonlyMap<string, readonly string[]>;
  spendingTransactionIds: ReadonlyMap<string, readonly string[]>;
}

export interface WalletSelectionAddresses {
  addresses: ReadonlySet<string>;
  scripthashes: ReadonlySet<string>;
}

/** Rebuild when the wallet address array or network changes. */
export function buildWalletSelectionAddresses(
  wallet: Wallet,
  network: Network,
): WalletSelectionAddresses {
  const verified = verifiedWalletAddresses(wallet, network);
  return {
    addresses: new Set(verified.map((entry) => entry.address)),
    scripthashes: new Set(verified.map((entry) => entry.scripthash)),
  };
}

/** Rebuild when transactions or network changes, independently of row selection. */
export function buildWalletSelectionIndex(
  workspace: Workspace,
  inspect: WalletOutputEvidenceResolver = createWalletOutputEvidenceResolver(workspace.network),
): WalletSelectionIndex {
  const transactions = loadedWalletTransactions(workspace);
  const prevouts = indexPreviousOutputs(workspace);
  const contexts = new Map<string, Set<string>>();
  const addressOutputs = new Map<string, string[]>();
  const spenders = new Map<string, Set<string>>();
  const addContext = (hash: string | undefined, txid: string) => {
    if (!hash) return;
    const ids = contexts.get(hash) ?? new Set<string>();
    ids.add(txid);
    contexts.set(hash, ids);
  };
  for (const [txid, transaction] of transactions) {
    for (const output of transaction.vout) {
      if (!validOutputIndex(output.n)) continue;
      addContext(inspect(output).scripthash, txid);
    }
    for (const input of transaction.vin) {
      const parent = canonicalTransactionId(input.txid);
      if (input.coinbase !== undefined || !parent || !validOutputIndex(input.vout)) continue;
      const resolved = prevouts.get(outputNodeId(parent, input.vout));
      if (resolved?.status === 'loaded' || resolved?.status === 'attached')
        addContext(inspect(resolved.output).scripthash, txid);
    }
  }
  // Related-record references preserve the supplied snapshot's exact IDs and order.
  // Wallet association above independently requires canonical map keys and resolved facts.
  for (const [key, transaction] of Object.entries(workspace.transactions)) {
    for (const output of transaction.vout) {
      const address = inspect(output).address;
      if (!address) continue;
      const ids = addressOutputs.get(address) ?? [];
      ids.push(outputNodeId(key, output.n));
      addressOutputs.set(address, ids);
    }
    for (const input of transaction.vin) {
      if (input.txid === undefined || input.vout === undefined) continue;
      const id = outputNodeId(input.txid, input.vout);
      const ids = spenders.get(id) ?? new Set<string>();
      ids.add(transaction.txid);
      spenders.set(id, ids);
    }
  }
  return {
    transactions,
    prevouts,
    scriptTransactionIds: new Map([...contexts].map(([hash, ids]) => [hash, [...ids].sort()])),
    addressOutputIds: addressOutputs,
    spendingTransactionIds: new Map([...spenders].map(([id, ids]) => [id, [...ids]])),
  };
}
