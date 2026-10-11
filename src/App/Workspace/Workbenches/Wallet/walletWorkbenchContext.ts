import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import type { WalletPresentation } from '../../../../Core/Workspace/view';
import type { WorkspaceOperation } from '../../useWorkspaceOperation';
import type { WalletDiscovery } from './useWalletActivity';

import type { WalletUtxoRecord } from '../../../../Core/Workspace/Wallets/walletRecords';

/**
 * Context every wallet surface shares: the loaded workspace, capability flags
 * and the handoffs back to the other workbenches.
 *
 * Panels declare the slice they read from this contract rather than from the
 * workbench component, so composition stays one-directional.
 */
export interface WalletWorkbenchContext {
  active: boolean;
  operation?: WorkspaceOperation;
  /** Disposable presentation using real loaded rows, with all background work inactive. */
  tourPreview?: {
    tab: 'review' | 'sources' | 'transactions' | 'counterparties';
    example?: Workspace;
  };
  workspace: Workspace;
  wallet?: Wallet;
  canLoadChainData: boolean;
  busy: boolean;
  chainDataDisabledReason?: string;
  updateEvidence: (id: string, update: (current: Workspace) => Workspace, undo?: boolean) => void;
  onSelectWallet: (id: string) => void;
  onAddWallet: () => void;
  onEditWallet?: (id: string) => void;
  onExchangeLabels?: (direction: 'import' | 'export') => void;
  onChange: (update: (workspace: Workspace) => Workspace, group?: string) => void;
  onRefresh: () => void;
  onPresentationChange?: (
    walletId: string,
    update: (current: WalletPresentation) => WalletPresentation,
  ) => void;
  refresh?: WalletDiscovery['refresh'];
  discovery?: Pick<
    WalletDiscovery,
    | 'gapLimit'
    | 'setGapLimit'
    | 'addressesPerBranch'
    | 'setAddressesPerBranch'
    | 'monitorActivity'
    | 'setMonitorActivity'
    | 'refreshIntervalSeconds'
    | 'setRefreshIntervalSeconds'
  >;
  onShowInGraph: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onIsolateInGraph: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onShowSelection: (ids: string[], isolate: boolean) => void;
  onInspect: (nodeId: string, utxo?: WalletUtxoRecord) => void;
}
