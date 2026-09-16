import type { Network } from '../../Domain/Chain/network';
import type {
  AddressBalanceObservation,
  AddressHistoryObservation,
  AddressUtxoObservation,
} from '../../Domain/Chain/observations';
import type { Transaction } from '../../Domain/Chain/transaction';
import type { Wallet } from '../../Domain/Wallet/walletTypes';
import type { AnalysisFinding } from './Analysis/analysisFinding';
import type { Annotation } from './Annotations/annotation';
import type { WorkspaceTag } from './Annotations/workspaceTags';
import type { ConnectionScanRecords } from './ConnectionScan/types';
import type { GraphFilters } from './GraphState/filters';
import type { GraphPanelsState } from './GraphState/panelState';
import type { GraphSnapshot } from './GraphState/graphSnapshot';
import type { WalletReviewRecords } from './Wallet/walletReviewRecords';

/** Decrypted workspace schema version, independent of the encrypted envelope version. */
export const CURRENT_WORKSPACE_VERSION = 4 as const;

export interface Workspace {
  /** Decrypted data schema version, independent of the encrypted envelope format. */
  version: typeof CURRENT_WORKSPACE_VERSION;
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
  walletReviews?: WalletReviewRecords;
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
    filters?: GraphFilters;
    workbench?: 'graph' | 'analysis' | 'trace' | 'wallet';
    panels?: GraphPanelsState;
    prefetchDepth?: 0 | 1 | 2;
    selectedWallet?: string;
  };
}
