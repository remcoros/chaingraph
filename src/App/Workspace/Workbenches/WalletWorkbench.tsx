import { WalletWorkbench as WalletWorkbenchContent } from './Wallet/WalletWorkbench';
import type { WorkspaceController } from '../useWorkspace';

export function WalletWorkbench({ workspace }: { workspace: WorkspaceController }) {
  const {
    walletUtxos,
    w,
    ws,
    tourStep,
    tourExample,
    viewOwner,
    workbench,
    lockingWorkspace,
    analysisSessions,
    setWalletScanRevision,
    wallet,
    canQuery,
    operation,
    queryDisabledReason,
    invalidateSelection,
    operationRef,
    setSelectedWallet,
    setSelectedId,
    setRightTab,
    setWalletDialog,
    change,
    setWalletNameDialog,
    scan,
    shownWorkbench,
    walletWorkspaceRef,
  } = workspace;
  const { openWalletRecord, analyzeFromWallet } = workspace.walletActions;

  if (!w) return null;
  return (
    <section
      className="workbench-page"
      hidden={shownWorkbench !== 'wallet'}
      ref={walletWorkspaceRef}
      id="wallet-workspace"
      tabIndex={-1}
      aria-label="Wallet workspace"
    >
      <WalletWorkbenchContent
        walletUtxos={walletUtxos}
        preparationCache={ws.getSession(w.id)?.walletPreparation}
        tourPreview={
          tourStep?.view?.workbench === 'wallet'
            ? { tab: tourStep.view.walletTab ?? 'review', example: tourExample }
            : undefined
        }
        active={viewOwner === w.id && workbench === 'wallet' && !lockingWorkspace && !tourStep}
        workspace={w}
        analysisScan={analysisSessions.current.get(w.id)?.scan}
        updateEvidence={ws.update}
        onScanComplete={(scan) => {
          analysisSessions.current.set(w.id, {
            scopeMode: analysisSessions.current.get(w.id)?.scopeMode,
            options: scan.options,
            scan,
            selectedId: scan.findings[0]?.id,
            kind: 'all',
            limit: 40,
          });
          setWalletScanRevision((value) => value + 1);
        }}
        wallet={wallet ?? w.wallets[0]}
        canQuery={canQuery}
        busy={!!operation}
        queryDisabledReason={queryDisabledReason}
        onSelectWallet={(id) => {
          invalidateSelection();
          operationRef.current?.abort();
          setSelectedWallet(id);
          setSelectedId(undefined);
          setRightTab('inspect');
        }}
        onAddWallet={() => setWalletDialog(true)}
        onChange={(update, group) => change(update, true, group)}
        onEditWallet={(walletId) => setWalletNameDialog({ workspaceId: w.id, walletId })}
        onRefresh={() => void scan(wallet ?? w.wallets[0])}
        onShowInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'graph')}
        onIsolateInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'isolate')}
        onShowSelection={(ids, isolate) => {
          if (ids.length) openWalletRecord(ids[0], undefined, isolate ? 'isolate' : 'graph', ids);
        }}
        onInspect={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'inspect')}
        onAnalyze={analyzeFromWallet}
      />
    </section>
  );
}
