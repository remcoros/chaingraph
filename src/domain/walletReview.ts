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

export const MAX_WALLET_REVIEWS = 20_000;
export const REVIEW_REASONS = [
  'current-utxo',
  'source',
  'new-activity',
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
  'new-activity': 2,
  counterparty: 3,
  link: 4,
};
export const REASON_LABELS: Record<ReviewReason, string> = {
  'current-utxo': 'Current UTXO',
  source: 'Source',
  'new-activity': 'New receipt',
  counterparty: 'Counterparty',
  link: 'Review possible link',
};
const MAX_ITEMS_PER_REASON: Record<ReviewReason, number> = {
  'current-utxo': 400,
  source: 200,
  'new-activity': 100,
  counterparty: 100,
  link: 20,
};

/** Only these statuses complete a review. `later` stays pending work. */
export function isCompletedReview(decision?: ReviewDecision): boolean {
  return decision?.status === 'reviewed' || decision?.status === 'unknown';
}

export function reviewKey(walletId: string, reason: ReviewReason, subject: string): string {
  return `${walletId}|${reason}|${subject}`;
}

function fingerprint(value: string): string {
  return stableKey(value).slice(0, 16);
}

/** Kept local so the review module stays independent of graph derivation. */
function outputAddress(output: TxOutput): string | undefined {
  return (
    output.scriptPubKey.address ??
    (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined)
  );
}

function outputScriptHash(output: TxOutput, network: Workspace['network']): string | undefined {
  try {
    if (output.scriptPubKey.hex !== undefined)
      return bytesToHex(sha256(hexToBytes(output.scriptPubKey.hex)).reverse());
    const address = outputAddress(output);
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
  for (const transaction of Object.values(workspace.transactions))
    for (const output of transaction.vout) {
      if (!hashes.has(outputScriptHash(output, workspace.network) ?? '')) continue;
      const nodeId = outputNodeId(transaction.txid, output.n);
      owned.set(nodeId, {
        nodeId,
        txid: transaction.txid,
        vout: output.n,
        valueSats: Math.round(output.value * 100_000_000),
        address: outputAddress(output),
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
  const history = new Set<string>();
  for (const address of addresses)
    for (const entry of address.history ?? [])
      if (/^[0-9a-f]{64}$/i.test(entry.tx_hash)) history.add(entry.tx_hash.toLowerCase());
  for (const output of owned.values()) history.add(output.txid);

  // Exact recorded spends only. A missing spend is unknown, never proof of unspent.
  const spentOutpoints = new Set<string>();
  const walletFundedTransactions = new Set<string>();
  for (const transaction of Object.values(workspace.transactions))
    for (const input of transaction.vin) {
      if (input.txid === undefined || input.vout === undefined) continue;
      const id = outputNodeId(input.txid, input.vout);
      spentOutpoints.add(id);
      if (owned.has(id)) walletFundedTransactions.add(transaction.txid);
    }

  const verifiedUtxos = (options.utxos ?? []).filter((record) => {
    const transaction = workspace.transactions[record.txid];
    return !transaction || verifyWalletUtxo(record, transaction, workspace.network);
  });
  const candidates = new Map<ReviewReason, ReviewSubject[]>();
  const push = (subject: ReviewSubject) => {
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
    const creating = workspace.transactions[record.txid];
    if (!creating) {
      missingSourceTransactions++;
      continue;
    }
    for (const input of creating.vin) {
      if (input.txid === undefined || input.vout === undefined) continue;
      const predecessor = owned.get(outputNodeId(input.txid, input.vout));
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
      nodeIds: [output.nodeId],
      txid: output.txid,
      amountSats: output.valueSats,
      address: output.address,
      evidence: fingerprint(`source|${output.nodeId}|${utxos.sort().join(',')}`),
    });
  }

  for (const txid of wallet.unreviewedTransactionIds ?? []) {
    const nodeId = txNodeId(txid);
    const transaction = workspace.transactions[txid];
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

  // Only transactions this wallet funded can identify a counterparty I paid.
  // Outputs of a batch that merely paid me belong to other people.
  const counterparties: { nodeId: string; txid: string; valueSats: number; address?: string }[] =
    [];
  for (const txid of walletFundedTransactions) {
    const transaction = workspace.transactions[txid];
    if (!transaction) continue;
    for (const output of transaction.vout) {
      const nodeId = outputNodeId(txid, output.n);
      if (owned.has(nodeId)) continue;
      counterparties.push({
        nodeId,
        txid,
        valueSats: Math.round(output.value * 100_000_000),
        address: outputAddress(output),
      });
    }
  }
  for (const entry of counterparties.sort((a, b) => b.valueSats - a.valueSats))
    push({
      key: reviewKey(wallet.id, 'counterparty', entry.nodeId.slice(4)),
      reason: 'counterparty',
      title: `Payment of ${entry.valueSats.toLocaleString('en-US')} sats`,
      detail:
        'This wallet funded the transaction and this output is not a verified wallet address. It may be a counterparty you paid; it is not proof of who controls it.',
      nodeId: entry.nodeId,
      nodeIds: [entry.nodeId],
      txid: entry.txid,
      amountSats: entry.valueSats,
      address: entry.address,
      evidence: fingerprint(`counterparty|${entry.nodeId}|${entry.valueSats}`),
    });

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

  const loadedTransactions = [...history].filter((id) => workspace.transactions[id]).length;
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
