import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../Core/Workspace/workspace';

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
  /** Disposable presentation using real loaded rows, with all background work inactive. */
  tourPreview?: { tab: 'review' | 'sources'; example?: Workspace };
  workspace: Workspace;
  wallet?: Wallet;
  canLoadChainData: boolean;
  busy: boolean;
  chainDataDisabledReason?: string;
  updateEvidence: (id: string, update: (current: Workspace) => Workspace, undo?: boolean) => void;
  onSelectWallet: (id: string) => void;
  onAddWallet: () => void;
  onEditWallet?: (id: string) => void;
  onChange: (update: (workspace: Workspace) => Workspace, group?: string) => void;
  onRefresh: () => void;
  onShowInGraph: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onIsolateInGraph: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onShowSelection: (ids: string[], isolate: boolean) => void;
  onInspect: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onAnalyze: (nodeId?: string) => void;
}
