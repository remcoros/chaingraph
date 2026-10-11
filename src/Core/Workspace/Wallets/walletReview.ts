import {
  createWalletOutputEvidenceResolver,
  type WalletOutputEvidenceResolver,
} from './walletOutputEvidence';
import { short } from '../../Formatting';
import { stableKey } from '../Analysis/tools/shared';
import { walletFindingEvidence } from './walletReviewEvidence';
import type { AnalysisFinding } from '../Analysis/finding';
import {
  listWalletTransactions,
  verifiedWalletAddresses,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from './walletRecords';
import { listTagsForNode } from '../Annotations/tagMembership';
import { outpointReference, transactionReference } from '../entityReferences';
import { counterpartyReference } from '../annotationReferences';
import {
  createCounterpartyLookup,
  listCounterpartiesForRelationship,
  type CounterpartyLookup,
} from '../Counterparties/counterparties';
import {
  type Wallet,
  type WalletAddress,
  type WalletReviewRecord,
  MAX_WALLET_REVIEWS,
} from './wallets';
import type { Workspace } from '../workspace';
import { addressToScriptHash } from '../../Bitcoin';
import { reconcileWalletUtxos } from './WalletUtxos/walletUtxoObservation';
import {
  canonicalTransactionId,
  groupWalletRelationships,
  loadedWalletTransactions,
  validOutputIndex,
  type WalletAddressRelationships,
  type WalletRelationship,
  type WalletRelationshipContext,
} from './walletRelationships';
import { indexPreviousOutputs, type PreviousOutputIndex, type Transaction } from '../../ChainData';

/** Reasons are factual presentation roles; annotation requirements are separate goals. */
export const REVIEW_REASONS = [
  'current-utxo',
  'wallet-address',
  'source-address',
  'destination-address',
  'source',
  'funding-source',
  'wallet-transaction',
  'counterparty',
  'link',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];
export type ReviewStatus = WalletReviewRecord['status'];
export type ReviewDecision = WalletReviewRecord;
export type WalletAnnotationGoal = 'activity-context' | 'coin-context' | 'counterparty-context';
export const REVIEW_SCOPES = [
  'utxos',
  'transactions',
  'addresses',
  'relationships',
  'previous-output-decisions',
] as const;
export type ReviewScope = (typeof REVIEW_SCOPES)[number];

export interface WalletReviewItem {
  key: string;
  kind: 'annotation-goal' | 'finding';
  goal?: WalletAnnotationGoal;
  reason: ReviewReason;
  scope: ReviewScope;
  /** Grouped tasks retain every factual scope; flat projections keep their single scope. */
  scopes?: ReviewScope[];
  title: string;
  detail: string;
  nodeId: string;
  /** Factual records linked to this projection, independent of its edit target. */
  subjectIds: string[];
  nodeIds: string[];
  txid?: string;
  amountSats?: number;
  address?: string;
  label: string;
  tags: string[];
  evidence: string;
  status: ReviewStatus | 'open' | 'resolved';
  /** Derived from human context, never saved as an acknowledgment. */
  satisfied: boolean;
  /** Exact human annotation references supplying context, without copying metadata. */
  contextSubjects: string[];
  decidedAt?: string;
  changed: boolean;
  relationshipKinds?: ('source' | 'destination')[];
  ownership?: WalletRelationship['ownership'];
  transactionIds?: string[];
  walletOutputIds?: string[];
  outpointIds?: string[];
  contexts?: WalletRelationshipContext[];
  /** Only legacy UI fixtures may use this field; prior decisions are not active items. */
  legacyOutputReview?: boolean;
  algorithm?: string;
}

export interface WalletReviewGroup {
  key: string;
  transactionId?: string;
  /** One canonical task per key, even when findings have multiple factual scopes. */
  items: WalletReviewItem[];
  subjectIds: string[];
}

export interface WalletLegacyReviewDecision extends WalletReviewRecord {
  key: string;
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
  utxoLoadedSpenders?: number;
  utxoPartial: boolean;
}

export interface WalletReview {
  items: WalletReviewItem[];
  groups: WalletReviewGroup[];
  /** Original object acknowledgments retained verbatim and never replayed as goals. */
  legacyDecisions: WalletLegacyReviewDecision[];
  coverage: WalletReviewCoverage;
  missingSourceTransactions: number;
}

export function isCompletedReview(decision?: { status: WalletReviewItem['status'] }): boolean {
  return (
    decision?.status === 'reviewed' ||
    decision?.status === 'unknown' ||
    decision?.status === 'resolved' ||
    decision?.status === 'cannot-identify' ||
    decision?.status === 'not-needed'
  );
}

/** Retained for finding keys and reading existing object decision identities. */
export function reviewKey(walletId: string, reason: ReviewReason, subject: string): string {
  return `${walletId}|${reason}|${subject}`;
}

export function walletGoalKey(
  walletId: string,
  goal: WalletAnnotationGoal,
  subject: string,
): string {
  return `${walletId}|goal-v1:${goal}|${stableKey(subject)}`;
}

function fingerprint(value: string): string {
  return stableKey(value).slice(0, 16);
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
function walletOwnedOutputs(
  workspace: Workspace,
  addresses: readonly WalletAddress[],
  prevouts?: PreviousOutputIndex,
  evidence: WalletOutputEvidenceResolver = createWalletOutputEvidenceResolver(workspace.network),
): Map<string, OwnedOutput> {
  const hashes = new Set(addresses.map((address) => address.scripthash));
  const owned = new Map<string, OwnedOutput>();
  if (!hashes.size) return owned;
  for (const [outpoint, resolution] of prevouts ??
    indexPreviousOutputs({
      network: workspace.network,
      transactions: workspace.chainData.transactions,
    })) {
    if (resolution.status !== 'loaded' && resolution.status !== 'attached') continue;
    if (!hashes.has(evidence(resolution.output).scripthash ?? '')) continue;
    const match = /^([0-9a-f]{64}):(\d+)$/.exec(outpoint);
    const vout = match ? Number(match[2]) : undefined;
    if (!match || !validOutputIndex(vout)) continue;
    const nodeId = outpointReference(match[1], vout);
    owned.set(nodeId, {
      nodeId,
      txid: match[1],
      vout,
      valueSats: Math.round(resolution.output.value * 100_000_000),
      address: evidence(resolution.output).address,
    });
  }
  return owned;
}

function annotationOf(workspace: Workspace, nodeId: string) {
  return workspace.annotations.entities[nodeId];
}

function tagNamesFor(workspace: Workspace, nodeId: string, address?: string): string[] {
  return listTagsForNode(workspace, {
    id: nodeId,
    kind: nodeId.startsWith('tx:')
      ? 'transaction'
      : nodeId.startsWith('addr:')
        ? 'address'
        : 'output',
    address,
  }).map((tag) => tag.name);
}

type ReviewSubject = Omit<
  WalletReviewItem,
  'label' | 'tags' | 'status' | 'decidedAt' | 'changed' | 'satisfied'
> & { satisfied?: boolean };

function decorate(workspace: Workspace, item: ReviewSubject): WalletReviewItem {
  const stored = workspace.wallets.reviews?.[item.key];
  const decision =
    item.kind === 'finding'
      ? stored &&
        (stored.status === 'reviewed' || stored.status === 'later' || stored.status === 'unknown')
        ? stored
        : undefined
      : stored?.kind === 'annotation-goal'
        ? stored
        : undefined;
  const satisfied = item.satisfied === true;
  return {
    ...item,
    label: annotationOf(workspace, item.nodeId)?.label ?? '',
    tags: tagNamesFor(workspace, item.nodeId, item.address),
    satisfied,
    status: satisfied ? 'resolved' : (decision?.status ?? 'open'),
    decidedAt: decision?.at,
    changed:
      !satisfied && !!decision && (decision.supportEvidence ?? decision.evidence) !== item.evidence,
  };
}

function humanContext(workspace: Workspace, nodeId: string, address?: string): string[] {
  const annotation = annotationOf(workspace, nodeId);
  return annotation?.label.trim() ||
    annotation?.note.trim() ||
    tagNamesFor(workspace, nodeId, address).length
    ? [nodeId]
    : [];
}

function transactionHumanContext(workspace: Workspace, txid: string): string[] {
  const nodeId = transactionReference(txid);
  const annotation = annotationOf(workspace, nodeId);
  // A transaction tag does not silently label its outputs.
  return annotation?.label.trim() || annotation?.note.trim() ? [nodeId] : [];
}

function counterpartyContext(
  workspace: Workspace,
  txid: string,
  direction: 'received' | 'sent',
  outputIds: string[],
  counterparties: CounterpartyLookup,
  related: WalletRelationship[] = [],
): string[] {
  const subjects = listCounterpartiesForRelationship(
    workspace,
    {
      transactionId: txid,
      direction,
      walletOutputIds: outputIds,
    },
    counterparties,
  ).map((party) => counterpartyReference(party.id));
  // Reusable annotations supply only the exact observed role and its provenance.
  // An identified input address does not identify its co-inputs or allocate its value.
  const references = [
    ...(direction === 'received' ? outputIds : []),
    ...related.flatMap((output) => [
      output.id,
      ...(output.address ? [`addr:${output.address}`] : []),
    ]),
  ];
  for (const reference of new Set(references)) {
    const parties = counterparties.forEntity(reference);
    if (parties.length)
      subjects.push(reference, ...parties.map((party) => counterpartyReference(party.id)));
  }
  return [...new Set(subjects)];
}

function coinContext(
  workspace: Workspace,
  output: OwnedOutput,
  owned: Map<string, OwnedOutput>,
  loaded: Map<string, Transaction>,
  counterparties: CounterpartyLookup,
  receivingRelationships: Map<string, WalletRelationship[]>,
): string[] {
  const receiptContext = (receipt: OwnedOutput): string[] => {
    const directParties = counterparties.forEntity(receipt.nodeId);
    const direct = [
      ...humanContext(workspace, receipt.nodeId, receipt.address),
      ...(directParties.length
        ? [receipt.nodeId, ...directParties.map((party) => counterpartyReference(party.id))]
        : []),
    ];
    // A payment purpose does not describe the origin of its change outputs.
    if (!receivingRelationships.has(receipt.txid)) return direct;
    return [
      ...direct,
      ...transactionHumanContext(workspace, receipt.txid),
      ...counterpartyContext(
        workspace,
        receipt.txid,
        'received',
        [receipt.nodeId],
        counterparties,
        receivingRelationships.get(receipt.txid),
      ),
    ];
  };
  const context = receiptContext(output);
  // Exact one-hop wallet receipt links provide context, never input-to-output value allocation.
  for (const input of loaded.get(output.txid)?.vin ?? []) {
    const txid = canonicalTransactionId(input.txid);
    if (input.coinbase !== undefined || !txid || !validOutputIndex(input.vout)) continue;
    const receipt = owned.get(outpointReference(txid, input.vout));
    if (receipt) context.push(...receiptContext(receipt));
  }
  return [...new Set(context)];
}

function transactionEvidence(
  transaction: Transaction | undefined,
  prevouts: PreviousOutputIndex,
  inspect: WalletOutputEvidenceResolver,
): unknown {
  if (!transaction) return 'unloaded';
  return {
    inputs: transaction.vin.map((input) => {
      if (input.coinbase !== undefined) return ['coinbase', input.coinbase];
      const txid = canonicalTransactionId(input.txid);
      if (!txid || !validOutputIndex(input.vout)) return ['unknown-input'];
      const previous = prevouts.get(`${txid}:${input.vout}`);
      return previous?.status === 'loaded' || previous?.status === 'attached'
        ? [txid, input.vout, previous.output.value, inspect(previous.output).scripthash]
        : [txid, input.vout, 'missing'];
    }),
    outputs: transaction.vout.map((output) => [
      output.n,
      output.value,
      inspect(output).scripthash,
      inspect(output).scripthash ? undefined : output.scriptPubKey?.hex,
    ]),
  };
}

function buildGroups(
  items: WalletReviewItem[],
  transactionOrder: Map<string, number>,
): WalletReviewGroup[] {
  const canonical = new Map<string, WalletReviewItem>();
  for (const item of items) {
    const previous = canonical.get(item.key);
    if (previous)
      canonical.set(item.key, {
        ...previous,
        scopes: [...new Set([...(previous.scopes ?? [previous.scope]), item.scope])],
        subjectIds: [...new Set([...previous.subjectIds, ...item.subjectIds])],
        nodeIds: [...new Set([...previous.nodeIds, ...item.nodeIds])],
      });
    else canonical.set(item.key, { ...item, scopes: [item.scope] });
  }
  const groups = new Map<string, WalletReviewGroup>();
  for (const item of canonical.values()) {
    const transactionId = [...(item.transactionIds ?? (item.txid ? [item.txid] : []))].sort(
      (a, b) =>
        (transactionOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (transactionOrder.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
    )[0];
    const key = transactionId ? transactionReference(transactionId) : `task:${item.key}`;
    const group = groups.get(key) ?? { key, transactionId, items: [], subjectIds: [] };
    group.items.push(item);
    group.subjectIds = [...new Set([...group.subjectIds, ...item.subjectIds])];
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      (transactionOrder.get(a.transactionId ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (transactionOrder.get(b.transactionId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      a.key.localeCompare(b.key),
  );
}

/** Derive annotation goals and explicit finding assessments from one accepted snapshot. */
export function buildWalletReview(
  workspace: Workspace,
  wallet: Wallet,
  options: {
    utxos?: WalletUtxoRecord[];
    utxoCheckedAt?: string;
    utxoCheckedAddresses?: number;
    utxoTotalAddresses?: number;
    utxoPartial?: boolean;
    relationships?: WalletAddressRelationships;
    prevouts?: PreviousOutputIndex;
    evidence?: WalletOutputEvidenceResolver;
    transactionRecords?: ReturnType<typeof listWalletTransactions>;
    addressRecords?: readonly WalletAddress[];
    findingEvidence?: (finding: AnalysisFinding) => string;
  } = {},
): WalletReview {
  const addresses = options.addressRecords ?? verifiedWalletAddresses(wallet, workspace.network);
  const prevouts =
    options.prevouts ??
    indexPreviousOutputs({
      network: workspace.network,
      transactions: workspace.chainData.transactions,
    });
  const inspect = options.evidence ?? createWalletOutputEvidenceResolver(workspace.network);
  const owned = walletOwnedOutputs(workspace, addresses, prevouts, inspect);
  const loaded = loadedWalletTransactions(workspace);
  const relationships =
    options.relationships ?? groupWalletRelationships(workspace, wallet, prevouts, inspect);
  const counterparties = createCounterpartyLookup(workspace);
  const outputsByTransaction = new Map<string, string[]>();
  for (const output of owned.values()) {
    const ids = outputsByTransaction.get(output.txid) ?? [];
    ids.push(output.nodeId);
    outputsByTransaction.set(output.txid, ids);
  }
  const spentByTransaction = new Map<string, string[]>();
  for (const transaction of loaded.values()) {
    const ids = transaction.vin.flatMap((input) => {
      const txid = canonicalTransactionId(input.txid);
      if (input.coinbase !== undefined || !txid || !validOutputIndex(input.vout)) return [];
      const id = outpointReference(txid, input.vout);
      return owned.has(id) ? [id] : [];
    });
    if (ids.length) spentByTransaction.set(transaction.txid, [...new Set(ids)]);
  }
  const relatedByTransaction = {
    received: new Map<string, WalletRelationship[]>(),
    sent: new Map<string, WalletRelationship[]>(),
  };
  for (const direction of ['received', 'sent'] as const) {
    const outputs =
      direction === 'received'
        ? [
            ...relationships.sources.flatMap((group) => group.outpoints),
            ...relationships.sourceExceptions,
          ]
        : [
            ...relationships.destinations.flatMap((group) => group.outpoints),
            ...relationships.destinationExceptions,
          ];
    for (const output of outputs) {
      if (output.ownership === 'wallet') continue;
      for (const context of output.contexts) {
        const entries = relatedByTransaction[direction].get(context.transactionId) ?? [];
        if (!entries.some((entry) => entry.id === output.id)) entries.push(output);
        relatedByTransaction[direction].set(context.transactionId, entries);
      }
    }
  }
  const records = options.transactionRecords ?? listWalletTransactions(workspace, wallet);
  const receivingRelationships = new Map(
    records
      .filter((record) => record.direction === 'received')
      .map((record) => [record.txid, relatedByTransaction.received.get(record.txid) ?? []]),
  );
  const transactionOrder = new Map(records.map((record, index) => [record.txid, index]));
  const history = new Set(records.map((record) => record.txid));
  const walletHashes = new Set(addresses.map((address) => address.scripthash));
  const verifiedRecords = (options.utxos ?? [])
    .map((record) => ({ ...record, txid: canonicalTransactionId(record.txid) ?? record.txid }))
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
        return !transaction || verifyWalletUtxo(record, transaction, workspace.network);
      } catch {
        return false;
      }
    });
  const reconciled = reconcileWalletUtxos(verifiedRecords, loaded, workspace.network);
  const currentUtxos = reconciled.current;
  const subjects: ReviewSubject[] = [];
  const pushGoal = (
    subject: Omit<ReviewSubject, 'key' | 'kind' | 'satisfied'> & { goal: WalletAnnotationGoal },
    identity: string,
  ) =>
    subjects.push({
      ...subject,
      key: walletGoalKey(wallet.id, subject.goal, identity),
      kind: 'annotation-goal',
      satisfied: subject.contextSubjects.length > 0,
    });

  for (const record of records) {
    const nodeId = transactionReference(record.txid);
    const contexts = humanContext(workspace, nodeId);
    pushGoal(
      {
        goal: 'activity-context',
        reason: 'wallet-transaction',
        scope: 'transactions',
        nodeId,
        nodeIds: [nodeId],
        subjectIds: [nodeId],
        txid: record.txid,
        transactionIds: [record.txid],
        title: `Describe transaction ${short(record.txid)}`,
        detail: 'Add a label, note or tag describing this transaction.',
        evidence: fingerprint(
          JSON.stringify([
            'activity-context',
            record.txid,
            transactionEvidence(record.transaction, prevouts, inspect),
          ]),
        ),
        contextSubjects: [...new Set(contexts)],
      },
      nodeId,
    );
  }

  let missingSourceTransactions = 0;
  for (const record of currentUtxos) {
    const nodeId = outpointReference(record.txid, record.vout);
    const output = owned.get(nodeId) ?? {
      nodeId,
      txid: record.txid,
      vout: record.vout,
      valueSats: record.valueSats,
      address: record.address,
    };
    if (!loaded.has(record.txid)) missingSourceTransactions++;
    pushGoal(
      {
        goal: 'coin-context',
        reason: 'current-utxo',
        scope: 'utxos',
        nodeId,
        nodeIds: [nodeId],
        subjectIds: [nodeId],
        txid: record.txid,
        transactionIds: [record.txid],
        address: record.address,
        amountSats: record.valueSats,
        ownership: 'wallet',
        title: `Describe coin ${short(record.txid)}:${record.vout}`,
        detail: 'Where this coin came from or what it is for.',
        evidence: fingerprint(
          JSON.stringify([
            'coin-context',
            nodeId,
            record.valueSats,
            transactionEvidence(loaded.get(record.txid), prevouts, inspect),
          ]),
        ),
        contextSubjects: coinContext(
          workspace,
          output,
          owned,
          loaded,
          counterparties,
          receivingRelationships,
        ),
      },
      nodeId,
    );
  }

  // The question concerns a wallet receipt/payment, not the identity of every co-input.
  for (const record of records) {
    const transaction = loaded.get(record.txid);
    if (!transaction || record.direction === 'transfer') continue;
    const receiptIds = outputsByTransaction.get(record.txid) ?? [];
    const spentIds = spentByTransaction.get(record.txid) ?? [];
    const direction =
      record.direction === 'received'
        ? 'received'
        : record.direction === 'sent' || spentIds.length
          ? 'sent'
          : 'received';
    const walletOutputIds = direction === 'received' ? receiptIds : spentIds;
    if (!walletOutputIds.length) continue;
    if (direction === 'received' && transaction.vin.every((input) => input.coinbase !== undefined))
      continue;
    const related = relatedByTransaction[direction].get(record.txid) ?? [];
    const contextSubjects = counterpartyContext(
      workspace,
      record.txid,
      direction,
      walletOutputIds,
      counterparties,
      related,
    );
    const nodeId = transactionReference(record.txid);
    pushGoal(
      {
        goal: 'counterparty-context',
        reason: direction === 'received' ? 'source-address' : 'destination-address',
        scope: 'relationships',
        nodeId,
        nodeIds: [nodeId],
        subjectIds: [
          ...new Set([
            nodeId,
            ...walletOutputIds,
            ...related.map((output) => (output.address ? `addr:${output.address}` : output.id)),
          ]),
        ],
        txid: record.txid,
        transactionIds: [record.txid],
        relationshipKinds: [direction === 'received' ? 'source' : 'destination'],
        walletOutputIds,
        outpointIds: related.map((output) => output.id),
        contexts: [{ transactionId: record.txid, walletOutputIds }],
        title: direction === 'received' ? 'Who sent this?' : 'Who received this?',
        detail: `${record.direction === 'unknown' ? 'The wallet-relative direction is incomplete; this goal concerns only verified receipt or spending anchors. ' : ''}Assign a counterparty to the wallet relationship, or deliberately record that you cannot identify it or need no annotation. An association does not identify every input or output address.`,
        evidence: fingerprint(
          JSON.stringify([
            'counterparty-context',
            direction,
            record.txid,
            walletOutputIds,
            related.map((output) => [
              output.id,
              output.amountSats,
              output.missing,
              output.address,
              output.ownership,
            ]),
          ]),
        ),
        contextSubjects,
      },
      `${direction}|${record.txid}`,
    );
  }

  const walletAddressIds = new Set(addresses.map((entry) => `addr:${entry.address}`));
  const relationshipGroups = [...relationships.sources, ...relationships.destinations].filter(
    (group) => group.ownership === 'external',
  );
  for (const finding of workspace.analysis.findings) {
    if (finding.excluded || finding.stale || !finding.subjects?.length) continue;
    const subjectsByScope = new Map<ReviewScope, Set<string>>();
    const addSubject = (scope: ReviewScope, subject: string) => {
      const entries = subjectsByScope.get(scope) ?? new Set<string>();
      entries.add(subject);
      subjectsByScope.set(scope, entries);
    };
    for (const subject of finding.subjects) {
      if (owned.has(subject)) addSubject('utxos', subject);
      if (subject.startsWith('tx:') && history.has(subject.slice(3)))
        addSubject('transactions', subject);
      if (walletAddressIds.has(subject)) addSubject('addresses', subject);
      for (const group of relationshipGroups)
        if (group.id === subject || group.outpointIds.includes(subject))
          addSubject('relationships', group.id);
    }
    if (!subjectsByScope.size) continue;
    const key = reviewKey(wallet.id, 'link', finding.id);
    const findingEvidence = options.findingEvidence
      ? options.findingEvidence(finding)
      : walletFindingEvidence(workspace, finding, prevouts);
    for (const [scope, projectedSubjects] of subjectsByScope) {
      const subjectIds = [...projectedSubjects].sort();
      const nodeId = subjectIds[0];
      subjects.push({
        key,
        kind: 'finding',
        reason: 'link',
        scope,
        subjectIds,
        title: finding.title,
        detail: finding.description,
        nodeId,
        nodeIds: finding.nodeIds,
        address: nodeId.startsWith('addr:') ? nodeId.slice(5) : owned.get(nodeId)?.address,
        transactionIds: finding.txids,
        txid: finding.txids[0],
        algorithm: finding.algorithm,
        evidence: findingEvidence,
        contextSubjects: [],
      });
    }
  }
  const items = subjects.map((subject) => decorate(workspace, subject));
  const activeKeys = new Set(items.map((item) => item.key));
  const legacyDecisions = Object.entries(workspace.wallets.reviews ?? {})
    .filter(
      ([key, record]) => key.startsWith(`${wallet.id}|`) && !record.kind && !activeKeys.has(key),
    )
    .map(([key, record]) => ({ key, ...record }))
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  return {
    items,
    groups: buildGroups(items, transactionOrder),
    legacyDecisions,
    missingSourceTransactions,
    coverage: {
      scannedAt: wallet.scannedAt,
      scanComplete: wallet.scanComplete === true,
      discoveredAddresses: addresses.length,
      usedAddresses: addresses.filter((address) => address.history?.length).length,
      knownTransactions: history.size,
      loadedTransactions: records.filter((record) => !!record.transaction).length,
      pendingTransactions: wallet.pendingTransactionIds?.length ?? 0,
      utxoCheckedAt: options.utxoCheckedAt,
      utxoCheckedAddresses: options.utxoCheckedAddresses,
      utxoTotalAddresses: options.utxoTotalAddresses,
      utxoCount: options.utxos ? currentUtxos.length : undefined,
      utxoLoadedSpenders: reconciled.withLoadedSpender.length,
      utxoBalanceSats: options.utxos
        ? currentUtxos.reduce((total, record) => total + record.valueSats, 0)
        : undefined,
      utxoPartial:
        options.utxoPartial === true ||
        (options.utxos !== undefined &&
          options.utxoTotalAddresses !== undefined &&
          (options.utxoCheckedAddresses ?? 0) < options.utxoTotalAddresses),
    },
  };
}

function withReviews(reviews: Record<string, WalletReviewRecord>): Workspace['wallets']['reviews'] {
  if (Object.keys(reviews).length <= MAX_WALLET_REVIEWS)
    return Object.keys(reviews).length ? reviews : undefined;
  throw new Error(
    `A workspace holds at most ${MAX_WALLET_REVIEWS.toLocaleString('en-US')} review decisions. Reopen an existing review before adding another.`,
  );
}

/** One undoable intention. Goal satisfaction is derived; only deliberate dispositions are saved. */
export function applyReviewDecisions(
  workspace: Workspace,
  wallet: Wallet,
  items: readonly WalletReviewItem[],
  status: ReviewStatus | 'reopen',
  now = new Date().toISOString(),
): Workspace {
  const uniqueItems = [...new Map(items.map((item) => [item.key, item])).values()];
  if (!uniqueItems.length) return workspace;
  if (uniqueItems.some((item) => !item.key.startsWith(`${wallet.id}|`)))
    throw new Error('A wallet review decision cannot change another wallet.');
  if (
    status !== 'reopen' &&
    uniqueItems.some((item) =>
      item.kind === 'annotation-goal'
        ? !['cannot-identify', 'not-needed', 'later'].includes(status)
        : !['reviewed', 'later'].includes(status),
    )
  )
    throw new Error(
      'Choose an annotation disposition or a finding assessment for the selected task.',
    );
  const reviews = { ...workspace.wallets.reviews };
  let changed = false;
  for (const item of uniqueItems) {
    if (status === 'reopen') {
      if (reviews[item.key] !== undefined) {
        delete reviews[item.key];
        changed = true;
      }
      continue;
    }
    const previous = reviews[item.key];
    if (
      previous?.status === status &&
      previous.evidence === item.evidence &&
      previous.kind === item.kind
    )
      continue;
    reviews[item.key] = { kind: item.kind, status, at: now, evidence: item.evidence };
    changed = true;
  }
  return changed
    ? { ...workspace, wallets: { ...workspace.wallets, reviews: withReviews(reviews) } }
    : workspace;
}

export function pruneWalletReviews(workspace: Workspace): Workspace {
  if (!workspace.wallets.reviews) return workspace;
  const ids = new Set(workspace.wallets.definitions.map((wallet) => wallet.id));
  const kept = Object.entries(workspace.wallets.reviews).filter(([key]) =>
    ids.has(key.slice(0, key.indexOf('|'))),
  );
  return kept.length === Object.keys(workspace.wallets.reviews).length
    ? workspace
    : {
        ...workspace,
        wallets: {
          ...workspace.wallets,
          reviews: kept.length ? Object.fromEntries(kept) : undefined,
        },
      };
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
    const label = workspace.annotations.entities[id]?.label?.trim();
    const tags = (workspace.annotations.tags ?? [])
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
