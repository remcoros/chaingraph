import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { addressToScriptHash } from '../lib/wallet';
import { canonicalEntityNodeId } from './entityReferences';
import { verifiedWalletAddresses } from './walletRecords';
import type { WalletReviewItem } from './walletReview';
import {
  outputNodeId,
  sats,
  txNodeId,
  type Transaction,
  type TxOutput,
  type Wallet,
  type Workspace,
} from './types';

export interface WalletReviewFlowEntry {
  /** Canonical entity reference; a coinbase entry refers to its transaction. */
  id: string;
  txid?: string;
  vout?: number;
  address?: string;
  valueSats?: number;
  /** External means no match to this wallet's verified discovered scripts.
   * It does not identify a controller or exclude an undiscovered wallet address. */
  ownership: 'wallet' | 'external' | 'unknown';
  selected: boolean;
  missing: boolean;
  coinbase?: boolean;
}

export interface WalletReviewContext {
  /** Raw transaction ID, suitable for looking up loaded observations. */
  transactionId?: string;
  transactionNodeId?: string;
  transaction?: Transaction;
  status: 'loaded' | 'missing' | 'unavailable';
  /** Full arrays. A presentation limit must never change factual row counts. */
  inputs: WalletReviewFlowEntry[];
  outputs: WalletReviewFlowEntry[];
  /** Explicit source-review targets, verified as direct spends into wallet outputs.
   * This snapshot does not independently establish their present unspent status. */
  currentOutputs: WalletReviewFlowEntry[];
  selected?: WalletReviewFlowEntry;
  role: 'wallet-output' | 'possible-counterparty' | 'wallet-related-transaction' | 'unknown-output';
  missingPrevouts: number;
}

function outpoint(id: string): { txid: string; vout: number } | undefined {
  const match = /^out:([0-9a-f]{64}):(\d+)$/.exec(id);
  return match ? { txid: match[1], vout: Number(match[2]) } : undefined;
}

function canonicalId(id: string, workspace: Workspace): string | undefined {
  try {
    return canonicalEntityNodeId(id, workspace.network);
  } catch {
    return undefined;
  }
}

/** A local projection of one creating transaction. No history-based ownership,
 * graph widening, automatic downloads or inferred input-to-output value mapping.
 * Wallet address derivation was verified at the workspace import/scan boundary. */
export function buildWalletReviewContext(
  workspace: Workspace,
  wallet: Wallet,
  item: WalletReviewItem,
): WalletReviewContext {
  const selectedId = canonicalId(item.nodeId, workspace);
  const selectedPoint = selectedId ? outpoint(selectedId) : undefined;
  const transactionId =
    selectedPoint?.txid ??
    (selectedId?.startsWith('tx:') ? selectedId.slice(3) : undefined) ??
    (/^[0-9a-f]{64}$/i.test(item.txid ?? '') ? item.txid!.toLowerCase() : undefined);
  const candidate = transactionId ? workspace.transactions[transactionId] : undefined;
  const transaction = candidate?.txid === transactionId ? candidate : undefined;
  const hashes = new Set(
    verifiedWalletAddresses(wallet, workspace.network).map((entry) => entry.scripthash),
  );
  const network = workspace.network === 'mainnet' ? networks.bitcoin : networks.testnet;

  const entry = (txid: string, vout: number, output?: TxOutput): WalletReviewFlowEntry => {
    const id = outputNodeId(txid, vout);
    let hash: string | undefined;
    let address: string | undefined;
    if (output) {
      try {
        if (output.scriptPubKey.hex !== undefined) {
          const script = hexToBytes(output.scriptPubKey.hex);
          hash = bytesToHex(sha256(script).reverse());
          // Never display an imported address claim that disagrees with the script.
          try {
            address = bitcoinAddress.fromOutputScript(script, network);
          } catch {
            /* Non-address script. */
          }
        } else {
          const reported =
            output.scriptPubKey.address ??
            (output.scriptPubKey.addresses?.length === 1
              ? output.scriptPubKey.addresses[0]
              : undefined);
          if (reported) {
            hash = addressToScriptHash(reported, workspace.network);
            address = bitcoinAddress.fromOutputScript(
              bitcoinAddress.toOutputScript(reported, network),
              network,
            );
          }
        }
      } catch {
        // Missing or malformed script evidence is unknown, regardless of labels/history.
      }
    }
    return {
      id,
      txid,
      vout,
      address,
      valueSats: output ? sats(output.value) : undefined,
      ownership: hash ? (hashes.has(hash) ? 'wallet' : 'external') : 'unknown',
      selected: id === selectedId,
      missing: output === undefined,
    };
  };
  const loadedOutput = (txid: string, vout: number) => {
    const tx = workspace.transactions[txid];
    return tx?.txid === txid ? tx.vout.find((output) => output.n === vout) : undefined;
  };
  const inputs =
    transaction?.vin.map((input): WalletReviewFlowEntry => {
      if (input.txid !== undefined && input.vout !== undefined)
        return entry(input.txid, input.vout, loadedOutput(input.txid, input.vout));
      return {
        id: txNodeId(transaction.txid),
        txid: transaction.txid,
        ownership: 'unknown',
        selected: false,
        missing: input.coinbase === undefined,
        coinbase: input.coinbase !== undefined,
      };
    }) ?? [];
  const outputs =
    transaction?.vout.map((output) => entry(transaction.txid, output.n, output)) ?? [];
  const selected = selectedPoint
    ? (outputs.find((output) => output.id === selectedId) ??
      entry(selectedPoint.txid, selectedPoint.vout))
    : undefined;
  const currentOutputs: WalletReviewFlowEntry[] = [];
  if (item.reason === 'source' && selectedPoint && selected?.ownership === 'wallet') {
    const seen = new Set<string>();
    for (const reference of item.nodeIds) {
      const id = canonicalId(reference, workspace);
      const point = id ? outpoint(id) : undefined;
      if (!id || !point || id === selectedId || seen.has(id)) continue;
      seen.add(id);
      const spending = workspace.transactions[point.txid];
      if (
        !spending?.vin.some(
          (input) => input.txid === selectedPoint.txid && input.vout === selectedPoint.vout,
        )
      )
        continue;
      const target = entry(point.txid, point.vout, loadedOutput(point.txid, point.vout));
      if (target.ownership === 'wallet') currentOutputs.push(target);
    }
  }
  return {
    transactionId,
    transactionNodeId: transactionId ? txNodeId(transactionId) : undefined,
    transaction,
    status: transaction ? 'loaded' : transactionId ? 'missing' : 'unavailable',
    inputs,
    outputs,
    currentOutputs,
    selected,
    role: !selectedPoint
      ? 'wallet-related-transaction'
      : selected?.ownership === 'wallet'
        ? 'wallet-output'
        : selected?.ownership === 'external' && inputs.some((input) => input.ownership === 'wallet')
          ? 'possible-counterparty'
          : 'unknown-output',
    missingPrevouts: inputs.filter((input) => input.missing && !input.coinbase).length,
  };
}

export interface RelatedEntity {
  id: string;
  address?: string;
  txid?: string;
}

/** Explicit relation within a supplied candidate set. No expansion, inferred
 * common ownership, case folding, partial matching or label-based identity. */
export function matchRelatedEntities(
  candidates: readonly RelatedEntity[],
  seeds: readonly RelatedEntity[],
  relation: 'address' | 'transaction',
): string[] {
  const key = relation === 'address' ? 'address' : 'txid';
  const values = new Set(
    seeds.map((seed) => seed[key]).filter((value): value is string => !!value),
  );
  return [
    ...new Set(
      candidates
        .filter((candidate) => !!candidate[key] && values.has(candidate[key]!))
        .map((candidate) => candidate.id),
    ),
  ];
}
