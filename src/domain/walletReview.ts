import { z } from 'zod';
import { stableKey } from './analysis/shared';
import { verifiedWalletAddresses, verifyWalletUtxo, type WalletUtxoRecord } from './walletRecords';
import { listTagsForNode } from './tags';
import {
  outputNodeId,
  short,
  txNodeId,
  type TxOutput,
  type AnalysisFinding,
  type Transaction,
  type Wallet,
  type Workspace,
} from './types';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addressToScriptHash } from '../lib/wallet';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import {
  canonicalTransactionId,
  groupWalletRelationships,
  loadedWalletTransactions,
  validOutputIndex,
  type WalletRelationship,
  type WalletRelationshipContext,
} from './walletRelationships';

export const MAX_WALLET_REVIEWS = 20_000;
export const REVIEW_REASONS = [
  'current-utxo',
  'source',
  'source-address',
  'funding-source',
  'new-activity',
  'destination-address',
  'counterparty',
  'link',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];
export type ReviewStatus = 'reviewed' | 'unknown' | 'later';

export interface ReviewDecision {
  status: ReviewStatus;
  at: string;
  /** Fingerprint of the observations this decision was made against. */
  evidence: string;
}

export const walletReviewsSchema = z
  .record(
    z.string().max(200),
    z.object({
      status: z.enum(['reviewed', 'unknown', 'later']),
      at: z.iso.datetime({ offset: true }),
      evidence: z.string().max(80),
    }),
  )
  .refine(
    (value) => Object.keys(value).length <= MAX_WALLET_REVIEWS,
    `A workspace holds at most ${MAX_WALLET_REVIEWS.toLocaleString('en-US')} review decisions.`,
  );

export function assertWalletReviewBudget(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.keys(value as object).length > MAX_WALLET_REVIEWS)
    throw new Error(
      `A workspace holds at most ${MAX_WALLET_REVIEWS.toLocaleString('en-US')} review decisions.`,
    );
}

export interface WalletReviewItem {
  /** Stable per wallet, reason and subject, so decisions survive a refresh. */
  key: string;
  reason: ReviewReason;
  title: string;
  detail: string;
  /** Primary entity for Inspect, Show in Graph and Analyze. */
  nodeId: string;
  nodeIds: string[];
  txid?: string;
  amountSats?: number;
  address?: string;
  label: string;
  tags: string[];
  evidence: string;
  status: ReviewStatus | 'open';
  decidedAt?: string;
  /** A decision exists, but the observations behind the item changed. */
  changed: boolean;
  /** One-hop roles are independent of the persisted review reason. */
  relationshipKinds?: ('source' | 'destination')[];
  ownership?: WalletRelationship['ownership'];
  transactionIds?: string[];
  walletOutputIds?: string[];
  /** Constituent evidence only. Address review nodeIds contain only the address edit target. */
  outpointIds?: string[];
  contexts?: WalletRelationshipContext[];
  /** A saved output-only decision retained separately from its address group. */
  legacyOutputReview?: boolean;
  /** Registry algorithm associated with a saved finding. */
  algorithm?: string;
}

export interface WalletReviewCoverage {
  scannedAt?: string;
  scanComplete: boolean;
  discoveredAddresses: number;
  usedAddresses: number;
  knownTransactions: number;
  loadedTransactions: number;
  pendingTransactions: number;
  utxoCheckedAt?: string;
  utxoCheckedAddresses?: number;
  utxoTotalAddresses?: number;
  utxoCount?: number;
  utxoBalanceSats?: number;
  /** The check covered only part of the discovered addresses. */
  utxoPartial: boolean;
}

export interface WalletReview {
  items: WalletReviewItem[];
  /** Candidates beyond the current bound, reachable by requesting a later page. */
  omittedItems: number;
  /** Unresolved candidates beyond the bound, so a count can be shown as partial. */
  omittedPendingItems: number;
  coverage: WalletReviewCoverage;
  /** Loaded ancestry was missing for some current UTXOs, so sources are incomplete. */
  missingSourceTransactions: number;
}

const REASON_ORDER: Record<ReviewReason, number> = {
  'current-utxo': 0,
  source: 1,
  'source-address': 2,
  'funding-source': 3,
  'new-activity': 4,
  'destination-address': 5,
  counterparty: 6,
  link: 7,
};
export const REASON_LABELS: Record<ReviewReason, string> = {
  'current-utxo': 'Current UTXO',
  source: 'Earlier wallet receipt',
  'source-address': 'Source address',
  'funding-source': 'Direct funding source',
  'new-activity': 'New activity',
  'destination-address': 'Destination address',
  counterparty: 'Counterparty',
  link: 'Review possible link',
};
const MAX_ITEMS_PER_REASON: Record<ReviewReason, number> = {
  'current-utxo': 400,
  source: 200,
  'source-address': 200,
  'funding-source': 200,
  'new-activity': 100,
  'destination-address': 100,
  counterparty: 100,
  link: 20,
};

/** Only these statuses complete a review. `later` stays pending work. */
export function isCompletedReview(
  decision?: Pick<ReviewDecision, 'status'> | ReviewDecision,
): boolean {
  return decision?.status === 'reviewed' || decision?.status === 'unknown';
}

export function reviewKey(walletId: string, reason: ReviewReason, subject: string): string {
  return `${walletId}|${reason}|${subject}`;
}

function fingerprint(value: string): string {
  return stableKey(value).slice(0, 16);
}

/** Raw scripts are authoritative, including when imported address text conflicts.
 * Address-only observations must encode a valid script on this workspace network. */
function outputAddress(output: TxOutput, network: Workspace['network']): string | undefined {
  try {
    const bitcoinNetwork = network === 'mainnet' ? networks.bitcoin : networks.testnet;
    if (output.scriptPubKey.hex !== undefined)
      return bitcoinAddress.fromOutputScript(hexToBytes(output.scriptPubKey.hex), bitcoinNetwork);
    const address =
      output.scriptPubKey.address ??
      (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined);
    if (!address) return undefined;
    addressToScriptHash(address, network);
    return bitcoinAddress.fromOutputScript(
      bitcoinAddress.toOutputScript(address, bitcoinNetwork),
      bitcoinNetwork,
    );
  } catch {
    // A non-address or malformed raw script never falls back to claimed metadata.
    return undefined;
  }
}

function outputScriptHash(output: TxOutput, network: Workspace['network']): string | undefined {
  try {
    if (output.scriptPubKey.hex !== undefined)
      return bytesToHex(sha256(hexToBytes(output.scriptPubKey.hex)).reverse());
    const address = outputAddress(output, network);
    return address ? addressToScriptHash(address, network) : undefined;
  } catch {
    return undefined;
  }
}

interface OwnedOutput {
  nodeId: string;
  txid: string;
  vout: number;
  valueSats: number;
  address?: string;
}

/** Verified wallet outputs in loaded data. Membership is derivation evidence,
 * never a claim that an output is publicly linked to the other wallet outputs.
 */
export function walletOwnedOutputs(workspace: Workspace, wallet: Wallet): Map<string, OwnedOutput> {
  const hashes = new Set(
    verifiedWalletAddresses(wallet, workspace.network).map((address) => address.scripthash),
  );
  const owned = new Map<string, OwnedOutput>();
  if (!hashes.size) return owned;
  for (const [txid, transaction] of loadedWalletTransactions(workspace))
    for (const output of transaction.vout) {
      if (!validOutputIndex(output.n)) continue;
      if (!hashes.has(outputScriptHash(output, workspace.network) ?? '')) continue;
      const nodeId = outputNodeId(txid, output.n);
      owned.set(nodeId, {
        nodeId,
        txid,
        vout: output.n,
        valueSats: Math.round(output.value * 100_000_000),
        address: outputAddress(output, workspace.network),
      });
    }
  return owned;
}

function annotationOf(workspace: Workspace, nodeId: string) {
  return workspace.annotations[nodeId];
}

function tagNamesFor(workspace: Workspace, nodeId: string, address?: string): string[] {
  return listTagsForNode(workspace, {
    id: nodeId,
    kind: nodeId.startsWith('tx:')
      ? 'transaction'
      : nodeId.startsWith('addr:')
        ? 'address'
        : 'output',
    label: '',
    address,
  }).map((tag) => tag.name);
}

type ReviewSubject = Omit<WalletReviewItem, 'status' | 'changed' | 'label' | 'tags' | 'decidedAt'>;

function decorate(workspace: Workspace, item: ReviewSubject): WalletReviewItem {
  const decision = workspace.walletReviews?.[item.key];
  return {
    ...item,
    label: annotationOf(workspace, item.nodeId)?.label ?? '',
    tags: tagNamesFor(workspace, item.nodeId, item.address),
    status: decision?.status ?? 'open',
    decidedAt: decision?.at,
    changed: !!decision && decision.evidence !== item.evidence,
  };
}

function findingCoversWallet(finding: AnalysisFinding, owned: Map<string, OwnedOutput>): boolean {
  return finding.nodeIds.some((id) => owned.has(id));
}

/** Derive the review queue from loaded observations and verified UTXO checks.
 * No network requests, heuristics or ownership claims are produced here.
 */
export function buildWalletReview(
  workspace: Workspace,
  wallet: Wallet,
  options: {
    utxos?: WalletUtxoRecord[];
    utxoCheckedAt?: string;
    utxoCheckedAddresses?: number;
    utxoTotalAddresses?: number;
    utxoPartial?: boolean;
    /** Multiplies the per-reason bound for an explicit continuation. */
    page?: number;
  } = {},
): WalletReview {
  const addresses = verifiedWalletAddresses(wallet, workspace.network);
  const owned = walletOwnedOutputs(workspace, wallet);
  const groups = groupWalletRelationships(workspace, wallet);
  const relationships = {
    sources: [...groups.sources.flatMap((group) => group.outpoints), ...groups.sourceExceptions],
    destinations: [
      ...groups.destinations.flatMap((group) => group.outpoints),
      ...groups.destinationExceptions,
    ],
  };
  const loaded = loadedWalletTransactions(workspace);
  const directSources = new Map(relationships.sources.map((entry) => [entry.id, entry]));
  const directDestinations = new Map(relationships.destinations.map((entry) => [entry.id, entry]));
  const history = new Set<string>();
  for (const address of addresses)
    for (const entry of address.history ?? [])
      if (/^[0-9a-f]{64}$/i.test(entry.tx_hash)) history.add(entry.tx_hash.toLowerCase());
  for (const output of owned.values()) history.add(output.txid);

  // Exact recorded spends only. A missing spend is unknown, never proof of unspent.
  const walletFundedTransactions = new Set<string>();
  for (const [txid, transaction] of loaded)
    for (const input of transaction.vin) {
      const parent = canonicalTransactionId(input.txid);
      if (input.coinbase !== undefined || !parent || !validOutputIndex(input.vout)) continue;
      const id = outputNodeId(parent, input.vout);
      if (owned.has(id)) {
        walletFundedTransactions.add(txid);
        history.add(txid);
      }
    }

  const walletHashes = new Set(addresses.map((address) => address.scripthash));
  const verifiedUtxos = (options.utxos ?? [])
    .map((record) => ({
      ...record,
      txid: canonicalTransactionId(record.txid) ?? record.txid,
    }))
    .filter((record) => {
      try {
        if (
          !walletHashes.has(record.scripthash) ||
          addressToScriptHash(record.address, workspace.network) !== record.scripthash ||
          !canonicalTransactionId(record.txid) ||
          !validOutputIndex(record.vout) ||
          !Number.isSafeInteger(record.valueSats) ||
          record.valueSats < 0 ||
          record.valueSats > 2_100_000_000_000_000
        )
          return false;
        const transaction = loaded.get(record.txid);
        return (
          !transaction ||
          verifyWalletUtxo(record, { ...transaction, txid: record.txid }, workspace.network)
        );
      } catch {
        return false;
      }
    });
  const candidates = new Map<ReviewReason, ReviewSubject[]>();
  const push = (subject: ReviewSubject) => {
    const source = directSources.get(subject.nodeId);
    const destination = directDestinations.get(subject.nodeId);
    const related = [source, destination].filter((entry): entry is WalletRelationship => !!entry);
    if (related.length) {
      subject = {
        ...subject,
        relationshipKinds: [
          ...(source ? ['source' as const] : []),
          ...(destination ? ['destination' as const] : []),
        ],
        transactionIds: [...new Set(related.flatMap((entry) => entry.transactionIds))].sort(),
        walletOutputIds: [...new Set(related.flatMap((entry) => entry.walletOutputIds))].sort(),
      };
    }
    const list = candidates.get(subject.reason);
    if (list) list.push(subject);
    else candidates.set(subject.reason, [subject]);
  };

  for (const record of verifiedUtxos) {
    const nodeId = outputNodeId(record.txid, record.vout);
    push({
      key: reviewKey(wallet.id, 'current-utxo', `${record.txid}:${record.vout}`),
      reason: 'current-utxo',
      title: `Unspent output ${short(record.txid, 6)}:${record.vout}`,
      detail: 'Unspent at the last check. Give it a label or tag so a future spend has context.',
      nodeId,
      nodeIds: [nodeId],
      txid: record.txid,
      amountSats: record.valueSats,
      address: record.address,
      evidence: fingerprint(`utxo|${record.txid}|${record.vout}|${record.valueSats}`),
    });
  }

  let missingSourceTransactions = 0;
  const sources = new Map<string, { output: OwnedOutput; utxos: string[] }>();
  for (const record of verifiedUtxos) {
    const creating = loaded.get(record.txid);
    if (!creating) {
      missingSourceTransactions++;
      continue;
    }
    for (const input of creating.vin) {
      const parent = canonicalTransactionId(input.txid);
      if (input.coinbase !== undefined || !parent || !validOutputIndex(input.vout)) continue;
      const predecessor = owned.get(outputNodeId(parent, input.vout));
      if (!predecessor) continue;
      const entry = sources.get(predecessor.nodeId) ?? { output: predecessor, utxos: [] };
      entry.utxos.push(`${record.txid}:${record.vout}`);
      sources.set(predecessor.nodeId, entry);
    }
  }
  for (const { output, utxos } of [...sources.values()].sort(
    (a, b) => b.output.valueSats - a.output.valueSats,
  )) {
    // Metadata decorates the evidence; only an explicit decision completes review.
    push({
      key: reviewKey(wallet.id, 'source', `${output.txid}:${output.vout}`),
      reason: 'source',
      title: `Receipt of ${output.valueSats.toLocaleString('en-US')} sats`,
      detail: `This wallet output was spent into ${utxos.length} current UTXO${
        utxos.length === 1 ? '' : 's'
      }. Recording where it came from explains today's balance.`,
      nodeId: output.nodeId,
      nodeIds: [output.nodeId, ...utxos.map((point) => `out:${point}`)],
      txid: output.txid,
      amountSats: output.valueSats,
      address: output.address,
      evidence: fingerprint(`source|${output.nodeId}|${utxos.sort().join(',')}`),
    });
  }

  for (const direction of ['source', 'destination'] as const) {
    const reason = direction === 'source' ? 'source-address' : 'destination-address';
    for (const group of direction === 'source' ? groups.sources : groups.destinations) {
      if (group.ownership !== 'external') continue;
      push({
        key: reviewKey(wallet.id, reason, group.id),
        reason,
        title: `${direction === 'source' ? 'Source' : 'Destination'} address ${short(group.address, 10)}`,
        detail: `${group.count} distinct observed output${group.count === 1 ? '' : 's'} ${
          direction === 'source'
            ? 'used as inputs of loaded transactions paying verified wallet scripts'
            : 'created by loaded transactions spending verified wallet outputs'
        }. Review and metadata apply to this address only. The observed value total is not a flow allocation or balance, and an address does not identify a controller.`,
        nodeId: group.id,
        nodeIds: [group.id],
        address: group.address,
        amountSats: group.amountSats,
        relationshipKinds: [direction],
        ownership: group.ownership,
        transactionIds: group.transactionIds,
        walletOutputIds: group.walletOutputIds,
        outpointIds: group.outpointIds,
        contexts: group.contexts,
        evidence: fingerprint(
          JSON.stringify([
            reason,
            group.id,
            group.ownership,
            group.outpoints.map((output) => [
              output.id,
              output.amountSats,
              output.ownership,
              output.missing,
              output.contexts,
            ]),
          ]),
        ),
      });
    }
  }

  // Address groups get independent decisions. Keep replaced output reviews only
  // when a saved decision exists, without copying it onto the entire address.
  const representedSources = new Set([
    ...sources.keys(),
    ...verifiedUtxos.map((record) => outputNodeId(record.txid, record.vout)),
  ]);
  for (const source of relationships.sources) {
    const key = reviewKey(wallet.id, 'funding-source', source.id.slice(4));
    const saved = workspace.walletReviews?.[key];
    if (source.address ? !saved : representedSources.has(source.id) && !saved) continue;
    const output = loaded.get(source.txid)?.vout.find((entry) => entry.n === source.vout);
    push({
      key,
      reason: 'funding-source',
      title: `${source.address ? 'Saved funding-output review' : 'Funding output without address'} ${short(source.txid, 6)}:${source.vout}`,
      detail: source.address
        ? 'Saved output-only review. This decision does not review the entire source address or its other outputs. The whole output value is not an allocation to a particular wallet output.'
        : source.missing
          ? 'This exact input is referenced by a loaded transaction paying the wallet, but its previous output is missing. No address or input value is established.'
          : 'This direct input has no verified address representation. Review this output exception only; its observed value is not an allocation to a particular wallet output.',
      legacyOutputReview: source.address ? true : undefined,
      nodeId: source.id,
      nodeIds: [source.id, ...source.walletOutputIds],
      txid: source.txid,
      address: source.address,
      amountSats: source.amountSats,
      evidence: fingerprint(
        JSON.stringify([
          'funding-source',
          source.id,
          source.amountSats,
          source.missing,
          source.ownership,
          output ? outputScriptHash(output, workspace.network) : undefined,
          source.contexts,
        ]),
      ),
    });
  }

  for (const txid of wallet.unreviewedTransactionIds ?? []) {
    const nodeId = txNodeId(txid);
    const transaction = loaded.get(txid);
    push({
      key: reviewKey(wallet.id, 'new-activity', txid),
      reason: 'new-activity',
      title: 'New activity since your last review',
      detail: transaction
        ? `Discovered by a wallet refresh with ${transaction.vin.length} input${
            transaction.vin.length === 1 ? '' : 's'
          } and ${transaction.vout.length} output${transaction.vout.length === 1 ? '' : 's'}.`
        : 'Discovered in an address history. Open it in Graph to load the transaction.',
      nodeId,
      nodeIds: [nodeId],
      txid,
      evidence: fingerprint(`activity|${txid}`),
    });
  }

  // Only exact wallet spends establish outgoing context. A no-match output may
  // still use an undiscovered wallet script; incoming batch peers are not included.
  const counterparties: { nodeId: string; txid: string; valueSats: number; address?: string }[] =
    [];
  for (const txid of walletFundedTransactions) {
    const transaction = loaded.get(txid);
    if (!transaction) continue;
    for (const output of transaction.vout) {
      const nodeId = outputNodeId(txid, output.n);
      if (owned.has(nodeId)) continue;
      counterparties.push({
        nodeId,
        txid,
        valueSats: Math.round(output.value * 100_000_000),
        address: outputAddress(output, workspace.network),
      });
    }
  }
  for (const entry of counterparties.sort((a, b) => b.valueSats - a.valueSats)) {
    const key = reviewKey(wallet.id, 'counterparty', entry.nodeId.slice(4));
    if (entry.address && !workspace.walletReviews?.[key]) continue;
    push({
      key,
      reason: 'counterparty',
      title: `${entry.address ? 'Saved destination-output review' : 'Destination output without address'} ${short(entry.txid, 6)}:${entry.nodeId.split(':')[2]}`,
      detail: entry.address
        ? 'Saved output-only review. This decision does not review the entire destination address or its other outputs. No controller is identified.'
        : 'This output was created by a transaction spending verified wallet outputs, but no address is established. It remains an explicit output exception, not an identified counterparty.',
      legacyOutputReview: entry.address ? true : undefined,
      nodeId: entry.nodeId,
      nodeIds: [entry.nodeId],
      txid: entry.txid,
      amountSats: entry.valueSats,
      address: entry.address,
      evidence: fingerprint(`counterparty|${entry.nodeId}|${entry.valueSats}`),
    });
  }

  for (const finding of workspace.findings) {
    if (finding.excluded || finding.stale) continue;
    if (!findingCoversWallet(finding, owned)) continue;
    const nodeIds = finding.nodeIds.filter((id) => owned.has(id));
    push({
      key: reviewKey(wallet.id, 'link', finding.id),
      reason: 'link',
      title: finding.title,
      detail: finding.description,
      nodeId: nodeIds[0] ?? finding.nodeIds[0],
      nodeIds: finding.nodeIds,
      txid: finding.txids[0],
      algorithm: finding.algorithm,
      evidence: fingerprint(
        `link|${finding.algorithm}|${[...finding.nodeIds].sort().join(',')}|${[...finding.txids]
          .sort()
          .join(',')}`,
      ),
    });
  }

  // Bounded processing must never claim completion. Unresolved candidates are
  // selected before settled ones, and anything left over is reported with a real
  // continuation instead of being silently dropped.
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const settled = (subject: ReviewSubject) => {
    const decision = workspace.walletReviews?.[subject.key];
    return isCompletedReview(decision) && decision!.evidence === subject.evidence;
  };
  const items: WalletReviewItem[] = [];
  let omittedItems = 0;
  let omittedPendingItems = 0;
  for (const reason of REVIEW_REASONS) {
    const list = candidates.get(reason) ?? [];
    const limit = MAX_ITEMS_PER_REASON[reason] * page;
    if (list.length <= limit) {
      for (const subject of list) items.push(decorate(workspace, subject));
      continue;
    }
    const pending = list.filter((subject) => !settled(subject));
    const chosen = [...pending, ...list.filter(settled)].slice(0, limit);
    omittedItems += list.length - chosen.length;
    omittedPendingItems += Math.max(0, pending.length - limit);
    for (const subject of chosen) items.push(decorate(workspace, subject));
  }

  items.sort(
    (a, b) =>
      REASON_ORDER[a.reason] - REASON_ORDER[b.reason] ||
      Number(!!a.label) - Number(!!b.label) ||
      (b.amountSats ?? -1) - (a.amountSats ?? -1) ||
      a.key.localeCompare(b.key),
  );

  const loadedTransactions = [...history].filter((id) => loaded.has(id)).length;
  return {
    items,
    omittedItems,
    omittedPendingItems,
    missingSourceTransactions,
    coverage: {
      scannedAt: wallet.scannedAt,
      scanComplete: wallet.scanComplete === true,
      discoveredAddresses: addresses.length,
      usedAddresses: addresses.filter((address) => address.history?.length).length,
      knownTransactions: history.size,
      loadedTransactions,
      pendingTransactions: wallet.pendingTransactionIds?.length ?? 0,
      utxoCheckedAt: options.utxoCheckedAt,
      utxoCheckedAddresses: options.utxoCheckedAddresses,
      utxoTotalAddresses: options.utxoTotalAddresses,
      utxoCount: options.utxos ? verifiedUtxos.length : undefined,
      utxoBalanceSats: options.utxos
        ? verifiedUtxos.reduce((total, record) => total + record.valueSats, 0)
        : undefined,
      utxoPartial:
        options.utxoPartial === true ||
        (options.utxos !== undefined &&
          options.utxoTotalAddresses !== undefined &&
          (options.utxoCheckedAddresses ?? 0) < options.utxoTotalAddresses),
    },
  };
}

export function openReviewItems(items: WalletReviewItem[]): WalletReviewItem[] {
  return items.filter((item) => item.status === 'open' || item.status === 'later' || item.changed);
}

function withReviews(
  workspace: Workspace,
  reviews: Record<string, ReviewDecision>,
): Workspace['walletReviews'] {
  const keys = Object.keys(reviews);
  if (keys.length <= MAX_WALLET_REVIEWS) return keys.length ? reviews : undefined;
  // Keep the newest decisions rather than failing an ordinary review action.
  const kept = keys
    .sort((a, b) => Date.parse(reviews[b].at) - Date.parse(reviews[a].at))
    .slice(0, MAX_WALLET_REVIEWS);
  return Object.fromEntries(kept.map((key) => [key, reviews[key]]));
}

/** One workspace update for any number of items, so Undo restores the whole batch. */
export function applyReviewDecisions(
  workspace: Workspace,
  wallet: Wallet,
  items: readonly WalletReviewItem[],
  status: ReviewStatus | 'reopen',
  now = new Date().toISOString(),
): Workspace {
  if (!items.length) return workspace;
  const reviews = { ...(workspace.walletReviews ?? {}) };
  const acknowledged = new Set<string>();
  let changed = false;
  for (const item of items) {
    if (status === 'reopen') {
      if (reviews[item.key] !== undefined) {
        delete reviews[item.key];
        changed = true;
      }
      continue;
    }
    const previous = reviews[item.key];
    if (previous?.status === status && previous.evidence === item.evidence) continue;
    reviews[item.key] = { status, at: now, evidence: item.evidence };
    changed = true;
    // Deferral is not completion: refreshed activity stays in the wallet queue so
    // the item remains discoverable instead of disappearing from every view.
    if (item.reason === 'new-activity' && item.txid && status !== 'later')
      acknowledged.add(item.txid);
  }
  if (!changed) return workspace;
  if (
    items.some(
      (item) => item.reason === 'source-address' || item.reason === 'destination-address',
    ) &&
    Object.keys(reviews).length > MAX_WALLET_REVIEWS
  )
    throw new Error(
      `A workspace holds at most ${MAX_WALLET_REVIEWS.toLocaleString('en-US')} review decisions. Reopen an existing review before adding an address decision.`,
    );
  const wallets = acknowledged.size
    ? workspace.wallets.map((entry) =>
        entry.id === wallet.id
          ? {
              ...entry,
              unreviewedTransactionIds: (entry.unreviewedTransactionIds ?? []).filter(
                (id) => !acknowledged.has(id),
              ),
            }
          : entry,
      )
    : workspace.wallets;
  return { ...workspace, wallets, walletReviews: withReviews(workspace, reviews) };
}

/** Drop decisions for wallets that no longer exist, keeping the record bounded. */
export function pruneWalletReviews(workspace: Workspace): Workspace {
  if (!workspace.walletReviews) return workspace;
  const ids = new Set(workspace.wallets.map((wallet) => wallet.id));
  const kept = Object.entries(workspace.walletReviews).filter(([key]) =>
    ids.has(key.slice(0, key.indexOf('|'))),
  );
  if (kept.length === Object.keys(workspace.walletReviews).length) return workspace;
  return { ...workspace, walletReviews: kept.length ? Object.fromEntries(kept) : undefined };
}

/** An evidence-based sentence, or nothing. No score, probability or guarantee. */
export function spendGuidance(
  workspace: Workspace,
  selectedOutputIds: readonly string[],
): string | undefined {
  if (selectedOutputIds.length < 2) return undefined;
  const groups = new Set<string>();
  let unknown = 0;
  for (const id of selectedOutputIds) {
    const label = workspace.annotations[id]?.label?.trim();
    const tags = (workspace.tags ?? [])
      .filter((tag) => tag.nodeIds.includes(id))
      .map((tag) => tag.name)
      .sort();
    if (tags.length) groups.add(`tag:${tags.join('+')}`);
    else if (label) groups.add(`label:${label.toLowerCase()}`);
    else unknown++;
  }
  if (groups.size >= 2)
    return `These selected outputs carry ${groups.size} different source labels or tags. Combining them as inputs of one ordinary spend would publish that link.`;
  if (groups.size === 1 && unknown)
    return `${unknown} of the selected outputs ${
      unknown === 1 ? 'has' : 'have'
    } no recorded source. Review ${
      unknown === 1 ? 'it' : 'them'
    } before combining labelled and unknown coins in one spend.`;
  return undefined;
}
