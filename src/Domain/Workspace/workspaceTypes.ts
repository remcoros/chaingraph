import type { Network } from '../Chain/network';
import type {
  AddressBalanceObservation,
  AddressHistoryObservation,
  AddressUtxoObservation,
} from '../Chain/observations';
import type { Transaction } from '../Chain/transaction';
import type { Wallet } from '../Wallet/walletTypes';
import type { AnalysisFinding } from './analysisFinding';
import type { Annotation, WorkspaceTag } from './annotationTypes';
import type { ConnectionScanRecords } from './connectionScanTypes';
import type { GraphSnapshot } from './graphSnapshotStorage';

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

interface StoredGraphFilters {
  tagId?: string;
  tagState?: 'all' | 'tagged' | 'untagged';
  walletId?: string;
  walletIds?: string[];
  walletMatch?: 'all' | 'matched' | 'unmatched';
  query?: string;
  kind?: 'all' | 'transaction' | 'output' | 'address';
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
  excludeIds?: string[];
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
    graphNodeIds?: string[];
    hiddenNodeIds?: string[];
    entityVisibility?: 'visible' | 'hidden' | 'all' | 'graph';
    smallAmountThreshold?: number;
    flowAmountThreshold?: number;
    showLabels?: boolean;
    showTags?: boolean;
    showIcons?: boolean;
    lockToSelection?: boolean;
    highlightMode?: 'all' | 'wallets' | 'tags' | 'none';
    graphSnapshot?: GraphSnapshot;
    selectionId?: string;
    filters?: StoredGraphFilters;
    workbench?: 'graph' | 'analysis' | 'trace' | 'wallet';
    panels?: StoredGraphPanelsState;
    prefetchDepth?: 0 | 1 | 2;
    selectedWallet?: string;
  };
}
