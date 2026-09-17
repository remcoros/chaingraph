import { ConnectionScanPanel } from '../ConnectionScan/ConnectionScanPanel';
import { addScanPathAddition, addScanNodeAddition } from '../ConnectionScan/connectionScanAddition';
import { WalletRecordsPanel } from './WalletRecordsPanel';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  ArrowLeftRight,
  ArrowRightFromLine,
  Box,
  ChevronLeft,
  ChevronRight,
  Coins,
  Layers,
  MapPin,
  PanelRight,
  ScanLine,
  Wallet as WalletIcon,
} from 'lucide-react';
import type { Transaction } from '../../../../../Core/ChainData';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { WorkspaceController } from '../../../useWorkspace';
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
export function InspectorPanel({
  workspace,
  focusRef,
}: {
  workspace: WorkspaceController;
  focusRef: RefObject<HTMLElement | null>;
}) {
  const {
    activeWorkspace,
    fetchScope,
    shownWorkbench,
    lockingWorkspace,
    canLoadChainData,
    activeWorkspaceRef,
    workspaces,
    edit,
    operation: workspaceOperation,
  } = workspace;
  const operation = workspaceOperation.status;
  const {
    right: { tab: shownRightTab, collapsed: rightPanelCollapsed },
    saved: {
      right: { tab: savedRightTab },
    },
    setRightTab,
    toggleRightPanel,
  } = workspace.graph.panels;
  const { scanTargets: connectionScanTargets } = workspace.graph;
  const { selected: wallet, utxos: walletUtxos } = workspace.wallet;
  const { setFocusRequest } = workspace.graph.canvas;
  const { setGraph: setGraphFilters } = workspace.graph.filters;
  const { selectedId, selectedWallet, select } = workspace.selection;
  const { selected, visibleGraph, connectionMembers, flowIndex, connectionScanNeighbours } =
    workspace.graph.projection;
  const { selectWalletRecord } = workspace.wallet.actions;
  const inspectorTab = selected
    ? selected.kind === 'transaction'
      ? { label: 'Transaction', Icon: Box }
      : selected.kind === 'output'
        ? { label: 'Output', Icon: ArrowRightFromLine }
        : { label: 'Address', Icon: Layers }
    : wallet
      ? { label: 'Wallet', Icon: WalletIcon }
      : { label: 'No selection', Icon: PanelRight };
  const InspectorTabIcon = inspectorTab.Icon;
  const inspectorScroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (inspectorScroll.current) inspectorScroll.current.scrollTop = 0;
  }, [activeWorkspace?.id, savedRightTab]);
  useLayoutEffect(() => {
    // Scan results stay in place while their paths change the graph selection.
    if (savedRightTab !== 'scan' && inspectorScroll.current) inspectorScroll.current.scrollTop = 0;
  }, [selectedId, selectedWallet, savedRightTab]);
  if (!activeWorkspace) return null;
  return (
    <aside
      className={`right-panel ${rightPanelCollapsed ? 'panel-collapsed' : ''}`}
      ref={focusRef}
      tabIndex={-1}
      data-tour="analysis-panel"
    >
      <div className={`panel-tabs right-panel-tabs ${wallet ? 'has-wallet-tabs' : ''}`}>
        <button
          className="icon-button panel-collapse-toggle"
          aria-label={rightPanelCollapsed ? 'Expand right panel' : 'Collapse right panel'}
          title={rightPanelCollapsed ? 'Expand right panel' : 'Collapse right panel'}
          aria-expanded={!rightPanelCollapsed}
          onClick={toggleRightPanel}
        >
          {rightPanelCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          className={shownRightTab === 'inspect' ? 'active' : ''}
          onClick={() => setRightTab('inspect')}
        >
          <InspectorTabIcon size={15} aria-hidden="true" /> {inspectorTab.label}
        </button>
        <button
          className={shownRightTab === 'scan' ? 'active' : ''}
          aria-pressed={shownRightTab === 'scan'}
          onClick={() => setRightTab('scan')}
        >
          <ScanLine size={15} aria-hidden="true" /> Scan
        </button>
        {wallet && (
          <>
            <button
              className={shownRightTab === 'addresses' ? 'active' : ''}
              aria-pressed={shownRightTab === 'addresses'}
              onClick={() => setRightTab('addresses')}
            >
              <MapPin size={15} aria-hidden="true" /> Addresses
            </button>
            <button
              className={shownRightTab === 'transactions' ? 'active' : ''}
              aria-pressed={shownRightTab === 'transactions'}
              onClick={() => setRightTab('transactions')}
            >
              <ArrowLeftRight size={15} aria-hidden="true" /> Transactions
            </button>
            <button
              className={shownRightTab === 'utxos' ? 'active' : ''}
              aria-pressed={shownRightTab === 'utxos'}
              onClick={() => setRightTab('utxos')}
            >
              <Coins size={15} aria-hidden="true" /> UTXOs
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
