import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { addressToScriptHash } from '../lib/wallet';
import { canonicalEntityNodeId } from './entityReferences';
import { verifiedWalletAddresses } from './walletRecords';
import {
  outputNodeId,
  sats,
  type Network,
  type Transaction,
  type TxOutput,
  type Wallet,
  type Workspace,
} from './types';

export interface WalletRelationshipContext {
  transactionId: string;
  /** Wallet-matched outputs received by, or spent in, this transaction. */
  walletOutputIds: string[];
}

export interface WalletRelationship {
  /** Canonical output subject, including unloaded prevout placeholders. */
  id: string;
  /** Creating transaction, not necessarily the relationship transaction. */
  txid: string;
  vout: number;
  address?: string;
  /** Whole observed output value, never an allocation to any wallet output. */
  amountSats?: number;
  /** External means no discovered wallet script match, not a known controller. */
  ownership: 'wallet' | 'external' | 'unknown';
  missing: boolean;
  transactionIds: string[];
  walletOutputIds: string[];
  contexts: WalletRelationshipContext[];
}

export interface WalletRelationshipCoverage {
  scannedAt?: string;
  scanComplete: boolean;
  knownTransactions: number;
  loadedTransactions: number;
  unloadedTransactions: number;
  receivingTransactions: number;
  spendingTransactions: number;
  /** Distinct unresolved outpoints across relevant loaded transactions. */
  missingPrevouts: number;
  /** Coinbase inputs have no previous output and are not missing prevouts. */
  coinbaseInputs: number;
  /** Non-coinbase inputs without a usable outpoint. */
  unidentifiedInputs: number;
  partial: boolean;
}

export interface WalletRelationships {
  sources: WalletRelationship[];
  destinations: WalletRelationship[];
  coverage: WalletRelationshipCoverage;
}

export interface WalletAddressRelationship {
  /** Canonical address annotation target, never a representative outpoint. */
  id: string;
  address: string;
  ownership: WalletRelationship['ownership'];
  outpointIds: string[];
  transactionIds: string[];
  walletOutputIds: string[];
  contexts: WalletRelationshipContext[];
  /** Distinct constituent outputs with their exact one-hop contexts. */
  outpoints: WalletRelationship[];
  /** Sum of distinct observed output values, not an allocation, balance or spendability claim.
   * Undefined if any constituent amount or the safe total is unavailable. */
  amountSats?: number;
  /** Number of distinct constituent outputs, not transactions or payments. */
  count: number;
}

export interface WalletAddressRelationships {
  sources: WalletAddressRelationship[];
  destinations: WalletAddressRelationship[];
  sourceExceptions: WalletRelationship[];
  destinationExceptions: WalletRelationship[];
  coverage: WalletRelationshipCoverage;
}

/** No match to the selected wallet, not proof of a separate controller.
 * Raw groups and exceptions remain available to evidence and loading consumers. */
export function walletCounterparties(groups: WalletAddressRelationships) {
  return {
    sources: groups.sources.filter((group) => group.ownership === 'external'),
    destinations: groups.destinations.filter((group) => group.ownership === 'external'),
  };
}

export function canonicalTransactionId(value: string | undefined): string | undefined {
  return value && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function validOutputIndex(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0 && value! <= 0xffffffff;
}

/** Raw script bytes win over address text. Non-address scripts and malformed
 * claims cannot establish an external address or identify a controller. */
export function walletOutputEvidence(
  output: TxOutput | undefined,
  network: Network,
): { address?: string; scripthash?: string } {
  if (!output) return {};
  try {
    const bitcoinNetwork = network === 'mainnet' ? networks.bitcoin : networks.testnet;
    if (output.scriptPubKey.hex !== undefined) {
      const script = hexToBytes(output.scriptPubKey.hex);
      const scripthash = bytesToHex(sha256(script).reverse());
      try {
        return { scripthash, address: bitcoinAddress.fromOutputScript(script, bitcoinNetwork) };
      } catch {
        return { scripthash };
      }
    }
    const reported =
      output.scriptPubKey.address ??
      (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined);
    if (!reported) return {};
    const scripthash = addressToScriptHash(reported, network);
    return {
      scripthash,
      address: bitcoinAddress.fromOutputScript(
        bitcoinAddress.toOutputScript(reported, bitcoinNetwork),
        bitcoinNetwork,
      ),
    };
  } catch {
    return {};
  }
}

/** Ignore inconsistent map keys rather than borrowing another transaction's outputs. */
export function loadedWalletTransactions(workspace: Workspace): Map<string, Transaction> {
  const transactions = new Map<string, Transaction>();
  for (const [key, transaction] of Object.entries(workspace.transactions)) {
    const txid = canonicalTransactionId(transaction.txid);
    if (txid && canonicalTransactionId(key) === txid) transactions.set(txid, transaction);
  }
  return transactions;
}

/** One-hop local relationships. Histories qualify coverage only; every direction
 * requires actual loaded wallet-script matches and exact outpoint references. */
export function listWalletRelationships(workspace: Workspace, wallet: Wallet): WalletRelationships {
  const transactions = loadedWalletTransactions(workspace);
  const addresses = verifiedWalletAddresses(wallet, workspace.network);
  const hashes = new Set(addresses.map((entry) => entry.scripthash));
  const outputs = new Map<string, WalletRelationship>();
  const owned = new Set<string>();
  const received = new Map<string, string[]>();
  const spent = new Map<string, string[]>();
  const known = new Set<string>();
  for (const address of addresses) {
    for (const entry of address.history ?? []) {
      const txid = canonicalTransactionId(entry.tx_hash);
      if (
        txid &&
        Number.isSafeInteger(entry.height) &&
        entry.height >= -1 &&
        entry.height <= 0x7fffffff
      )
        known.add(txid);
    }
  }
  for (const reference of wallet.pendingTransactionIds ?? []) {
    const txid = canonicalTransactionId(reference);
    if (txid && addresses.length) known.add(txid);
  }
  const subject = (txid: string, vout: number, output?: TxOutput): WalletRelationship => {
    const evidence = walletOutputEvidence(output, workspace.network);
    const amount = output ? sats(output.value) : undefined;
    return {
      id: outputNodeId(txid, vout),
      txid,
      vout,
      address: evidence.address,
      amountSats:
        amount !== undefined && Number.isSafeInteger(amount) && amount >= 0 ? amount : undefined,
      ownership:
        evidence.scripthash && hashes.has(evidence.scripthash)
          ? 'wallet'
          : evidence.address
            ? 'external'
            : 'unknown',
      missing: !output,
      transactionIds: [],
      walletOutputIds: [],
      contexts: [],
    };
  };
  for (const [txid, transaction] of transactions) {
    for (const output of transaction.vout) {
      if (!validOutputIndex(output.n)) continue;
      const entry = subject(txid, output.n, output);
      outputs.set(entry.id, entry);
      if (entry.ownership !== 'wallet') continue;
      owned.add(entry.id);
      const ids = received.get(txid) ?? [];
      ids.push(entry.id);
      received.set(txid, ids);
      known.add(txid);
    }
  }
  for (const [txid, transaction] of transactions) {
    const ids = new Set<string>();
    for (const input of transaction.vin) {
      const parent = canonicalTransactionId(input.txid);
      if (input.coinbase !== undefined || !parent || !validOutputIndex(input.vout)) continue;
      const id = outputNodeId(parent, input.vout);
      if (owned.has(id)) ids.add(id);
    }
    if (ids.size) {
      spent.set(txid, [...ids].sort());
      known.add(txid);
    }
  }
  const sources = new Map<string, WalletRelationship>();
  const destinations = new Map<string, WalletRelationship>();
  const add = (
    list: Map<string, WalletRelationship>,
    entry: WalletRelationship,
    transactionId: string,
    walletOutputIds: string[],
  ) => {
    const previous = list.get(entry.id);
    const relationship = previous ?? { ...entry, contexts: [] };
    if (!relationship.contexts.some((context) => context.transactionId === transactionId))
      relationship.contexts.push({
        transactionId,
        walletOutputIds: [...new Set(walletOutputIds)].sort(),
      });
    list.set(entry.id, relationship);
  };
  for (const [txid, walletOutputIds] of received) {
    for (const input of transactions.get(txid)!.vin) {
      const parent = canonicalTransactionId(input.txid);
      if (input.coinbase !== undefined || !parent || !validOutputIndex(input.vout)) continue;
      const id = outputNodeId(parent, input.vout);
      add(sources, outputs.get(id) ?? subject(parent, input.vout), txid, walletOutputIds);
    }
  }
  for (const [txid, walletOutputIds] of spent) {
    for (const output of transactions.get(txid)!.vout) {
      if (!validOutputIndex(output.n)) continue;
      add(destinations, outputs.get(outputNodeId(txid, output.n))!, txid, walletOutputIds);
    }
  }
  const finish = (list: Map<string, WalletRelationship>) =>
    [...list.values()]
      .map((entry) => {
        const contexts = entry.contexts.sort((a, b) =>
          a.transactionId.localeCompare(b.transactionId),
        );
        return {
          ...entry,
          contexts,
          transactionIds: contexts.map((context) => context.transactionId),
          walletOutputIds: [
            ...new Set(contexts.flatMap((context) => context.walletOutputIds)),
          ].sort(),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  const missing = new Set<string>();
  let coinbaseInputs = 0;
  let unidentifiedInputs = 0;
  let loadedTransactions = 0;
  for (const txid of known) {
    const transaction = transactions.get(txid);
    if (!transaction) continue;
    loadedTransactions++;
    for (const input of transaction.vin) {
      if (input.coinbase !== undefined) {
        coinbaseInputs++;
        continue;
      }
      const parent = canonicalTransactionId(input.txid);
      if (!parent || !validOutputIndex(input.vout)) unidentifiedInputs++;
      else {
        const id = outputNodeId(parent, input.vout);
        if (!outputs.has(id)) missing.add(id);
      }
    }
  }
  const unloadedTransactions = known.size - loadedTransactions;
  return {
    sources: finish(sources),
    destinations: finish(destinations),
    coverage: {
      scannedAt: wallet.scannedAt,
      scanComplete: wallet.scanComplete === true,
      knownTransactions: known.size,
      loadedTransactions,
      unloadedTransactions,
      receivingTransactions: received.size,
      spendingTransactions: spent.size,
      missingPrevouts: missing.size,
      coinbaseInputs,
      unidentifiedInputs,
      partial:
        wallet.scanComplete !== true ||
        unloadedTransactions > 0 ||
        missing.size > 0 ||
        unidentifiedInputs > 0,
    },
  };
}

/** Address-level review/edit subjects over the same bounded one-hop observations.
 * No address is synthesized for an unknown or non-address output. */
export function groupWalletRelationships(
  workspace: Workspace,
  wallet: Wallet,
): WalletAddressRelationships {
  const relationships = listWalletRelationships(workspace, wallet);
  const group = (entries: WalletRelationship[]) => {
    const grouped = new Map<
      string,
      { address: string; outputs: Map<string, WalletRelationship> }
    >();
    const exceptions: WalletRelationship[] = [];
    for (const entry of entries) {
      if (!entry.address) {
        exceptions.push(entry);
        continue;
      }
      let id: string;
      try {
        id = canonicalEntityNodeId(`addr:${entry.address}`, workspace.network);
      } catch {
        exceptions.push(entry);
        continue;
      }
      const subject = grouped.get(id) ?? { address: id.slice(5), outputs: new Map() };
      subject.outputs.set(entry.id, entry);
      grouped.set(id, subject);
    }
    const groups: WalletAddressRelationship[] = [...grouped.entries()].map(([id, subject]) => {
      const outpoints = [...subject.outputs.values()].sort((a, b) => a.id.localeCompare(b.id));
      const contexts = new Map<string, Set<string>>();
      for (const output of outpoints)
        for (const context of output.contexts) {
          const ids = contexts.get(context.transactionId) ?? new Set<string>();
          for (const outputId of context.walletOutputIds) ids.add(outputId);
          contexts.set(context.transactionId, ids);
        }
      const mergedContexts = [...contexts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([transactionId, ids]) => ({ transactionId, walletOutputIds: [...ids].sort() }));
      const ownership = outpoints.every((output) => output.ownership === outpoints[0].ownership)
        ? outpoints[0].ownership
        : 'unknown';
      const total = outpoints.reduce((sum, output) => sum + (output.amountSats ?? NaN), 0);
      return {
        id,
        address: subject.address,
        ownership,
        outpointIds: outpoints.map((output) => output.id),
        transactionIds: mergedContexts.map((context) => context.transactionId),
        walletOutputIds: [
          ...new Set(mergedContexts.flatMap((context) => context.walletOutputIds)),
        ].sort(),
        contexts: mergedContexts,
        outpoints,
        amountSats: Number.isSafeInteger(total) && total >= 0 ? total : undefined,
        count: outpoints.length,
      };
    });
    return { groups: groups.sort((a, b) => a.id.localeCompare(b.id)), exceptions };
  };
  const sources = group(relationships.sources);
  const destinations = group(relationships.destinations);
  return {
    sources: sources.groups,
    destinations: destinations.groups,
    sourceExceptions: sources.exceptions,
    destinationExceptions: destinations.exceptions,
    coverage: relationships.coverage,
  };
}

/** Loaded creating and spending contexts verified against this address's script.
 * History membership and display metadata alone never add a context. */
export function listLoadedAddressTransactionIds(workspace: Workspace, address: string): string[] {
  let scripthash: string;
  try {
    scripthash = addressToScriptHash(address, workspace.network);
  } catch {
    return [];
  }
  const transactions = loadedWalletTransactions(workspace);
  const outputs = new Set<string>();
  const contexts = new Set<string>();
  for (const [txid, transaction] of transactions) {
    for (const output of transaction.vout) {
      if (
        validOutputIndex(output.n) &&
        walletOutputEvidence(output, workspace.network).scripthash === scripthash
      ) {
        outputs.add(outputNodeId(txid, output.n));
        contexts.add(txid);
      }
    }
  }
  for (const [txid, transaction] of transactions) {
    if (
      transaction.vin.some((input) => {
        const parent = canonicalTransactionId(input.txid);
        return (
          input.coinbase === undefined &&
          parent &&
          validOutputIndex(input.vout) &&
          outputs.has(outputNodeId(parent, input.vout))
        );
      })
    )
      contexts.add(txid);
  }
  return [...contexts].sort();
}
