import type { WorkspaceController } from '../../useWorkspace';
import { WalletWorkbenchView } from './Review/WalletReviewPanel';

export { WalletWorkbenchView, type WalletWorkbenchViewProps } from './Review/WalletReviewPanel';

/** Binds the workspace controller to the view Workspace mounts. */
export function WalletWorkbench({ workspace }: { workspace: WorkspaceController }) {
  const {
    activeWorkspace,
    workspaces,
    tour,
    viewOwner,
    workbench,
    lockingWorkspace,
    canLoadChainData,
    operation: workspaceOperation,
    chainDataDisabledReason,
    dialogs,
    edit,
    shownWorkbench,
  } = workspace;
  const operation = workspaceOperation.status;
  const { setRightTab } = workspace.graph.panels;
  const {
    utxos: walletUtxos,
    selected: wallet,
    discovery: walletDiscovery,
    sectionRef: walletWorkspaceRef,
  } = workspace.wallet;
  const analysis = workspace.analysis;
  const { invalidate: invalidateSelection, setSelectedWallet, setSelectedId } = workspace.selection;
  const { openWalletRecord, analyzeFromWallet } = workspace.wallet.actions;

  if (!activeWorkspace) return null;
  return (
    <section
      className="workbench-page"
      hidden={shownWorkbench !== 'wallet'}
      ref={walletWorkspaceRef}
      id="wallet-workspace"
      tabIndex={-1}
      aria-label="Wallet workspace"
    >
      <WalletWorkbenchView
        walletUtxos={walletUtxos}
        preparationCache={workspaces.getUnlocked(activeWorkspace.id)?.walletPreparation}
        tourPreview={
          tour.step?.view?.workbench === 'wallet'
            ? { tab: tour.step.view.walletTab ?? 'review', example: tour.example.snapshot }
            : undefined
        }
        active={
          viewOwner === activeWorkspace.id &&
          workbench === 'wallet' &&
          !lockingWorkspace &&
          !tour.step
        }
        workspace={activeWorkspace}
        sessionAnalysis={analysis.sessions.get(activeWorkspace.id)?.scan}
        updateEvidence={(id, update, undo) => workspaces.getUnlocked(id)?.edit(update, undo)}
        onAnalysisComplete={(scan) => {
          analysis.sessions.set(activeWorkspace.id, {
            scopeMode: analysis.sessions.get(activeWorkspace.id)?.scopeMode,
            options: scan.options,
            scan,
            selectedId: scan.findings[0]?.id,
            kind: 'all',
            limit: 40,
          });
          analysis.noteWalletAnalysis();
        }}
        wallet={wallet ?? activeWorkspace.wallets.definitions[0]}
        canLoadChainData={canLoadChainData}
        busy={!!operation}
        chainDataDisabledReason={chainDataDisabledReason}
        onSelectWallet={(id) => {
          invalidateSelection();
          workspaceOperation.cancel();
          setSelectedWallet(id);
          setSelectedId(undefined);
          setRightTab('inspect');
        }}
        onAddWallet={() => dialogs.openAddWallet()}
        onChange={(update, group) => edit(update, true, group)}
        onEditWallet={(walletId) => dialogs.openWalletRename(activeWorkspace.id, walletId)}
        onRefresh={() => void walletDiscovery.run(wallet ?? activeWorkspace.wallets.definitions[0])}
        onShowInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'show')}
        onIsolateInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'isolate')}
        onShowSelection={(ids, isolate) => {
          if (ids.length) openWalletRecord(ids[0], undefined, isolate ? 'isolate' : 'show', ids);
        }}
        onInspect={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'inspect')}
        onAnalyze={analyzeFromWallet}
      />
    </section>
  );
}
