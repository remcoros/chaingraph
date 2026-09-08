import type { GraphSnapshot } from './graphSnapshot';
import type { GraphFilters } from './graphFilters';
export type Network = 'mainnet' | 'testnet4';
export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';
export interface TxInput {
  txid?: string;
  vout?: number;
  coinbase?: string;
  sequence?: number;
}
export interface TxOutput {
  n: number;
  value: number;
  scriptPubKey: {
    hex?: string;
    address?: string;
    addresses?: string[];
    type?: string;
  };
}
export interface Transaction {
  txid: string;
  vin: TxInput[];
  vout: TxOutput[];
  confirmations?: number;
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
export interface AnalysisFinding {
  id: string;
  algorithm: string;
  title: string;
  description: string;
  nodeIds: string[];
  txids: string[];
  createdAt: string;
  excluded?: boolean;
  kind?: 'observation' | 'hypothesis' | 'incomplete';
  scopeTxids?: string[];
  stale?: boolean;
}
export interface TransactionFlowState {
  transactionId?: string;
  expandedInputs?: boolean;
  expandedOutputs?: boolean;
  open?: boolean;
}
export interface Workspace {
  version: 1;
  id: string;
  name: string;
  description?: string;
  network: Network;
  createdAt: string;
  wallets: Wallet[];
  transactions: Record<string, Transaction>;
  /** Automatically fetched input parents show only these outputs until explicitly opened. */
  inputContext?: Record<string, number[]>;
  annotations: Record<string, Annotation>;
  tags?: WorkspaceTag[];
  findings: AnalysisFinding[];
  watchedAddresses: string[];
  demo: boolean;
  view: {
    dimensions: 2 | 3;
    sizeBy: 'uniform' | 'value' | 'degree';
    glow: boolean;
    showAddresses: boolean;
    showLabels?: boolean;
    showTags?: boolean;
    showIcons?: boolean;
    lockToSelection?: boolean;
    highlightMode?: 'all' | 'wallets' | 'tags' | 'none';
    graphSnapshot?: GraphSnapshot;
    selectionId?: string;
    filters?: GraphFilters;
    leftTab?: 'wallets' | 'entities' | 'bookmarks' | 'tags';
    rightTab?: 'inspect' | 'analysis';
    focusGraph?: boolean;
    prefetchDepth?: 0 | 1 | 2;
    selectedWallet?: string;
    mobilePanel?: 'graph' | 'left' | 'right';
    transactionFlow?: TransactionFlowState;
  };
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
export const short = (s: string, n = 8) =>
  s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
export const sats = (btc: number) => Math.round(btc * 100_000_000);
export const formatSats = (value?: number) =>
  value === undefined ? 'Unknown value' : `${value.toLocaleString()} sats`;
