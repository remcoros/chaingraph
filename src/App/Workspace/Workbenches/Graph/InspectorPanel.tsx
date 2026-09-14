import { ConnectionScanPanel } from './ConnectionScan/ConnectionScanPanel';
import {
  addScanPathAddition,
  addScanNodeAddition,
} from '../../../../Domain/ConnectionScan/connectionScanAddition';
import { WalletRecordsPanel } from '../Wallet/Records/WalletRecordsPanel';
import { useLayoutEffect, useRef } from 'react';
import { type Transaction, type Workspace } from '../../../../Domain/types';
import type { WorkspaceController } from '../../useWorkspace';
import { InspectorPanelDetail } from './InspectorPanelDetail';
function withScanActionEvidence(
  workspace: Workspace,
  evidence?: Record<string, Transaction>,
): Workspace {
  return evidence
    ? {
        ...workspace,
        connectionScans: {
          runs: workspace.connectionScans?.runs ?? [],
          evidence: { ...workspace.connectionScans?.evidence, ...evidence },
        },
      }
    : workspace;
}
export function InspectorPanel({ workspace }: { workspace: WorkspaceController }) {
  const {
    activeWorkspace,
    rightTab,
    shownRightTab,
    setRightTab,
    fetchScope,
    connectionScanTargets,
    shownWorkbench,
    lockingWorkspace,
    canLoadChainData,
    activeWorkspaceRef,
    workspaces,
    edit,
    operationStatus: operation,
    rightPanelRef,
  } = workspace;
  const { selected: wallet, utxos: walletUtxos } = workspace.wallet;
  const { setFocusRequest } = workspace.graphCanvas;
  const { setGraph: setGraphFilters } = workspace.filters;
  const { selectedId, selectedWallet, select } = workspace.selection;
  const { visibleGraph, connectionMembers, flowIndex, connectionScanNeighbours } =
    workspace.graphProjection;
  const { selectWalletRecord } = workspace.wallet.actions;
  const inspectorScroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (inspectorScroll.current) inspectorScroll.current.scrollTop = 0;
  }, [activeWorkspace?.id, rightTab]);
  useLayoutEffect(() => {
    // Scan results stay in place while their paths change the graph selection.
    if (rightTab !== 'scan' && inspectorScroll.current) inspectorScroll.current.scrollTop = 0;
  }, [selectedId, selectedWallet, rightTab]);
  if (!activeWorkspace) return null;
  return (
    <aside className="right-panel" ref={rightPanelRef} tabIndex={-1} data-tour="analysis-panel">
      <div className={`panel-tabs ${wallet ? 'has-wallet-tabs' : ''}`}>
        <button
          className={shownRightTab === 'inspect' ? 'active' : ''}
          onClick={() => setRightTab('inspect')}
        >
          Inspector
        </button>
        <button
          className={shownRightTab === 'scan' ? 'active' : ''}
          aria-pressed={shownRightTab === 'scan'}
          onClick={() => setRightTab('scan')}
        >
          Scan
        </button>
        {wallet && (
          <>
            <button
              className={shownRightTab === 'addresses' ? 'active' : ''}
              aria-pressed={shownRightTab === 'addresses'}
              onClick={() => setRightTab('addresses')}
            >
              Addresses
            </button>
            <button
              className={shownRightTab === 'transactions' ? 'active' : ''}
              aria-pressed={shownRightTab === 'transactions'}
              onClick={() => setRightTab('transactions')}
            >
              Transactions
            </button>
            <button
              className={shownRightTab === 'utxos' ? 'active' : ''}
              aria-pressed={shownRightTab === 'utxos'}
              onClick={() => setRightTab('utxos')}
            >
              UTXOs
            </button>
          </>
        )}
      </div>
      <div className="inspector-scroll" ref={inspectorScroll}>
        {fetchScope && (
          <ConnectionScanPanel
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            selectionId={
              connectionScanTargets.picking ? connectionScanTargets.draft!.source : selectedId
            }
            customTargetIds={connectionScanTargets.targets}
            pickingTargets={connectionScanTargets.picking}
            onPickTargets={(invoker) => {
              if (selectedId) connectionScanTargets.beginPicking(selectedId, invoker);
            }}
            onCancelPicking={connectionScanTargets.cancelPicking}
            onRemoveTarget={connectionScanTargets.removeTarget}
            visibleNodeIds={visibleGraph.nodes.map((node) => node.id)}
            addedNodeIds={[...connectionMembers]}
            loadedSpenders={flowIndex.spenders}
            neighbours={connectionScanNeighbours}
            active={shownRightTab === 'scan' && shownWorkbench === 'graph' && !lockingWorkspace}
            canLoadChainData={canLoadChainData}
            scope={fetchScope}
            isCurrent={() =>
              activeWorkspaceRef.current?.id === activeWorkspace.id &&
              workspaces.getUnlocked(activeWorkspace.id)?.fetchScope === fetchScope &&
              !fetchScope.closed
            }
            onChange={(update, undo) => {
              if (
                activeWorkspaceRef.current?.id === activeWorkspace.id &&
                workspaces.getUnlocked(activeWorkspace.id)?.fetchScope === fetchScope &&
                !fetchScope.closed
              )
                workspaces.active?.edit(update, undo);
            }}
            onSelect={(id, evidence) => {
              if (evidence) {
                edit(
                  (current) => addScanNodeAddition(withScanActionEvidence(current, evidence), id),
                  true,
                  undefined,
                  id.startsWith('tx:') ? 'Add transaction' : 'Add output',
                );
                setGraphFilters({});
              }
              select(id, { preserveCamera: true });
              setRightTab('scan');
            }}
            onAdd={(result, prefixLength, evidence) => {
              edit(
                (current) =>
                  addScanPathAddition(
                    withScanActionEvidence(current, evidence),
                    result,
                    prefixLength,
                  ),
                true,
                undefined,
                'Add path',
              );
              setGraphFilters({});
              setFocusRequest(undefined);
            }}
          />
        )}
        {wallet && (
          <WalletRecordsPanel
            walletUtxos={walletUtxos}
            key={`wallet-records:${activeWorkspace.id}:${wallet.id}`}
            workspace={activeWorkspace}
            wallet={wallet}
            active={
              shownRightTab === 'addresses' ||
              shownRightTab === 'transactions' ||
              shownRightTab === 'utxos'
                ? shownRightTab
                : undefined
            }
            canLoadChainData={canLoadChainData}
            busy={!!operation}
            selectedId={selectedId}
            onSelect={selectWalletRecord}
          />
        )}
        {<InspectorPanelDetail workspace={workspace} />}
      </div>
    </aside>
  );
}
