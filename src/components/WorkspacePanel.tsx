import { Bookmark, ChevronRight, Plus, ShieldCheck, Wallet as WalletIcon } from 'lucide-react';
import {
  formatSats,
  short,
  type Annotation,
  type GraphNode,
  type Workspace,
} from '../domain/types';
interface Props {
  w: Workspace;
  leftTab: 'wallets' | 'entities' | 'bookmarks';
  setLeftTab: (tab: 'wallets' | 'entities' | 'bookmarks') => void;
  selectedWalletId?: string;
  selectedId?: string;
  onSelectWallet: (id: string) => void;
  onSelectNode: (id: string) => void;
  onAddWallet: () => void;
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
}
export function WorkspacePanel({
  w,
  leftTab,
  setLeftTab,
  selectedWalletId,
  selectedId,
  onSelectWallet,
  onSelectNode,
  onAddWallet,
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
      </div>
      {leftTab === 'wallets' ? (
        <>
          <div className="panel-body wallet-list">
            {w.wallets.map((item) => (
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
                </span>
                <ChevronRight size={14} />
              </button>
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
              Both receive and change branches. Scan limits are explicit; incomplete history stays
              marked.
            </p>
          </div>
        </>
      ) : leftTab === 'entities' ? (
        <>
          <div className="entity-filters">
            <input
              aria-label="Filter graph entities"
              placeholder="Filter loaded entities…"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            />
            <select
              aria-label="Entity type"
              value={entityKind}
              onChange={(e) => setEntityKind(e.target.value)}
            >
              <option value="all">All types</option>
              <option value="transaction">Transactions</option>
              <option value="output">Outputs</option>
              <option value="address">Addresses</option>
            </select>
          </div>
          <div className="entity-list">
            {entityNodes.slice(0, 200).map((n) => (
              <button
                key={n.id}
                className={`entity-row ${selectedId === n.id ? 'selected' : ''}`}
                onClick={() => onSelectNode(n.id)}
              >
                <span className={`entity-dot ${n.kind}`} />
                <span>
                  <strong>{n.label}</strong>
                  <small>
                    {n.kind} · {formatSats(n.value)}
                  </small>
                </span>
              </button>
            ))}
            {entityNodes.length > 200 && (
              <p className="small muted inset">
                Showing 200 of {entityNodes.length}. Filter to narrow the list.
              </p>
            )}
            {!entityNodes.length && <p className="empty-panel">No matching entities.</p>}
          </div>
        </>
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
