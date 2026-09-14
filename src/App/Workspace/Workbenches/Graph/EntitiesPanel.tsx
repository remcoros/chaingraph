import TagsPanel from '../../Tags/TagsPanel';
import { type GraphFilters } from '../../../../Domain/types';
import { WorkspacePanel } from '../../WorkspacePanel';
import type { WorkspaceController } from '../../useWorkspace';

export function EntitiesPanel({ workspace }: { workspace: WorkspaceController }) {
  const {
    activeWorkspace,
    entityRemoval,
    annotations,
    operationRef,
    dialogs,
    operationStatus: operation,
    canLoadChainData,
    edit,
  } = workspace;
  const {
    setMobilePanel,
    leftTab: shownLeftTab,
    setLeftTab,
    setRightTab,
    leftPanelCollapsed,
    setLeftPanelCollapsed,
  } = workspace.graph.panels;
  const { scanTargets: connectionScanTargets } = workspace.graph;
  const { selected: wallet, discovery: walletDiscovery } = workspace.wallet;
  const {
    entityPanel: entityPanelFilters,
    graph: graphFilters,
    entityLinked: entityFiltersLinked,
    setEntityPanel: setEntityPanelFilters,
  } = workspace.graph.filters;
  const {
    batch: selection,
    select,
    selectedId,
    invalidate: invalidateSelection,
    setSelectedWallet,
    setSelectedId,
  } = workspace.selection;
  const {
    graph,
    selected,
    recoveryGraph,
    visibleEntityCount,
    entityVisibility,
    hiddenCount,
    visibleGraph,
    canvasFilterResult,
    graphFiltering,
    entityNodes,
    entityBatchNodes,
  } = workspace.graph.projection;
  const {
    updateFilters,
    resetEntityFilters,
    resetGraphFilters,
    setEntityFilterLink,
    setEntityHidden,
    showAllHidden,
  } = workspace.graph.actions;
  const { showWalletActivity } = workspace.wallet.actions;

  if (!activeWorkspace) return null;
  return (
    <WorkspacePanel
      activeWorkspace={activeWorkspace}
      transactions={activeWorkspace.transactions}
      removableNodeIds={entityRemoval.removableNodeIds}
      onRemoveNode={entityRemoval.request}
      selection={connectionScanTargets.picking ? undefined : selection}
      tagsPanel={
        <TagsPanel
          key={activeWorkspace.id}
          workspace={activeWorkspace}
          graph={graph}
          selected={selected}
          selectedIds={connectionScanTargets.picking ? undefined : selection.ids}
          onChange={annotations.changeTags}
          onSelect={(id) => {
            select(id);
            if (!connectionScanTargets.picking) setMobilePanel('right');
          }}
          onShow={(tag) => {
            updateFilters({ tagId: tag.id, preserveContext: true });
            setMobilePanel('graph');
          }}
        />
      }
      leftTab={shownLeftTab}
      setLeftTab={setLeftTab}
      collapsed={leftPanelCollapsed}
      onToggleCollapsed={() => setLeftPanelCollapsed((value) => !value)}
      selectedWalletId={wallet?.id}
      selectedId={selectedId}
      onSelectWallet={(id) => {
        invalidateSelection();
        operationRef.current?.abort();
        setSelectedWallet(id);
        setSelectedId(undefined);
        setRightTab('inspect');
        setMobilePanel('right');
      }}
      onSelectNode={(id) => {
        select(id);
        if (!connectionScanTargets.picking) setMobilePanel('right');
      }}
      onAddWallet={() => dialogs.openAddWallet()}
      onEditWallet={(walletId) => dialogs.openWalletRename(activeWorkspace.id, walletId)}
      busy={!!operation}
      onRefreshAll={() => void walletDiscovery.run()}
      onShowActivity={showWalletActivity}
      gapLimit={walletDiscovery.gapLimit}
      setGapLimit={walletDiscovery.setGapLimit}
      addressesPerBranch={walletDiscovery.addressesPerBranch}
      setAddressesPerBranch={walletDiscovery.setAddressesPerBranch}
      monitorActivity={walletDiscovery.monitorActivity}
      setMonitorActivity={walletDiscovery.setMonitorActivity}
      canLoadChainData={canLoadChainData}
      entityFilter={(entityFiltersLinked ? graphFilters : entityPanelFilters).query ?? ''}
      setEntityFilter={(query) =>
        entityFiltersLinked
          ? updateFilters({ ...graphFilters, query })
          : setEntityPanelFilters((filters) => ({ ...filters, query }))
      }
      entityKind={(entityFiltersLinked ? graphFilters : entityPanelFilters).kind ?? 'all'}
      setEntityKind={(kind) =>
        entityFiltersLinked
          ? updateFilters({ ...graphFilters, kind: kind as GraphFilters['kind'] })
          : setEntityPanelFilters((filters) => ({
              ...filters,
              kind: kind as GraphFilters['kind'],
            }))
      }
      graphFilters={entityFiltersLinked ? graphFilters : entityPanelFilters}
      onGraphFiltersChange={entityFiltersLinked ? updateFilters : setEntityPanelFilters}
      onResetGraphFilters={entityFiltersLinked ? resetGraphFilters : resetEntityFilters}
      entityFiltersLinked={entityFiltersLinked}
      onEntityFiltersLinkedChange={setEntityFilterLink}
      entityTotalCount={
        entityVisibility === 'hidden'
          ? hiddenCount
          : entityVisibility === 'visible'
            ? visibleEntityCount
            : recoveryGraph.nodes.length
      }
      contextCount={
        entityFiltersLinked && (entityVisibility === 'visible' || entityVisibility === 'graph')
          ? visibleGraph.contextNodeIds.length
          : 0
      }
      contextNodeCount={entityFiltersLinked ? canvasFilterResult.availableContextNodeCount : 0}
      contextPreviewPending={entityFiltersLinked && graphFiltering}
      hiddenNodeIds={activeWorkspace.view.hiddenNodeIds}
      onSetHidden={setEntityHidden}
      visibility={entityVisibility}
      onVisibilityChange={(entityVisibility) =>
        edit((current) => ({ ...current, view: { ...current.view, entityVisibility } }), false)
      }
      hiddenCount={hiddenCount}
      onShowAllHidden={showAllHidden}
      entityNodes={entityNodes}
      entityBatchNodes={entityBatchNodes}
      bookmarks={annotations.bookmarks}
    />
  );
}
