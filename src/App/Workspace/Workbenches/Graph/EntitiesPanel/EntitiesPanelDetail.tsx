import type { ReactNode } from 'react';
import {
  Tag,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  RefreshCw,
  Shapes,
  ShieldCheck,
  Wallet as WalletIcon,
} from 'lucide-react';
import type { Annotation } from '../../../../../Core/Workspace/Annotations/annotations';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { GraphLeftTab, GraphFilters } from '../../../../../Core/Workspace/view';
import type { GraphNode } from '../../../GraphState/types';

import type { Transaction } from '../../../../../Core/ChainData';

import { walletCheckAge } from '../../../../../Core/Workspace/Wallets/walletActivity';
import { formatLocalTimestamp } from '../../../../Controls/Display/transactionTime';

import type { EntitySelection } from '../../../Selection/useEntitySelection';
import EntityBrowser from './EntityBrowser';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';
interface Props {
  activeWorkspace: Workspace;
  tagsPanel?: ReactNode;
  leftTab: GraphLeftTab;
  setLeftTab: (tab: GraphLeftTab) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  selectedWalletId?: string;
  selectedId?: string;
  onSelectWallet: (id: string) => void;
  onSelectNode: (id: string) => void;
  onAddWallet: () => void;
  onEditWallet?: (walletId: string) => void;
  busy: boolean;
  onRefreshAll: () => void;
  gapLimit: number;
  setGapLimit: (gapLimit: number) => void;
  addressesPerBranch: number;
  setAddressesPerBranch: (limit: number) => void;
  monitorActivity: boolean;
  setMonitorActivity: (monitorActivity: boolean) => void;
  canLoadChainData: boolean;
  entityFilter: string;
  setEntityFilter: (filter: string) => void;
  entityKind: string;
  setEntityKind: (kind: string) => void;
  entityNodes: GraphNode[];
  /** Entities offered for batch edits; connected context is excluded. */
  entityBatchNodes?: GraphNode[];
  bookmarks: [string, Annotation][];
  graphFilters?: GraphFilters;
  onGraphFiltersChange?: (filters: GraphFilters) => void;
  onResetGraphFilters?: () => void;
  entityFiltersLinked?: boolean;
  onEntityFiltersLinkedChange?: (linked: boolean) => void;
  entityTotalCount?: number;
  contextCount?: number;
  contextNodeCount?: number;
  contextPreviewPending?: boolean;
  hiddenNodeIds?: readonly string[];
  onSetHidden?: (ids: string[], hidden: boolean) => void;
  visibility?: 'visible' | 'hidden' | 'all' | 'graph';
  onVisibilityChange?: (visibility: 'visible' | 'hidden' | 'all' | 'graph') => void;
  hiddenCount?: number;
  onShowAllHidden?: () => void;
  transactions?: Record<string, Transaction>;
  removableNodeIds?: readonly string[];
  onRemoveNode?: (id: string) => void;
  selection?: EntitySelection;
}
export function EntitiesPanelDetail({
  activeWorkspace,
  tagsPanel,
  leftTab,
  setLeftTab,
  collapsed = false,
  onToggleCollapsed,
  selectedWalletId,
  selectedId,
  onSelectWallet,
  onSelectNode,
  onAddWallet,
  onEditWallet,
  busy,
  onRefreshAll,
  gapLimit,
  setGapLimit,
  addressesPerBranch,
  setAddressesPerBranch,
  monitorActivity,
  setMonitorActivity,
  canLoadChainData,
  entityFilter,
  setEntityFilter,
  entityKind,
  setEntityKind,
  entityNodes,
  entityBatchNodes,
  bookmarks,
  graphFilters,
  onGraphFiltersChange,
  onResetGraphFilters,
  entityFiltersLinked = true,
  onEntityFiltersLinkedChange,
  entityTotalCount,
  contextCount,
  contextNodeCount,
  contextPreviewPending,
  hiddenNodeIds,
  onSetHidden,
  visibility,
  onVisibilityChange,
  hiddenCount,
  onShowAllHidden,
  transactions,
  removableNodeIds,
  onRemoveNode,
  selection,
}: Props) {
  return (
    <aside className={`left-panel ${collapsed ? 'panel-collapsed' : ''}`} data-tour="wallet-panel">
      <div className="panel-tabs left-panel-tabs">
        <button
          data-testid="panel-tab-entities"
          className={leftTab === 'entities' ? 'active' : ''}
          onClick={() => setLeftTab('entities')}
        >
          <Shapes size={15} aria-hidden="true" /> Entities
        </button>
        <button
          data-testid="panel-tab-tags"
          className={leftTab === 'tags' ? 'active' : ''}
          onClick={() => setLeftTab('tags')}
        >
          <Tag size={15} aria-hidden="true" /> Tags
        </button>
        <button
          data-testid="panel-tab-wallets"
          className={leftTab === 'wallets' ? 'active icon-button' : 'icon-button'}
          aria-label={`Wallets, ${activeWorkspace.wallets.definitions.length}`}
          title="Wallets"
          onClick={() => setLeftTab('wallets')}
        >
          <WalletIcon size={15} aria-hidden="true" />
          <span>{activeWorkspace.wallets.definitions.length}</span>
        </button>
        <button
          data-testid="panel-tab-bookmarks"
          className={leftTab === 'bookmarks' ? 'active icon-button' : 'icon-button'}
          aria-label="Bookmarks"
          onClick={() => setLeftTab('bookmarks')}
        >
          <Bookmark size={15} />
        </button>
        {onToggleCollapsed && (
          <button
            className="icon-button panel-collapse-toggle"
            aria-label={collapsed ? 'Expand left panel' : 'Collapse left panel'}
            title={collapsed ? 'Expand left panel' : 'Collapse left panel'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
      </div>
      {leftTab === 'tags' ? (
        tagsPanel
      ) : leftTab === 'wallets' ? (
        <>
          <div className="panel-body wallet-list">
            {activeWorkspace.wallets.definitions.map((item) => (
              <div className="wallet-card" key={item.id}>
                <div className="wallet-card-heading">
                  <button
                    className={`wallet-row ${selectedWalletId === item.id ? 'selected' : ''}`}
                    key={item.id}
                    onClick={() => onSelectWallet(item.id)}
                  >
                    <WalletIcon size={19} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.addresses.filter((a) => a.history?.length).length} used addresses ·{' '}
                        {item.scriptType}
                      </small>
                      <small
                        title={item.scannedAt ? formatLocalTimestamp(item.scannedAt) : undefined}
                      >
                        {walletCheckAge(item.scannedAt)}
                        {item.scannedAt && !item.scanComplete ? ' · partial' : ''}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                  {onEditWallet && (
                    <button
                      className="icon-button wallet-name-edit"
                      aria-label={`Edit wallet name: ${item.name}`}
                      title="Edit wallet name"
                      onClick={() => onEditWallet(item.id)}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {activeWorkspace.wallets.definitions.length === 0 && (
              <div className="empty-panel">
                <WalletIcon size={27} />
                <h3>Wallets monitor activity here</h3>
                <p>Add multiple wallets to trace how their histories connect.</p>
              </div>
            )}
            <div className="compact-controls">
              <button className="add-wallet" onClick={onAddWallet} disabled={activeWorkspace.demo}>
                <Plus size={13} />
                Add wallet
              </button>
            </div>
          </div>
          <div className="scan-settings">
            {!!activeWorkspace.wallets.definitions.length && (
              <div className="compact-controls">
                <button
                  className="refresh-wallets"
                  disabled={busy || !canLoadChainData}
                  onClick={onRefreshAll}
                >
                  <RefreshCw size={13} /> Refresh all wallets
                </button>
              </div>
            )}
            <div className="section-title">
              <h3>Discovery</h3>
            </div>
            <label>
              Gap limit
              <input
                aria-label="Gap limit"
                title="Stop a branch after this many consecutive addresses with no transaction history."
                type="number"
                min={10}
                max={100}
                value={gapLimit}
                onChange={(e) =>
                  setGapLimit(Math.max(10, Math.min(100, Number(e.target.value) || 20)))
                }
              />
            </label>
            <label>
              Addresses / branch
              <select
                title="Maximum addresses checked on each receive/change branch per scan. Increase this if the scan is partial."
                value={addressesPerBranch}
                onChange={(e) => setAddressesPerBranch(Number(e.target.value))}
              >
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1,000</option>
              </select>
            </label>
            <label className="switch-label">
              <input
                type="checkbox"
                checked={monitorActivity}
                disabled={!canLoadChainData}
                onChange={(e) => setMonitorActivity(e.target.checked)}
              />
              <span>Check activity every 30s</span>
            </label>
            <p className="small muted">
              {monitorActivity
                ? 'Monitoring while unlocked. '
                : 'Refresh to check for new activity. '}
              Each check scans receive and change branches, downloading up to 500 transactions per
              wallet.
            </p>
          </div>
        </>
      ) : leftTab === 'entities' ? (
        <EntityBrowser
          key={activeWorkspace.id}
          nodes={entityNodes}
          batchNodes={entityBatchNodes}
          annotations={activeWorkspace.annotations.entities}
          filters={
            graphFilters ?? { query: entityFilter, kind: entityKind as GraphFilters['kind'] }
          }
          onResetFilters={onResetGraphFilters}
          extraFiltersActive={entityFiltersLinked && !!activeWorkspace.view.smallAmountThreshold}
          filtersLinked={entityFiltersLinked}
          onFiltersLinkedChange={onEntityFiltersLinkedChange}
          onFiltersChange={
            onGraphFiltersChange ??
            ((filters) => {
              setEntityFilter(filters.query ?? '');
              setEntityKind(filters.kind ?? 'all');
            })
          }
          selectedId={selectedId}
          onSelect={onSelectNode}
          totalCount={entityTotalCount}
          contextCount={contextCount}
          contextNodeCount={contextNodeCount}
          contextPreviewPending={contextPreviewPending}
          hiddenNodeIds={hiddenNodeIds}
          onSetHidden={onSetHidden}
          visibility={visibility}
          onVisibilityChange={onVisibilityChange}
          hiddenCount={hiddenCount}
          onShowAllHidden={onShowAllHidden}
          transactions={transactions ?? activeWorkspace.chainData.transactions}
          workspace={activeWorkspace}
          removableNodeIds={removableNodeIds}
          onRemoveNode={onRemoveNode}
          wallets={activeWorkspace.wallets.definitions}
          tags={activeWorkspace.annotations.tags}
          selection={selection}
        />
      ) : (
        <div className="entity-list">
          {bookmarks.map(([id, a]) => (
            <button className="entity-row" key={id} onClick={() => onSelectNode(id)}>
              <Bookmark size={15} />
              <span>
                <strong>{a.label || <ResponsiveIdentifier value={id} />}</strong>
                <small>{a.note || 'Saved for later'}</small>
              </span>
            </button>
          ))}
          {!bookmarks.length && (
            <p className="empty-panel">Bookmark a selected node to keep a path close at hand.</p>
          )}
        </div>
      )}
      <div className="panel-bottom">
        <ShieldCheck size={14} />
        {activeWorkspace.demo ? 'Synthetic data only' : 'Watch-only · your node'}
      </div>
    </aside>
  );
}
