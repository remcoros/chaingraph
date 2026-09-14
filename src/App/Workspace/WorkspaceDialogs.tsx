import { CopyButton } from '../../Shared/Controls/CopyButton';
import { importLabels } from '../../Domain/Metadata/labels';
import { Modal, WalletDialog, WalletNameDialog, WorkspaceDetailsDialog } from '../Dialogs';
import { emptyAnnotation } from './Inspector/Inspector';
import type { WorkspaceController } from './useWorkspace';

type Props = { workspace: WorkspaceController };

export function WorkspaceSettingsDialog({ workspace }: Props) {
  const { w } = workspace;
  if (!w || !workspace.settingsOpen) return null;
  return (
    <WorkspaceDetailsDialog
      key={w.id}
      workspace={w}
      onClose={() => workspace.setSettingsOpen(false)}
      onSave={(name, description) =>
        workspace.change(
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
  const { w, labelsInput } = workspace;
  return (
    <input
      ref={labelsInput}
      type="file"
      accept=".jsonl,.json,.txt"
      hidden
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !w) return;
        try {
          if (file.size > 5_000_000) throw new Error('Label file exceeds 5 MB.');
          const result = importLabels(await file.text());
          workspace.change((current) => {
            const annotations = { ...current.annotations };
            for (const [id, annotation] of Object.entries(result.annotations))
              annotations[id] = {
                ...(annotations[id] ?? emptyAnnotation),
                label: annotation.label,
              };
            return {
              ...current,
              annotations,
              wallets: current.wallets.map((wallet) => ({
                ...wallet,
                name: result.annotations[`xpub:${wallet.key}`]?.label.trim() || wallet.name,
              })),
            };
          });
          workspace.setNotice(
            `Imported ${Object.keys(result.annotations).length} labels. ${result.skipped} records skipped (unsupported type or no label).`,
          );
        } catch (error) {
          workspace.setError(error instanceof Error ? error.message : 'Label import failed.');
        }
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
  const { w, editingWallet } = workspace;
  return (
    <>
      {w && editingWallet && !workspace.lockingWorkspace && (
        <WalletNameDialog
          key={`${w.id}:${editingWallet.id}`}
          wallet={editingWallet}
          onChange={(name) =>
            workspace.change(
              (current) => {
                const target = current.wallets.find((item) => item.id === editingWallet.id);
                if (
                  current.id !== workspace.walletNameDialog?.workspaceId ||
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
          onClose={() => workspace.setWalletNameDialog(undefined)}
        />
      )}
      {workspace.walletDialog && w && (
        <WalletDialog
          network={w.network}
          onAdd={(newWallet) => {
            if (
              w.wallets.some(
                (wallet) =>
                  wallet.key === newWallet.key && wallet.scriptType === newWallet.scriptType,
              )
            ) {
              workspace.setError('That wallet is already in this workspace.');
              return;
            }
            workspace.change((current) => ({
              ...current,
              wallets: [...current.wallets, newWallet],
            }));
            workspace.setSelectedWallet(newWallet.id);
            workspace.setSelectedId(undefined);
            workspace.setRightTab('inspect');
            workspace.setMobilePanel('right');
            workspace.switchWorkbench('wallet', true);
          }}
          onClose={() => workspace.setWalletDialog(false)}
        />
      )}
    </>
  );
}
