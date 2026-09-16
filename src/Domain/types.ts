import type { GraphSnapshot } from './Graph/graphSnapshot';
import type { ScanDirection, ScanRoute } from './ConnectionScan/connectionScanPaths';
export type Network = 'mainnet' | 'testnet4';
export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';
export interface TxOutputDetails {
  value: number;
  scriptPubKey: {
    hex?: string;
    address?: string;
    addresses?: string[];
    type?: string;
  };
}
export interface TxInput {
  txid?: string;
  vout?: number;
  coinbase?: string;
  sequence?: number;
  /** Historical output content observed with this spend, not current UTXO status. */
  prevout?: TxOutputDetails;
}
export interface TxOutput extends TxOutputDetails {
  n: number;
}
export interface Transaction {
  txid: string;
  vin: TxInput[];
  vout: TxOutput[];
  confirmations?: number;
  /** Actual containing-block height observed from Core or Electrum history. */
  blockHeight?: number;
  /** Present only when an upstream observed the transaction in its mempool. */
  mempool?: boolean;
  blocktime?: number;
  time?: number;
  size?: number;
  vsize?: number;
  blockhash?: string;
}
export interface WalletAddress {
  address: string;
  scripthash: string;
  path: string;
  index: number;
  branch: 0 | 1;
  history?: { tx_hash: string; height: number }[];
}
export interface AddressHistoryObservation {
  history: { tx_hash: string; height: number }[];
  /** Transaction details were capped while the complete history was observed. */
  truncated: boolean;
  scannedAt?: string;
}
export interface AddressBalanceObservation {
  network: Network;
  confirmedSats: number;
  unconfirmedSats: number;
  checkedAt: string;
}
export interface AddressUtxoRecord {
  txid: string;
  vout: number;
  valueSats: number;
  height: number;
}
export interface AddressUtxoObservation {
  network: Network;
  utxos: AddressUtxoRecord[];
  checkedAt: string;
}
export interface Wallet {
  id: string;
  name: string;
  key: string;
  scriptType: ScriptType;
  color: string;
  addresses: WalletAddress[];
  scannedAt?: string;
  scanComplete?: boolean;
  scanLimit?: number;
  scanGap?: number;
  pendingTransactionIds?: string[];
  unreviewedTransactionIds?: string[];
  activityOverflow?: boolean;
  lastActivity?: {
    newTransactionIds: string[];
    refreshedTransactionCount: number;
    missingTransactionCount: number;
  };
}
export interface Annotation {
  label: string;
  note: string;
  icon: string;
  bookmarked: boolean;
}
/** A manual grouping, independent of labels and heuristic findings. */
export interface WorkspaceTag {
  id: string;
  name: string;
  color: string;
  description?: string;
  nodeIds: string[];
}
/** Review ordering rule recorded on a finding, never a confidence or ownership claim. */
export type ReviewRule = 'fee-threshold' | 'repeated-address' | 'distinct-wallet-inputs';
export interface AnalysisFinding {
  id: string;
  algorithm: string;
  title: string;
  description: string;
  details?: string;
  guidance?: { kind: 'tip' | 'privacy' | 'next-step'; text: string };
  nodeIds: string[];
  txids: string[];
  createdAt: string;
  excluded?: boolean;
  kind?: 'observation' | 'hypothesis' | 'incomplete';
  scopeTxids?: string[];
  stale?: boolean;
  reviewRule?: ReviewRule;
}
interface StoredTransactionFlowState {
  transactionId?: string;
  expandedInputs?: boolean;
  expandedOutputs?: boolean;
  height?: 'collapsed' | 'expanded' | 'full';
}
interface StoredGraphPanelsState {
  left?: { tab?: 'wallets' | 'entities' | 'bookmarks' | 'tags'; collapsed?: boolean };
  right?: {
    tab?: 'scan' | 'inspect' | 'addresses' | 'transactions' | 'utxos';
    collapsed?: boolean;
  };
  flow?: StoredTransactionFlowState;
  mobile?: 'graph' | 'left' | 'right';
}
export interface Workspace {
  /** Decrypted data schema version, independent of the encrypted envelope format. */
  version: 4;
  id: string;
  name: string;
  description?: string;
  network: Network;
  createdAt: string;
  wallets: Wallet[];
  transactions: Record<string, Transaction>;
  /** Automatically fetched input parents show only these outputs until explicitly opened. */
  inputContext?: Record<string, number[]>;
  /** Automatically fetched ancestry, retained after expanding its graph presentation. */
  contextTransactionIds?: string[];
  annotations: Record<string, Annotation>;
  tags?: WorkspaceTag[];
  /** Wallet review decisions keyed by `walletId|reason|subject`. */
  walletReviews?: Record<
    string,
    { status: 'reviewed' | 'unknown' | 'later'; at: string; evidence: string }
  >;
  /** Compact scan records and retained path evidence, encrypted with this workspace. */
  connectionScans?: ConnectionScanRecords;
  findings: AnalysisFinding[];
  watchedAddresses: string[];
  /** Bounded Electrum history observations for directly watched addresses. */
  addressHistories?: Record<string, AddressHistoryObservation>;
  /** Bounded current balance observations for directly inspected addresses. */
  addressBalances?: Record<string, AddressBalanceObservation>;
  /** Bounded current UTXO observations for directly inspected addresses. */
  addressUtxos?: Record<string, AddressUtxoObservation>;
  demo: boolean;
  view: {
    dimensions: 2 | 3;
    sizeBy: 'uniform' | 'value' | 'degree';
    glow: boolean;
    showAddresses: boolean;
    /** Explicit canvas membership, separate from complete loaded Bitcoin observations. */
    graphNodeIds?: string[];
    /** Manual canvas visibility, independent of filters and cached Bitcoin observations. */
    hiddenNodeIds?: string[];
    entityVisibility?: 'visible' | 'hidden' | 'all' | 'graph';
    /** Independent canvas and transaction-flow amount preferences. */
    smallAmountThreshold?: number;
    flowAmountThreshold?: number;
    showLabels?: boolean;
    showTags?: boolean;
    showIcons?: boolean;
    lockToSelection?: boolean;
    highlightMode?: 'all' | 'wallets' | 'tags' | 'none';
    graphSnapshot?: GraphSnapshot;
    selectionId?: string;
    filters?: GraphFilters;
    workbench?: 'graph' | 'analysis' | 'trace' | 'wallet';
    panels?: StoredGraphPanelsState;
    prefetchDepth?: 0 | 1 | 2;
    selectedWallet?: string;
  };
}
export interface GraphFilters {
  tagId?: string;
  /** Any tag membership, independent of one chosen tag. */
  tagState?: 'all' | 'tagged' | 'untagged';
  /** Legacy single-wallet selection, retained for saved workspaces. */
  walletId?: string;
  /** Match any selected wallet; an empty list leaves wallet membership unrestricted. */
  walletIds?: string[];
  /** Derived wallet-address membership, never an ownership claim. */
  walletMatch?: 'all' | 'matched' | 'unmatched';
  query?: string;
  kind?: 'all' | GraphNode['kind'];
  label?: 'all' | 'labeled' | 'unlabeled';
  bookmarkedOnly?: boolean;
  minSats?: number;
  maxSats?: number;
  spend?: 'all' | 'observed' | 'unknown';
  funding?: 'all' | 'missing' | 'loaded';
  showAddresses?: boolean;
  focus?: { id: string; hops: 1 | 2 };
  preserveContext?: boolean;
  includeIds?: string[];
  /** Resolved membership exclusions; callers supply explicit identifiers only. */
  excludeIds?: string[];
}

export interface GraphNode {
  id: string;
  kind: 'transaction' | 'output' | 'address';
  label: string;
  value?: number;
  address?: string;
  txid?: string;
  vout?: number;
  cluster?: string;
  x?: number;
  y?: number;
  z?: number;
}
export interface GraphLink {
  id: string;
  source: string;
  target: string;
  kind: 'creates' | 'spends' | 'address';
}
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
export const txNodeId = (txid: string) => `tx:${txid}`;
export const outputNodeId = (txid: string, vout: number) => `out:${txid}:${vout}`;
export const addressNodeId = (address: string) => `addr:${address}`;
/** Display references consistently; canonical IDs and clipboard values stay complete.
 * Outpoint indices are separate from the transaction hash and never truncated. */
export const short = (value: string) => {
  const reference = value.replace(/^(?:tx|out|addr):/, '');
  const outpoint = /^([0-9a-f]{64}):(\d+)$/i.exec(reference);
  const identifier = outpoint?.[1] ?? reference;
  const abbreviated =
    identifier.length > 19 ? `${identifier.slice(0, 8)}...${identifier.slice(-8)}` : identifier;
  return `${abbreviated}${outpoint ? `:${outpoint[2]}` : ''}`;
};
export const sats = (btc: number) => Math.round(btc * 100_000_000);

/**
 * Retained connection scans, as they are stored in a workspace.
 *
 * These are persisted shapes, so they live here with the rest of the saved
 * contract rather than in the module that happens to produce them.
 */
export type ScanStopReason =
  | 'depth'
  | 'fan-out'
  | 'time'
  | 'transactions'
  | 'unknown'
  | 'failure'
  | 'results'
  | 'cancelled'
  | 'backend-unavailable'
  | 'rate-limited'
  | 'offline';
export type ScanFinding =
  | 'many-inputs'
  | 'many-outputs'
  | 'unspent'
  | 'coinbase'
  | 'unspendable'
  | 'transaction-unavailable'
  | 'spend-unknown'
  | 'lookup-failed'
  | 'conflicting-evidence';
/** These describe the run, never a transaction or outpoint finding. */
export interface ScanSettings {
  direction: ScanDirection | 'both';
  targetScope: 'neighbours' | 'visible' | 'added' | 'custom';
  maxHops: number;
  maxTransactions: number;
  maxMilliseconds: number;
  fanOut: number;
}
export interface ScanResult {
  id: string;
  kind: 'connection' | 'boundary' | 'endpoint';
  relationship?: 'direct' | 'shared-ancestor' | 'shared-descendant';
  /** A bounded existing source-to-target route that explains the reconnection. */
  context?: ScanRoute;
  /** Connection between frozen targets in disconnected loaded components. */
  bridge?: true;
  endpoint: string;
  path: string[];
  /** Direction followed on each observed edge, in path order from the source. */
  directions: ScanDirection[];
  hops: number;
  reason?: ScanStopReason;
  dismissed?: boolean;
  finding?: ScanFinding;
  scanDirection?: ScanDirection;
  branchCount?: number;
  checkedAt?: string;
  bestBlock?: string;
  includesMempool?: boolean;
  issueCode?: 'timeout' | 'invalid-response' | 'lookup-failed';
  meetingNode?: string;
}
export type ScanObservation = Pick<
  ScanResult,
  'finding' | 'branchCount' | 'checkedAt' | 'bestBlock' | 'includesMempool' | 'issueCode'
> & { finding: ScanFinding };
export interface ScanRun {
  id: string;
  source: string;
  targetIds: string[];
  settings: ScanSettings;
  startedAt: string;
  status: 'running' | 'complete' | 'cancelled' | 'interrupted' | 'failed';
  examined: number;
  /** Deepest transaction-hop distance reached from a source or target root. */
  deepestHop?: number;
  stopReasons: ScanStopReason[];
  results: ScanResult[];
  omittedResults?: { endpoints: number; issues: number };
}
export interface ConnectionScanRecords {
  /** Bounded results from retained scans, ordered by when each scan started. */
  runs: ScanRun[];
  evidence: Record<string, Transaction>;
}
