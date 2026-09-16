import { formatBitcoinAmount } from '../../../../Domain/Chain/amountFormat';
import { Amount } from '../../../Controls/Display/Amount';
import {
  RECENT_ADDRESS_GRAPH_LIMIT,
  selectedAddress as selectedAddressForHistory,
} from '../../../../Domain/Chain/addressHistory';
import { GraphLegend } from './GraphLegend';
import { GraphContextToolbar, type GraphContextSideCounts } from './GraphContextToolbar';
import { GraphControls } from './GraphControls';
import { lazy, Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Crosshair,
  Focus,
  Filter,
  GitBranch,
  LoaderCircle,
  Plus,
  X,
} from 'lucide-react';
import { FlowPanel } from './TransactionFlow/FlowPanel';
import { selectedWalletFilterIds } from '../../../../Domain/Graph/graphFilters';
import { hasActiveFilters } from './Filters/filterPresentation';
import { applyBatchIcon } from '../../../../Domain/Metadata/batchMetadata';
import { openFlowPanel } from '../../../../Domain/Workspace/panelState';
import {
  FilterChips,
  GraphConnectionsAction,
  GraphFilterButton,
} from './Filters/GraphFilterControls';
import { GraphWalletFilter } from './Filters/GraphWalletFilter';
import { transactionNodeIds } from '../../../../Domain/Graph/visibility';
import { outputNodeId, txNodeId } from '../../../../Domain/types';
import type { WorkspaceController } from '../../useWorkspace';
import { InspectorPanel } from './InspectorPanel';
import { EntitiesPanel } from './EntitiesPanel';
const GraphView = lazy(() => import('./GraphView'));
export function GraphWorkbench({ workspace }: { workspace: WorkspaceController }) {
  const {
    activeWorkspace,
    edit,
    setNotice,
    canLoadChainData,
    selectedTransaction: tx,
    canTraceAncestry,
    operationStatus: operation,
    workbench,
    viewOwner,
    tour,
    workspaces,
    annotations,
    chainDataDisabledReason,
    dialogs,
    connected,
    shownWorkbench,
    graphWorkspaceRef,
    workbenchEntry,
  } = workspace;
  const graphStageRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const entry = workbenchEntry;
    if (
      shownWorkbench !== 'graph' ||
      !entry ||
      entry.workspaceId !== activeWorkspace?.id ||
      entry.workbench !== 'graph' ||
      (entry.target !== 'stage' && entry.target !== 'inspector')
    )
      return;
    const destination = entry.target === 'inspector' ? inspectorRef.current : graphStageRef.current;
    destination?.focus({ preventScroll: true });
  }, [activeWorkspace?.id, shownWorkbench, workbenchEntry]);
  const {
    mobile: shownMobilePanel,
    left: { collapsed: leftPanelCollapsed },
    right: { collapsed: rightPanelCollapsed },
    flow: shownFlowPanel,
    setPanels,
    setFlowPanel,
    toggleSidePanels,
  } = workspace.graph.panels;
  const panelsCollapsed = leftPanelCollapsed && rightPanelCollapsed;
  const { flowInputs, scanTargets: connectionScanTargets } = workspace.graph;
  const { utxoObservation: walletUtxoObservation, selected: selectedWallet } = workspace.wallet;
  const {
    changeView: changeGraphView,
    setPendingWorkspaceId: setPendingGraphWorkspace,
    registerSnapshotFlush: registerGraphSnapshotFlush,
    focusRequest,
  } = workspace.graph.canvas;
  const { graph: graphFilters } = workspace.graph.filters;
  const {
    selectedId,
    batch: selection,
    select,
    navigation,
    preserveCamera: preserveSelectionCamera,
  } = workspace.selection;
  const {
    graphFlowContext,
    canvasIds,
    allGraphOutputIds,
    admittedIds,
    hiddenIds,
    unconnectedForHide,
    unconnectedForRemoval,
    selected,
    flowIndex,
    hiddenCount,
    graph,
    visibleGraph,
    canvasFilterResult,
    graphFiltering,
    renderEntityMetadata,
    amountGraph,
    appliedGraphRequest,
    batchPresentation,
    graphSelectedId,
    highlightedSelection,
    admittedGraph,
  } = workspace.graph.projection;
  const {
    expand,
    recentAddressUtxoTargets,
    addressUtxos,
    addressHistory,
    recentAddressTransactionTargets,
    openAddressHistory,
    showRecentAddressUtxos,
    showRecentAddressTransactions,
    addressHistoryLoad,
    addressBalance,
    loadAddressUtxos,
    openAddressHistoryTransaction,
  } = workspace.evidence;
  const {
    revealGraphNodes,
    setEntityHidden,
    removeFromGraph,
    showAllHidden,
    updateAllGraphOutputs,
    navigateSelection,
    centerNode,
    prepareIsolation,
    updateFilters,
    resetGraphFilters,
    editNode,
  } = workspace.graph.actions;
  const contextTransaction =
    graphFlowContext && activeWorkspace?.transactions[graphFlowContext.transactionId.slice(3)];
  const contextSideIds = useMemo(
    () =>
      contextTransaction
        ? {
            inputs: transactionNodeIds(contextTransaction, 'inputs'),
            outputs: transactionNodeIds(contextTransaction, 'outputs'),
          }
        : undefined,
    [contextTransaction],
  );
  const showAllOutputCount = useMemo(
    () => [...allGraphOutputIds].filter((id) => !canvasIds.has(id)).length,
    [allGraphOutputIds, canvasIds],
  );
  // One pass per side instead of five `.filter().length` scans each. These
  // recompute on every render of a very large component, over the full
  // input/output id lists of the focused transaction.
  const contextSides = useMemo(() => {
    if (!contextSideIds) return undefined;
    const countSide = (ids: readonly string[]): GraphContextSideCounts => {
      let shown = 0;
      let hidden = 0;
      let added = 0;
      let unconnectedShown = 0;
      let unconnectedAdded = 0;
      for (const id of ids) {
        const onCanvas = canvasIds.has(id);
        const admitted = admittedIds.has(id);
        if (onCanvas) shown++;
        if (admitted) {
          added++;
          if (hiddenIds.has(id)) hidden++;
        }
        if (onCanvas && unconnectedForHide.has(id)) unconnectedShown++;
        if (unconnectedForRemoval.has(id)) unconnectedAdded++;
      }
      return { total: ids.length, shown, hidden, added, unconnectedShown, unconnectedAdded };
    };
    return {
      inputs: countSide(contextSideIds.inputs),
      outputs: countSide(contextSideIds.outputs),
    };
  }, [
    contextSideIds,
    canvasIds,
    admittedIds,
    hiddenIds,
    unconnectedForHide,
    unconnectedForRemoval,
  ]);
  const toolbarSelection = selection.ids.length ? selection.ids : selectedId ? [selectedId] : [];
  const selectedSpenderTxids =
    selected?.kind === 'output' ? (flowIndex.spenders.get(selected.id) ?? []) : [];
  const openSpendingFromToolbar = () => {
    if (!selectedId) return;
    if (selectedSpenderTxids.length === 1)
      select(txNodeId(selectedSpenderTxids[0]), { preserveCamera: true });
    else if (selectedSpenderTxids.length > 1) {
      setPanels((current) => ({ ...current, flow: openFlowPanel(current.flow) }));
      setNotice('Choose a spending transaction in the transaction flow panel.');
    } else void expand('spending', selectedId, { preserveCamera: true });
  };
  const selectedInputOutputAddress =
    activeWorkspace && selected?.kind === 'output'
      ? selectedAddressForHistory(selected, activeWorkspace.network)
      : undefined;
  const selectedAddressForToolbar =
    activeWorkspace && selected?.kind === 'address'
      ? selectedAddressForHistory(selected, activeWorkspace.network)
      : undefined;
  const recentUtxoCount = selectedAddressForToolbar
    ? addressUtxos
      ? recentAddressUtxoTargets.filter(
          (utxo) => !canvasIds.has(outputNodeId(utxo.txid, utxo.vout)),
        ).length
      : canLoadChainData
        ? RECENT_ADDRESS_GRAPH_LIMIT
        : 0
    : 0;
  const recentTransactionNeedsFetch =
    !addressHistory ||
    addressHistory.source === 'loaded transactions' ||
    addressHistory.entries.length === 0;
  const recentTransactionCount = selectedAddressForToolbar
    ? recentTransactionNeedsFetch && canLoadChainData
      ? RECENT_ADDRESS_GRAPH_LIMIT
      : recentAddressTransactionTargets.filter((entry) => !canvasIds.has(txNodeId(entry.txid)))
          .length
    : 0;
  const graphContextToolbar = activeWorkspace ? (
    <GraphContextToolbar
      contextTitle={
        graphFlowContext ? `Transaction ${graphFlowContext.transactionId.slice(3)}` : undefined
      }
      selectedKind={selected?.kind}
      selectedCount={toolbarSelection.length}
      canOpenAddressHistory={!!selectedInputOutputAddress}
      onOpenAddressHistory={openAddressHistory}
      canShowRecentUtxos={!!selectedAddressForToolbar && (!!addressUtxos || canLoadChainData)}
      recentUtxoCount={recentUtxoCount}
      onShowRecentUtxos={showRecentAddressUtxos}
      canShowRecentTransactions={
        !!selectedAddressForToolbar && (!!addressHistory?.entries.length || canLoadChainData)
      }
      recentTransactionCount={recentTransactionCount}
      onShowRecentTransactions={showRecentAddressTransactions}
      sides={contextSides}
      onAddSide={(side) => revealGraphNodes(contextSideIds?.[side] ?? [])}
      onHideSide={(side) =>
        setEntityHidden(
          (contextSideIds?.[side] ?? []).filter(
            (id) => canvasIds.has(id) && unconnectedForHide.has(id),
          ),
          true,
        )
      }
      onRemoveSide={(side) =>
        removeFromGraph(
          (contextSideIds?.[side] ?? []).filter((id) => unconnectedForRemoval.has(id)),
        )
      }
      canOpenCreatingTx={!!tx || canTraceAncestry}
      canOpenSpendingTx={selectedSpenderTxids.length > 0 || canTraceAncestry}
      onOpenCreatingTx={() => void expand('funding', selectedId, { preserveCamera: true })}
      onOpenSpendingTx={openSpendingFromToolbar}
      canShowSelection={toolbarSelection.some((id) => !canvasIds.has(id))}
      canHideSelection={toolbarSelection.some((id) => canvasIds.has(id))}
      canRemoveSelection={toolbarSelection.some((id) => admittedIds.has(id))}
      onShowSelection={() => revealGraphNodes(toolbarSelection)}
      onHideSelection={() =>
        setEntityHidden(
          toolbarSelection.filter((id) => canvasIds.has(id)),
          true,
        )
      }
      onRemoveSelection={() => removeFromGraph(toolbarSelection)}
      canHideBranch={!!graphFlowContext && canvasIds.has(graphFlowContext.transactionId)}
      canRemoveBranch={!!graphFlowContext && admittedIds.has(graphFlowContext.transactionId)}
      onHideBranch={() =>
        setEntityHidden(graphFlowContext ? [graphFlowContext.transactionId] : [], true)
      }
      onRemoveBranch={() =>
        removeFromGraph(graphFlowContext ? [graphFlowContext.transactionId] : [])
      }
      hiddenCount={hiddenCount}
      onRestoreHidden={showAllHidden}
      unconnectedCount={unconnectedForHide.size}
      removableOutputCount={unconnectedForRemoval.size}
      showAllOutputCount={showAllOutputCount}
      onHideUnconnected={() => void updateAllGraphOutputs('hide')}
      onRemoveUnconnected={() => removeFromGraph([...unconnectedForRemoval])}
      onShowAllOutputs={() => void updateAllGraphOutputs('show')}
      busy={!!operation}
    />
  ) : null;
  const graphNavigation = activeWorkspace ? (
    <div className="graph-navigation">
      <button
        aria-label="Previous selection"
        title="Previous selection"
        disabled={navigation.index <= 0}
        onClick={() => navigateSelection(-1)}
      >
        <ArrowLeft size={14} />
      </button>
      <button
        aria-label="Next selection"
        title="Next selection"
        disabled={navigation.index >= navigation.ids.length - 1}
        onClick={() => navigateSelection(1)}
      >
        <ArrowRight size={14} />
      </button>
      <button
        aria-label="Center selection"
        title="Center selection"
        disabled={!selected || hiddenIds.has(selected.id)}
        onClick={() => centerNode()}
      >
        <Crosshair size={14} />
        <span className="graph-nav-caption">Center</span>
      </button>
      <button
        aria-label="Lock to selection"
        title="Keep selections centered without changing zoom"
        aria-pressed={activeWorkspace.view.lockToSelection ?? false}
        className={`graph-lock-selection ${activeWorkspace.view.lockToSelection ? 'active' : ''}`}
        onClick={() => {
          preserveSelectionCamera(undefined);
          edit(
            (current) => ({
              ...current,
              view: { ...current.view, lockToSelection: !current.view.lockToSelection },
            }),
            false,
          );
        }}
      >
        <Focus size={14} />
        <span className="graph-nav-caption">Lock</span>
      </button>
      <button
        aria-label="Isolate selection"
        title="Show the selection and connected entities; Paths sets the hop limit"
        aria-pressed={!!graphFilters.focus}
        className={`graph-isolate-selection ${graphFilters.focus ? 'active' : ''}`}
        disabled={!graphFilters.focus && (!selected || hiddenIds.has(selected.id))}
        onClick={() => {
          if (graphFilters.focus) updateFilters({ ...graphFilters, focus: undefined });
          else if (selectedId) {
            prepareIsolation([selectedId], true);
            updateFilters({ ...graphFilters, focus: { id: selectedId, hops: 1 } });
          }
        }}
      >
        <Filter size={14} />
        <span className="graph-nav-caption">Isolate</span>
      </button>
      <label>
        <span className="graph-path-label">Paths</span>
        <select
          aria-label="Focus graph paths"
          value={graphFilters.focus?.hops ?? 0}
          disabled={!selected && !!graph.nodes.length}
          onChange={(event) => {
            const hops = Number(event.target.value);
            updateFilters(
              hops && selectedId
                ? {
                    ...graphFilters,
                    focus: { id: selectedId, hops: hops as 1 | 2 },
                    includeIds: undefined,
                  }
                : { ...graphFilters, focus: undefined, includeIds: undefined },
            );
          }}
        >
          <option value={0}>All paths</option>
          <option value={1}>1 hop</option>
          <option value={2}>2 hops</option>
        </select>
      </label>
      <GraphWalletFilter
        key={activeWorkspace.id}
        active={workbench === 'graph'}
        filters={graphFilters}
        wallets={activeWorkspace.wallets}
        onChange={updateFilters}
      />
      <GraphFilterButton
        filters={graphFilters}
        onChange={updateFilters}
        onReset={resetGraphFilters}
        extraFiltersActive={!!activeWorkspace.view.smallAmountThreshold}
        wallets={activeWorkspace.wallets}
        tags={activeWorkspace.tags}
      />
      <button
        className={`selection-mode-toggle ${selection.mode ? 'active' : ''}`}
        aria-label="Selection mode"
        aria-pressed={selection.mode}
        title="Choose several entities for batch labels, tags and icons. Ctrl or Cmd click also toggles an entity."
        disabled={connectionScanTargets.picking}
        onClick={() => selection.setMode(!selection.mode)}
      >
        <CheckSquare size={14} />
        <span className="graph-nav-caption">Select</span>
      </button>
    </div>
  ) : null;
  const selectionOffCanvas = Boolean(
    selected && !visibleGraph.nodes.some((node) => node.id === selected.id),
  );
  const graphNavigationStatus =
    activeWorkspace &&
    (hasActiveFilters(graphFilters) ||
      activeWorkspace.view.smallAmountThreshold ||
      hiddenCount > 0 ||
      selectionOffCanvas) ? (
      <>
        <FilterChips
          filters={graphFilters}
          onChange={updateFilters}
          names={{
            walletName: activeWorkspace.wallets.find(
              (wallet) => wallet.id === graphFilters.walletId,
            )?.name,
            walletNames: selectedWalletFilterIds(graphFilters).map(
              (id) =>
                activeWorkspace.wallets.find((wallet) => wallet.id === id)?.name ??
                'Removed wallet',
            ),
            tagName: activeWorkspace.tags?.find((tag) => tag.id === graphFilters.tagId)?.name,
          }}
          hiddenCount={hiddenCount}
          onShowAllHidden={showAllHidden}
          onReset={resetGraphFilters}
          extraFiltersActive={!!activeWorkspace.view.smallAmountThreshold}
        >
          {!!activeWorkspace.view.smallAmountThreshold && (
            <span className="filter-chip">
              <span
                title={`Above ${formatBitcoinAmount(activeWorkspace.view.smallAmountThreshold)}`}
              >
                Above <Amount value={activeWorkspace.view.smallAmountThreshold} />
              </span>
              <button
                aria-label="Remove graph amount filter"
                onClick={() =>
                  edit(
                    (current) => ({
                      ...current,
                      view: { ...current.view, smallAmountThreshold: undefined },
                    }),
                    false,
                  )
                }
              >
                <X size={11} />
              </button>
            </span>
          )}
          <GraphConnectionsAction
            filters={graphFilters}
            onChange={updateFilters}
            extraNodeCount={canvasFilterResult.availableContextNodeCount}
            pending={graphFiltering}
          />
        </FilterChips>
        {selectionOffCanvas && (
          <span className="view-summary">
            {hiddenIds.has(selected!.id)
              ? 'selection hidden from graph'
              : !admittedIds.has(selected!.id)
                ? 'selection not on graph'
                : 'selection hidden by filters'}
          </span>
        )}
      </>
    ) : null;
  if (!activeWorkspace) return null;
  return (
    <main
      hidden={shownWorkbench !== 'graph'}
      ref={graphWorkspaceRef}
      id="main-workspace"
      tabIndex={-1}
      className={`workbench show-${shownMobilePanel} ${leftPanelCollapsed ? 'left-panel-collapsed' : ''} ${rightPanelCollapsed ? 'right-panel-collapsed' : ''}`}
    >
      <EntitiesPanel workspace={workspace} />
      <section
        ref={graphStageRef}
        className="graph-stage"
        data-tour="graph-stage"
        aria-label="Graph workspace"
        tabIndex={-1}
      >
        <div className="graph-stage-content">
          {viewOwner === activeWorkspace.id && (
            <FlowPanel
              walletUtxoObservation={walletUtxoObservation}
              key={activeWorkspace.id}
              state={shownFlowPanel}
              onStateChange={(transactionFlow) => !tour.step && setFlowPanel(transactionFlow)}
              renderMetadata={renderEntityMetadata}
              onSmallAmountThresholdChange={(flowAmountThreshold) =>
                edit(
                  (current) => ({
                    ...current,
                    view: { ...current.view, flowAmountThreshold },
                  }),
                  false,
                )
              }
              workspace={activeWorkspace}
              selectedWallet={selectedWallet}
              addressHistory={addressHistory}
              addressHistoryLoad={addressHistoryLoad}
              addressBalance={addressBalance}
              addressUtxos={addressUtxos}
              onLoadAddressHistory={openAddressHistory}
              onLoadAddressUtxos={loadAddressUtxos}
              onOpenAddressHistoryTransaction={openAddressHistoryTransaction}
              selected={selected}
              selection={connectionScanTargets.picking ? undefined : selection}
              hiddenNodeIds={activeWorkspace.view.hiddenNodeIds}
              graphNodeIds={activeWorkspace.view.graphNodeIds}
              onSetHidden={setEntityHidden}
              {...flowInputs}
              onSelect={select}
              onEdit={editNode}
              onApplyTags={annotations.changeTags}
              onSetIcon={(id, icon) => edit((current) => applyBatchIcon(current, [id], icon, true))}
              onTrace={(direction, id) => void expand(direction, id)}
              disabledReason={
                operation ? 'Wait for the current operation to finish.' : chainDataDisabledReason
              }
            />
          )}
          <div className="graph-renderer-region">
            {!graph.nodes.length && (
              <GraphControls
                smallAmountHiddenCount={amountGraph.hiddenCount}
                view={activeWorkspace.view}
                panelsCollapsed={panelsCollapsed}
                onTogglePanels={toggleSidePanels}
                onChange={changeGraphView}
              />
            )}
            {graph.nodes.length && viewOwner === activeWorkspace.id ? (
              <Suspense
                fallback={
                  <div className="graph-empty">
                    <LoaderCircle className="spin" />
                    <p>Loading graph renderer…</p>
                  </div>
                }
              >
                <GraphView
                  filtering={graphFiltering}
                  key={activeWorkspace.id}
                  snapshot={activeWorkspace.view.graphSnapshot}
                  onActivity={(active) => {
                    workspaces.active?.pauseAutosave(active);
                    setPendingGraphWorkspace((previous) =>
                      active
                        ? activeWorkspace.id
                        : previous === activeWorkspace.id
                          ? undefined
                          : previous,
                    );
                  }}
                  onRegisterSnapshotFlush={(flush) => {
                    registerGraphSnapshotFlush(activeWorkspace.id, flush);
                  }}
                  onSnapshot={(snapshot) =>
                    workspaces.active?.edit(
                      (current) => ({
                        ...current,
                        view: { ...current.view, graphSnapshot: snapshot },
                      }),
                      false,
                    )
                  }
                  navigation={graphNavigation}
                  contextToolbar={graphContextToolbar}
                  navigationStatus={graphNavigationStatus}
                  legend={
                    <GraphLegend
                      flowContext={graphFlowContext}
                      dimensions={appliedGraphRequest.dimensions}
                      showAddresses={appliedGraphRequest.showAddresses}
                      demo={activeWorkspace.demo}
                    />
                  }
                  toolbar={({ motionToggle }) => (
                    <GraphControls
                      motionToggle={motionToggle}
                      smallAmountHiddenCount={amountGraph.hiddenCount}
                      view={activeWorkspace.view}
                      panelsCollapsed={panelsCollapsed}
                      onTogglePanels={toggleSidePanels}
                      onChange={changeGraphView}
                    />
                  )}
                  nodePresentation={batchPresentation}
                  flowContext={graphFlowContext}
                  renderMetadata={renderEntityMetadata}
                  nodes={visibleGraph.nodes}
                  links={visibleGraph.links}
                  focusRequest={focusRequest}
                  selectedId={graphSelectedId}
                  onSelect={select}
                  selectionMode={connectionScanTargets.picking || selection.mode}
                  selectionPurpose={connectionScanTargets.picking ? 'scan-target' : 'batch'}
                  batchSelectedIds={highlightedSelection}
                  onToggleSelection={
                    connectionScanTargets.picking ? connectionScanTargets.toggle : selection.toggle
                  }
                  hiddenNodeIds={activeWorkspace.view.hiddenNodeIds}
                  graphNodeIds={activeWorkspace.view.graphNodeIds}
                  onSetHidden={setEntityHidden}
                  dimensions={appliedGraphRequest.dimensions}
                  sizeBy={appliedGraphRequest.sizeBy}
                  glow={appliedGraphRequest.glow}
                  showLabels={appliedGraphRequest.showLabels}
                  showTags={appliedGraphRequest.showTags}
                  showIcons={appliedGraphRequest.showIcons}
                  fitToken={appliedGraphRequest.fitToken}
                  transactions={activeWorkspace.transactions}
                  workspace={activeWorkspace}
                  onTrace={(id) => void expand('funding', id)}
                  onEdit={editNode}
                  busy={!!operation}
                  traceDisabledReason={chainDataDisabledReason}
                />
              </Suspense>
            ) : (
              <div className="graph-empty">
                <div className="graph-empty-mark">
                  <GitBranch size={38} />
                </div>
                <span className="eyebrow">AN OPEN FIELD</span>
                <h2>
                  Start with a wallet.
                  <br />
                  Or follow a transaction.
                </h2>
                <p>
                  Import a public key or paste a transaction, output, or address above. Expand only
                  the paths that matter to you.
                </p>
                <button onClick={() => dialogs.openAddWallet()} className="primary">
                  <Plus size={16} />
                  Add your first wallet
                </button>
                {!connected && (
                  <p className="small">Backend offline. You can still work with saved data.</p>
                )}
              </div>
            )}
            {!!graph.nodes.length && !visibleGraph.nodes.length && (
              <div className="filtered-graph-empty">
                <h3>
                  {!admittedGraph.nodes.length
                    ? 'Choose a node to add to the graph'
                    : hiddenCount === admittedGraph.nodes.length
                      ? 'All entities are hidden'
                      : 'No visible nodes match these filters'}
                </h3>
                <p>Use the transaction flow, entity list or right toolbar to show nodes.</p>
                <div className="button-row">
                  {!!Object.keys(graphFilters).length && (
                    <button onClick={resetGraphFilters}>Clear filters</button>
                  )}
                  {!!hiddenCount && (
                    <button onClick={showAllHidden}>Show all hidden entities</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <InspectorPanel workspace={workspace} focusRef={inspectorRef} />
    </main>
  );
}
