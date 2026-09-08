import type { ReactNode } from 'react';
import {
  Tag,
  Bookmark,
  ChevronRight,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet as WalletIcon,
} from 'lucide-react';
import {
  short,
  type Annotation,
  type GraphNode,
  type Wallet,
  type Workspace,
  type Transaction,
} from '../domain/types';
import { walletCheckAge } from '../domain/walletActivity';
import type { GraphFilters } from '../domain/graphFilters';
import EntityBrowser from './EntityBrowser';
interface Props {
  w: Workspace;
  tagsPanel?: ReactNode;
  leftTab: 'wallets' | 'entities' | 'bookmarks' | 'tags';
  setLeftTab: (tab: 'wallets' | 'entities' | 'bookmarks' | 'tags') => void;
  selectedWalletId?: string;
  selectedId?: string;
  onSelectWallet: (id: string) => void;
  onSelectNode: (id: string) => void;
  onAddWallet: () => void;
  busy: boolean;
  onRefreshAll: () => void;
  onShowActivity: (wallet: Wallet) => void;
  gap: number;
  setGap: (gap: number) => void;
  scanLimit: number;
  setScanLimit: (limit: number) => void;
  live: boolean;
  setLive: (live: boolean) => void;
  canQuery: boolean;
  entityFilter: string;
  setEntityFilter: (filter: string) => void;
  entityKind: string;
  setEntityKind: (kind: string) => void;
  entityNodes: GraphNode[];
  bookmarks: [string, Annotation][];
  graphFilters?: GraphFilters;
  onGraphFiltersChange?: (filters: GraphFilters) => void;
  entityTotalCount?: number;
  contextCount?: number;
  hiddenNodeIds?: readonly string[];
  onSetHidden?: (ids: string[], hidden: boolean) => void;
  visibility?: 'visible' | 'hidden' | 'all';
  onVisibilityChange?: (visibility: 'visible' | 'hidden' | 'all') => void;
  hiddenCount?: number;
  onShowAllHidden?: () => void;
  transactions?: Record<string, Transaction>;
  removableNodeIds?: readonly string[];
  onRemoveNode?: (id: string) => void;
}
export function WorkspacePanel({
  w,
  tagsPanel,
  leftTab,
  setLeftTab,
  selectedWalletId,
  selectedId,
  onSelectWallet,
  onSelectNode,
  onAddWallet,
  busy,
  onRefreshAll,
  onShowActivity,
  gap,
  setGap,
  scanLimit,
  setScanLimit,
  live,
  setLive,
  canQuery,
  entityFilter,
  setEntityFilter,
  entityKind,
  setEntityKind,
  entityNodes,
  bookmarks,
  graphFilters,
  onGraphFiltersChange,
  entityTotalCount,
  contextCount,
  hiddenNodeIds,
  onSetHidden,
  visibility,
  onVisibilityChange,
  hiddenCount,
  onShowAllHidden,
  transactions,
  removableNodeIds,
  onRemoveNode,
}: Props) {
  return (
    <aside className="left-panel" data-tour="wallet-panel">
      <div className="panel-tabs">
        <button
          className={leftTab === 'wallets' ? 'active' : ''}
          onClick={() => setLeftTab('wallets')}
        >
          Wallets <span>{w.wallets.length}</span>
        </button>
        <button
          className={leftTab === 'entities' ? 'active' : ''}
          onClick={() => setLeftTab('entities')}
        >
          Entities
        </button>
        <button
          className={leftTab === 'bookmarks' ? 'active icon-button' : 'icon-button'}
          aria-label="Bookmarks"
          onClick={() => setLeftTab('bookmarks')}
        >
          <Bookmark size={15} />
        </button>
        <button
          className={leftTab === 'tags' ? 'active icon-button' : 'icon-button'}
          aria-label="Tags"
          title="Tags"
          onClick={() => setLeftTab('tags')}
        >
          <Tag size={15} />
        </button>
      </div>
      {leftTab === 'tags' ? (
        tagsPanel
      ) : leftTab === 'wallets' ? (
        <>
          <div className="panel-body wallet-list">
            {w.wallets.map((item) => (
              <div className="wallet-card" key={item.id}>
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
                      title={item.scannedAt ? new Date(item.scannedAt).toLocaleString() : undefined}
                    >
                      {walletCheckAge(item.scannedAt)}
                      {item.scannedAt && !item.scanComplete ? ' · partial' : ''}
                    </small>
                  </span>
                  <ChevronRight size={14} />
                </button>
                {!!item.unreviewedTransactionIds?.length && (
                  <button
                    className="wallet-activity-link"
                    title="Transactions loaded since your last review"
                    onClick={() => onShowActivity(item)}
                  >
                    Show new activity · {item.unreviewedTransactionIds.length}
                    {item.activityOverflow ? '+' : ''}
                  </button>
                )}
              </div>
            ))}
            {w.wallets.length === 0 && (
              <div className="empty-panel">
                <WalletIcon size={27} />
                <h3>Wallets live here</h3>
                <p>Add multiple wallets to trace how their histories connect.</p>
              </div>
            )}
            <button className="add-wallet" onClick={onAddWallet} disabled={w.demo}>
              <Plus size={16} />
              Add wallet
            </button>
          </div>
          <div className="scan-settings">
            {!!w.wallets.length && (
              <button
                className="refresh-wallets"
                disabled={busy || !canQuery}
                onClick={onRefreshAll}
              >
                <RefreshCw size={15} /> Refresh all wallets
              </button>
            )}
            <div className="section-title">
              <h3>Discovery</h3>
              <span className="eyebrow">CLIENT-SIDE</span>
            </div>
            <label>
              Gap limit
              <input
                aria-label="Gap limit"
                type="number"
                min={10}
                max={100}
                value={gap}
                onChange={(e) => setGap(Math.max(10, Math.min(100, Number(e.target.value) || 20)))}
              />
            </label>
            <label>
              Addresses / branch
              <select value={scanLimit} onChange={(e) => setScanLimit(Number(e.target.value))}>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1,000</option>
              </select>
            </label>
            <label className="switch-label">
              <input
                type="checkbox"
                checked={live}
                disabled={!canQuery}
                onChange={(e) => setLive(e.target.checked)}
              />
              <span>Check activity every 30s</span>
            </label>
            <p className="small muted">
              {live ? 'Monitoring while unlocked. ' : 'Refresh to check for new activity. '}
              Both receive and change branches; 500 transaction downloads per wallet and check.
            </p>
          </div>
        </>
      ) : leftTab === 'entities' ? (
        <EntityBrowser
          key={w.id}
          nodes={entityNodes}
          annotations={w.annotations}
          filters={
            graphFilters ?? { query: entityFilter, kind: entityKind as GraphFilters['kind'] }
          }
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
          hiddenNodeIds={hiddenNodeIds}
          onSetHidden={onSetHidden}
          visibility={visibility}
          onVisibilityChange={onVisibilityChange}
          hiddenCount={hiddenCount}
          onShowAllHidden={onShowAllHidden}
          transactions={transactions ?? w.transactions}
          removableNodeIds={removableNodeIds}
          onRemoveNode={onRemoveNode}
        />
      ) : (
        <div className="entity-list">
          {bookmarks.map(([id, a]) => (
            <button className="entity-row" key={id} onClick={() => onSelectNode(id)}>
              <Bookmark size={15} />
              <span>
                <strong>{a.label || short(id)}</strong>
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
        {w.demo ? 'Synthetic data only' : 'Watch-only · your own node'}
      </div>
    </aside>
  );
}
