import { canonicalEntityNodeId } from './entityReferences';
import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputResolution,
} from './prevouts';
import { verifiedWalletAddresses } from './walletRecords';
import {
  canonicalTransactionId,
  loadedWalletTransactions,
  validOutputIndex,
  walletOutputEvidence,
} from './walletRelationships';
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
  prevoutStatus?: PreviousOutputResolution['status'];
  coinbase?: boolean;
}

export interface WalletReviewContext {
  /** Raw transaction ID, suitable for looking up loaded observations. */
  transactionId?: string;
  transactionNodeId?: string;
  /** Canonical annotation target, which can be an address or transaction. */
  selectedNodeId?: string;
  transactionSelected: boolean;
  transaction?: Transaction;
  status: 'loaded' | 'missing' | 'unavailable';
  /** Full arrays. A presentation limit must never change factual row counts. */
  inputs: WalletReviewFlowEntry[];
  outputs: WalletReviewFlowEntry[];
  /** Explicit source-review targets, verified as direct spends into wallet outputs.
   * This snapshot does not independently establish their present unspent status. */
  currentOutputs: WalletReviewFlowEntry[];
  selected?: WalletReviewFlowEntry;
  selectedSide?: 'input' | 'output';
  role: 'wallet-output' | 'possible-counterparty' | 'wallet-related-transaction' | 'unknown-output';
  missingPrevouts: number;
}

export interface WalletReviewContextSubject {
  nodeId: string;
  txid?: string;
  nodeIds?: readonly string[];
  reason?: string;
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

/** A local projection of an explicitly chosen or creating transaction. No history-based ownership,
 * graph widening, automatic downloads or inferred input-to-output value mapping.
 * Wallet address derivation was verified at the workspace import/scan boundary. */
export function buildWalletReviewContext(
  workspace: Workspace,
  wallet: Wallet,
  item: WalletReviewContextSubject,
  contextTransactionId?: string,
): WalletReviewContext {
  const selectedId = canonicalId(item.nodeId, workspace);
  const selectedPoint = selectedId ? outpoint(selectedId) : undefined;
  const selectedAddress = selectedId?.startsWith('addr:') ? selectedId.slice(5) : undefined;
  const transactionId =
    contextTransactionId !== undefined
      ? canonicalTransactionId(contextTransactionId)
      : selectedAddress
        ? undefined
        : (selectedPoint?.txid ??
          (selectedId?.startsWith('tx:') ? selectedId.slice(3) : undefined) ??
          canonicalTransactionId(item.txid));
  const transactions = loadedWalletTransactions(workspace);
  const transaction = transactionId ? transactions.get(transactionId) : undefined;
  const hashes = new Set(
    verifiedWalletAddresses(wallet, workspace.network).map((entry) => entry.scripthash),
  );
  const prevouts = indexPreviousOutputs(workspace);

  const entry = (
    txid: string,
    vout: number,
    output?: TxOutput,
    prevoutStatus?: PreviousOutputResolution['status'],
  ): WalletReviewFlowEntry => {
    const id = outputNodeId(txid, vout);
    const { scripthash: hash, address } = walletOutputEvidence(output, workspace.network);
    return {
      id,
      txid,
      vout,
      address,
      valueSats: output ? sats(output.value) : undefined,
      ownership: hash && hashes.has(hash) ? 'wallet' : address ? 'external' : 'unknown',
      selected: id === selectedId || (!!selectedAddress && address === selectedAddress),
      missing: output === undefined,
      prevoutStatus,
    };
  };
  const knownOutput = (txid: string, vout: number) => {
    const resolution = resolvePreviousOutput(workspace, { txid, vout }, prevouts);
    return {
      output:
        resolution.status === 'loaded' || resolution.status === 'attached'
          ? resolution.output
          : undefined,
      status: resolution.status,
    };
  };
  const inputs =
    transaction?.vin.map((input): WalletReviewFlowEntry => {
      const parent = canonicalTransactionId(input.txid);
      if (input.coinbase === undefined && parent && validOutputIndex(input.vout)) {
        const resolved = knownOutput(parent, input.vout);
        return entry(parent, input.vout, resolved.output, resolved.status);
      }
      return {
        id: txNodeId(transactionId!),
        txid: transactionId,
        ownership: 'unknown',
        selected: false,
        missing: input.coinbase === undefined,
        coinbase: input.coinbase !== undefined,
      };
    }) ?? [];
  const outputs =
    transaction?.vout
      .filter((output) => validOutputIndex(output.n))
      .map((output) => entry(transactionId!, output.n, output)) ?? [];
  const selected = selectedPoint
    ? (inputs.find((input) => input.id === selectedId) ??
      outputs.find((output) => output.id === selectedId) ??
      (() => {
        const resolved = knownOutput(selectedPoint.txid, selectedPoint.vout);
        return entry(selectedPoint.txid, selectedPoint.vout, resolved.output, resolved.status);
      })())
    : undefined;
  const currentOutputs: WalletReviewFlowEntry[] = [];
  if (item.reason === 'source' && selectedPoint && selected?.ownership === 'wallet') {
    const seen = new Set<string>();
    for (const reference of item.nodeIds ?? []) {
      const id = canonicalId(reference, workspace);
      const point = id ? outpoint(id) : undefined;
      if (!id || !point || id === selectedId || seen.has(id)) continue;
      seen.add(id);
      const spending = transactions.get(point.txid);
      if (
        !spending?.vin.some(
          (input) =>
            input.coinbase === undefined &&
            canonicalTransactionId(input.txid) === selectedPoint.txid &&
            input.vout === selectedPoint.vout,
        )
      )
        continue;
      const resolved = knownOutput(point.txid, point.vout);
      const target = entry(point.txid, point.vout, resolved.output, resolved.status);
      if (target.ownership === 'wallet') currentOutputs.push(target);
    }
  }
  return {
    transactionId,
    transactionNodeId: transactionId ? txNodeId(transactionId) : undefined,
    selectedNodeId: selectedId,
    transactionSelected:
      selectedId === (transactionId ? txNodeId(transactionId) : undefined) && !!selectedId,
    transaction,
    status: transaction ? 'loaded' : transactionId ? 'missing' : 'unavailable',
    inputs,
    outputs,
    currentOutputs,
    selected,
    selectedSide: inputs.some((input) => input.selected && input.id === selectedId)
      ? 'input'
      : outputs.some((output) => output.selected && output.id === selectedId)
        ? 'output'
        : undefined,
    role: !selectedPoint
      ? 'wallet-related-transaction'
      : selected?.ownership === 'wallet'
        ? 'wallet-output'
        : selected?.ownership === 'external' &&
            outputs.some((output) => output.id === selectedId) &&
            inputs.some((input) => input.ownership === 'wallet')
          ? 'possible-counterparty'
          : 'unknown-output',
    missingPrevouts: inputs.filter((input) => input.missing && !input.coinbase).length,
  };
}

export interface RelatedEntity {
  id: string;
  address?: string;
  txid?: string;
  transactionIds?: readonly string[];
}

/** Explicit relation within a supplied candidate set. No expansion, inferred
 * common ownership, case folding, partial matching or label-based identity. */
export function matchRelatedEntities(
  candidates: readonly RelatedEntity[],
  seeds: readonly RelatedEntity[],
  relation: 'address' | 'transaction',
): string[] {
  const valuesFor = (entity: RelatedEntity): readonly string[] =>
    relation === 'address'
      ? entity.address
        ? [entity.address]
        : []
      : entity.txid
        ? [entity.txid]
        : (entity.transactionIds ?? []);
  const values = new Set(seeds.flatMap((seed) => [...valuesFor(seed)]));
  return [
    ...new Set(
      candidates
        .filter((candidate) => valuesFor(candidate).some((value) => values.has(value)))
        .map((candidate) => candidate.id),
    ),
  ];
}
