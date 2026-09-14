import { CopyButton } from '../../Shared/Controls/CopyButton';
import { Modal, WalletDialog, WalletNameDialog, WorkspaceDetailsDialog } from '../Dialogs';
import type { WorkspaceController } from './useWorkspace';

type Props = { workspace: WorkspaceController };

export function WorkspaceSettingsDialog({ workspace }: Props) {
  const { activeWorkspace } = workspace;
  if (!activeWorkspace || !workspace.dialogs.settingsOpen) return null;
  return (
    <WorkspaceDetailsDialog
      key={activeWorkspace.id}
      workspace={activeWorkspace}
      onClose={() => workspace.dialogs.closeSettings()}
      onSave={(name, description) =>
        workspace.edit(
          (current) =>
            current.name === name && current.description === description
              ? current
              : { ...current, name, description },
          true,
          'workspace-details',
        )
      }
    />
  );
}

export function WorkspaceLabelImport({ workspace }: Props) {
  const { labelsInput, importLabelFile } = workspace.annotations;
  return (
    <input
      ref={labelsInput}
      type="file"
      accept=".jsonl,.json,.txt"
      hidden
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) await importLabelFile(file);
      }}
    />
  );
}

export function EntityRemovalDialog({ workspace }: Props) {
  const { entityRemoval } = workspace;
  const { pending, plan: removalPlan } = entityRemoval;
  if (!pending || !removalPlan) return null;
  return (
    <Modal
      title={removalPlan.kind === 'transaction' ? 'Remove transaction?' : 'Stop watching address?'}
      onClose={() => entityRemoval.cancel()}
    >
      <p>{removalPlan.title}</p>
      <div className="selection-facts">
        <span>{removalPlan.kind === 'transaction' ? 'Transaction ID' : 'Address'}</span>
        <code className="mono wrap" style={{ userSelect: 'all', display: 'block' }}>
          {removalPlan.nodeId.slice(removalPlan.kind === 'transaction' ? 3 : 5)}
        </code>
        <CopyButton
          value={removalPlan.nodeId.slice(removalPlan.kind === 'transaction' ? 3 : 5)}
          label={
            removalPlan.kind === 'transaction'
              ? 'Copy transaction ID to remove'
              : 'Copy address to stop watching'
          }
        />
      </div>
      <p>
        {removalPlan.kind === 'transaction'
          ? 'Remove the cached transaction and its transaction/output annotations and tag memberships from this workspace. Unused input context is removed too; shared, independently added or annotated context is retained. Outputs referenced by retained transactions may remain as placeholders.'
          : 'Stop watching this address and clear its annotation and tag memberships. Loaded transaction data remains in the workspace.'}
      </p>
      <p>
        This removes {removalPlan.annotationCount} annotated{' '}
        {removalPlan.annotationCount === 1 ? 'entity' : 'entities'} and{' '}
        {removalPlan.tagMembershipCount} tag{' '}
        {removalPlan.tagMembershipCount === 1 ? 'membership' : 'memberships'}. Tag definitions
        remain. Undo can restore this change during the current session.
      </p>
      <div className="button-row">
        <button onClick={() => entityRemoval.cancel()}>Keep in workspace</button>
        <button
          className="danger"
          onClick={() => entityRemoval.confirm(pending.workspaceId, pending.nodeId)}
        >
          {removalPlan.kind === 'transaction' ? 'Remove transaction' : 'Stop watching address'}
        </button>
      </div>
    </Modal>
  );
}

export function WalletDialogs({ workspace }: Props) {
  const { activeWorkspace } = workspace;
  const { editingWallet } = workspace.dialogs;
  return (
    <>
      {activeWorkspace && editingWallet && !workspace.lockingWorkspace && (
        <WalletNameDialog
          key={`${activeWorkspace.id}:${editingWallet.id}`}
          wallet={editingWallet}
          onChange={(name) =>
            workspace.edit(
              (current) => {
                const target = current.wallets.find((item) => item.id === editingWallet.id);
                if (
                  current.id !== workspace.dialogs.renameTarget?.workspaceId ||
                  !target ||
                  target.name === name
                )
                  return current;
                return {
                  ...current,
                  wallets: current.wallets.map((item) =>
                    item.id === target.id ? { ...item, name } : item,
                  ),
                };
              },
              true,
              `wallet-name:${editingWallet.id}`,
            )
          }
          onClose={() => workspace.dialogs.closeWalletRename()}
        />
      )}
      {workspace.dialogs.addWalletOpen && activeWorkspace && (
        <WalletDialog
          network={activeWorkspace.network}
          onAdd={(newWallet) => {
            if (
              activeWorkspace.wallets.some(
                (wallet) =>
                  wallet.key === newWallet.key && wallet.scriptType === newWallet.scriptType,
              )
            ) {
              workspace.setError('That wallet is already in this workspace.');
              return;
            }
            workspace.edit((current) => ({
              ...current,
              wallets: [...current.wallets, newWallet],
            }));
            workspace.selection.setSelectedWallet(newWallet.id);
            workspace.selection.setSelectedId(undefined);
            workspace.graph.panels.setRightTab('inspect');
            workspace.graph.panels.setMobilePanel('right');
            workspace.switchWorkbench('wallet', true);
          }}
          onClose={() => workspace.dialogs.closeAddWallet()}
        />
      )}
    </>
  );
}
