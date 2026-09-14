import TagsPanel from '../../Tags/TagsPanel';
import { type GraphFilters } from '../../../../Domain/types';
import { WorkspacePanel } from '../../WorkspacePanel';
import type { WorkspaceController } from '../../useWorkspace';

export function EntitiesPanel({ workspace }: { workspace: WorkspaceController }) {
  const {
    connectionScanTargets,
    w,
    entityRemoval,
    selection,
    annotations,
    select,
    setMobilePanel,
    shownLeftTab,
    setLeftTab,
    wallet,
    selectedId,
    invalidateSelection,
    operationRef,
    setSelectedWallet,
    setSelectedId,
    setRightTab,
    dialogs,
    operation,
    walletDiscovery,
    canQuery,
    entityPanelFilters,
    graphFilters,
    entityFiltersLinked,
    setEntityPanelFilters,
    change,
  } = workspace;
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
  } = workspace.graphProjection;
  const {
    updateFilters,
    resetEntityFilters,
    resetGraphFilters,
    setEntityFilterLink,
    setEntityHidden,
    showAllHidden,
  } = workspace.graphActions;
  const { showWalletActivity } = workspace.walletActions;

  if (!w) return null;
  return (
    <WorkspacePanel
      w={w}
      transactions={w.transactions}
      removableNodeIds={entityRemoval.removableNodeIds}
      onRemoveNode={entityRemoval.request}
      selection={connectionScanTargets.picking ? undefined : selection}
      tagsPanel={
        <TagsPanel
          key={w.id}
          workspace={w}
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
      onEditWallet={(walletId) => dialogs.openWalletRename(w.id, walletId)}
      busy={!!operation}
      onRefreshAll={() => void walletDiscovery.run()}
      onShowActivity={showWalletActivity}
      gapLimit={walletDiscovery.gapLimit}
      setGapLimit={walletDiscovery.setGapLimit}
      addressesPerBranch={walletDiscovery.addressesPerBranch}
      setAddressesPerBranch={walletDiscovery.setAddressesPerBranch}
      monitorActivity={walletDiscovery.monitorActivity}
      setMonitorActivity={walletDiscovery.setMonitorActivity}
      canQuery={canQuery}
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
      hiddenNodeIds={w.view.hiddenNodeIds}
      onSetHidden={setEntityHidden}
      visibility={entityVisibility}
      onVisibilityChange={(entityVisibility) =>
        change((current) => ({ ...current, view: { ...current.view, entityVisibility } }), false)
      }
      hiddenCount={hiddenCount}
      onShowAllHidden={showAllHidden}
      entityNodes={entityNodes}
      entityBatchNodes={entityBatchNodes}
      bookmarks={annotations.bookmarks}
    />
  );
}
