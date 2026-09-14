import { useState } from 'react';
import type { Wallet } from '../../Domain/types';
import type { AppState } from '../useAppState';

/** Which workspace dialog is open, and the target a wallet rename applies to. */
export interface WorkspaceDialogState {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  addWalletOpen: boolean;
  openAddWallet: () => void;
  closeAddWallet: () => void;
  /** Rename target, kept with its workspace so a stale one cannot apply elsewhere. */
  renameTarget: { workspaceId: string; walletId: string } | undefined;
  /** The wallet being renamed, resolved against the loaded workspace. */
  editingWallet: Wallet | undefined;
  openWalletRename: (workspaceId: string, walletId: string) => void;
  closeWalletRename: () => void;
  /** Closes everything that should not survive a workspace switch or lock. */
  closeAll: () => void;
}

export function useDialogState(w: AppState['activeWorkspace']): WorkspaceDialogState {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addWalletOpen, setAddWalletOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: string; walletId: string }>();
  const editingWallet =
    w?.id === renameTarget?.workspaceId
      ? w?.wallets.find((item) => item.id === renameTarget?.walletId)
      : undefined;
  return {
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    addWalletOpen,
    openAddWallet: () => setAddWalletOpen(true),
    closeAddWallet: () => setAddWalletOpen(false),
    renameTarget,
    editingWallet,
    openWalletRename: (workspaceId, walletId) => setRenameTarget({ workspaceId, walletId }),
    closeWalletRename: () => setRenameTarget(undefined),
    closeAll: () => {
      setSettingsOpen(false);
      setRenameTarget(undefined);
    },
  };
}
