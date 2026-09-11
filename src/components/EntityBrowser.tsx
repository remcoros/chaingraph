import { Amount } from './Amount';
import { TransactionBlockTime } from './TransactionBlockTime';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  CheckSquare,
  Trash2,
  X,
} from 'lucide-react';
import {
  describeMatchScope,
  sortEntities,
  valueFilterError,
  hasActiveFilters,
  type EntitySort,
  type GraphFilters,
} from '../domain/graphFilters';
import type { Annotation, GraphNode, Transaction } from '../domain/types';
import './entity-browser.css';
import type { VisibilityProps } from './VisibilityActions';
import { GraphConnectionsAction, GraphFilterButton } from './GraphFilterControls';
import { SelectionCheckbox } from './SelectionToolbar';
import type { EntitySelection } from '../lib/useEntitySelection';

interface Props extends VisibilityProps {
  transactions?: Record<string, Transaction>;
  removableNodeIds?: readonly string[];
  onRemoveNode?: (id: string) => void;
  visibility?: 'visible' | 'hidden' | 'all' | 'graph';
  onVisibilityChange?: (visibility: 'visible' | 'hidden' | 'all' | 'graph') => void;
  hiddenCount?: number;
  onShowAllHidden?: () => void;
  nodes: GraphNode[];
  /** Rows eligible for batch actions; connected context is never included. */
  batchNodes?: GraphNode[];
  annotations: Record<string, Annotation>;
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  onResetFilters?: () => void;
  extraFiltersActive?: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  totalCount?: number;
  contextCount?: number;
  contextNodeCount?: number;
  contextPreviewPending?: boolean;
  wallets?: readonly { id: string; name: string }[];
  tags?: readonly { id: string; name: string }[];
  selection?: EntitySelection;
}

export default function EntityBrowser({
  nodes,
  batchNodes,
  annotations,
  filters,
  onFiltersChange,
  onResetFilters,
  extraFiltersActive = false,
  selectedId,
  onSelect,
  totalCount = nodes.length,
  contextCount = 0,
  contextNodeCount,
  contextPreviewPending,
  hiddenNodeIds = [],
  transactions = {},
  removableNodeIds = [],
  onRemoveNode,
  onSetHidden,
  visibility = 'visible',
  onVisibilityChange,
  hiddenCount = 0,
  onShowAllHidden,
  wallets = [],
  tags = [],
  selection,
}: Props) {
  const removable = useMemo(() => new Set(removableNodeIds), [removableNodeIds]);
  const hidden = useMemo(() => new Set(hiddenNodeIds), [hiddenNodeIds]);
  const [sort, setSort] = useState<EntitySort>('graph');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortEntities(nodes, sort), [nodes, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const activePage = Math.min(page, pageCount - 1);
  const first = activePage * pageSize;
  const filterKey = JSON.stringify(filters);
  const error = valueFilterError(filters);
  const patch = (change: Partial<GraphFilters>) => onFiltersChange({ ...filters, ...change });
  useEffect(() => setPage(0), [filterKey, sort, pageSize, visibility]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [activePage, filterKey, sort, visibility]);
  useEffect(() => {
    if (!selectedId) return;
    const index = sorted.findIndex((node) => node.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
    // Follow explicit selection changes without undoing the user's next-page action.
  }, [selectedId]);
  const activeFilters = hasActiveFilters(filters) || extraFiltersActive;
  const selectable = batchNodes ?? nodes;
  const scope = describeMatchScope(selectable);
  const excludedContext = nodes.length - selectable.length;
  return (
    <div className="entity-browser" aria-busy={contextPreviewPending}>
      <div className="entity-filters">
        <input
          aria-label="Filter graph entities"
          type="search"
          placeholder="Search labels, IDs, notes…"
          value={filters.query ?? ''}
          onChange={(event) => patch({ query: event.target.value })}
        />
        <div className="entity-filter-pair">
          <select
            aria-label="Entity type"
            value={filters.kind ?? 'all'}
            onChange={(event) => patch({ kind: event.target.value as GraphFilters['kind'] })}
          >
            <option value="all">All types</option>
            <option value="transaction">Transactions</option>
            <option value="output">Outputs</option>
            <option value="address">Addresses</option>
          </select>
          <select
            aria-label="Entity sort order"
            value={sort}
            onChange={(event) => setSort(event.target.value as EntitySort)}
          >
            <option value="graph">Graph order</option>
            <option value="label">Label A–Z</option>
            <option value="value-desc">Value high first</option>
            <option value="value-asc">Value low first</option>
            <option value="type">Entity type</option>
          </select>
        </div>
        {onVisibilityChange && (
          <div className="entity-visibility-filter">
            <select
              aria-label="Entity visibility"
              title="Match graph lists the nodes currently on the canvas. Other modes keep amount-filtered outputs available for inspection."
              value={visibility}
              onChange={(event) =>
                onVisibilityChange(event.target.value as 'visible' | 'hidden' | 'all' | 'graph')
              }
            >
              <option value="graph">Match graph</option>
              <option value="visible">Not hidden</option>
              <option value="hidden">Hidden</option>
              <option value="all">All entities</option>
            </select>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="text-button"
                aria-label={`Browse ${hiddenCount} hidden entities`}
                onClick={() => {
                  onFiltersChange({});
                  onVisibilityChange('hidden');
                }}
              >
                <EyeOff size={12} /> {hiddenCount} hidden
              </button>
            )}
          </div>
        )}
        <div className="entity-filter-actions">
          <GraphFilterButton
            triggerLabel="More filters"
            className="entity-more-filters"
            filters={filters}
            onChange={onFiltersChange}
            onReset={onResetFilters}
            extraFiltersActive={extraFiltersActive}
            wallets={wallets}
            tags={tags}
          />
          {selection && (
            <button
              type="button"
              className={`selection-mode-toggle ${selection.mode ? 'active' : ''}`}
              aria-pressed={selection.mode}
              title="Show checkboxes for choosing several entities. Single click still inspects an entity."
              onClick={() => selection.setMode(!selection.mode)}
            >
              <CheckSquare size={13} /> Select
            </button>
          )}
        </div>
        {selection?.mode && (
          <div className="entity-selection-bar">
            <span role="status">{selection.count.toLocaleString()} selected</span>
            {selectable.length > 0 && (
              <button
                type="button"
                aria-label={`Select ${scope} in the entity list`}
                disabled={contextPreviewPending}
                title={
                  excludedContext > 0
                    ? `Replace the selection with these matches. ${excludedContext.toLocaleString()} connected context entities are excluded.`
                    : 'Replace the selection with the entities listed here.'
                }
                onClick={() => {
                  if (!contextPreviewPending) selection.replace(selectable.map((node) => node.id));
                }}
              >
                Select {scope}
              </button>
            )}
            {excludedContext > 0 && (
              <span>
                {excludedContext.toLocaleString()} context{' '}
                {excludedContext === 1 ? 'entity' : 'entities'} excluded
              </span>
            )}
            {selection.count > 0 && (
              <button type="button" onClick={selection.clear}>
                Clear selection
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="entity-filter-error" role="alert">
            {error}
          </p>
        )}
        <div className="entity-result-count" tabIndex={-1}>
          <span role="status">
            {contextPreviewPending
              ? 'Filtering…'
              : `${nodes.length.toLocaleString()} ${visibility === 'graph' ? 'on graph' : 'matches'} / ${totalCount.toLocaleString()} loaded`}
          </span>
          {(visibility === 'visible' || visibility === 'graph') && (
            <GraphConnectionsAction
              filters={filters}
              onChange={onFiltersChange}
              extraNodeCount={contextNodeCount}
              pending={contextPreviewPending}
            />
          )}
          {activeFilters && (
            <button
              type="button"
              onClick={() => (onResetFilters ? onResetFilters() : onFiltersChange({}))}
              aria-label="Clear entity and graph filters"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
        {visibility === 'hidden' && hiddenCount > 0 && onShowAllHidden && (
          <button type="button" className="text-button entity-show-all" onClick={onShowAllHidden}>
            <Eye size={12} /> Show all {hiddenCount} hidden entities
          </button>
        )}
        {contextCount > 0 && (
          <p className="entity-context-note">
            Canvas also shows {contextCount.toLocaleString()} connected context entities that do not
            match these filters.
          </p>
        )}
        {filters.focus && (
          <p className="entity-context-note">
            Limited to {filters.focus.hops} graph {filters.focus.hops === 1 ? 'hop' : 'hops'} from
            the focused entity.
          </p>
        )}
        {filters.includeIds && (
          <p className="entity-context-note">
            Limited to the isolated finding. Clear filters to return.
          </p>
        )}
      </div>
      <div ref={listRef} className="entity-list" aria-label="Matching graph entities">
        {sorted.slice(first, first + pageSize).map((node) => (
          <div
            key={node.id}
            className={`entity-list-entry ${hidden.has(node.id) ? 'is-hidden' : ''} ${onSetHidden ? 'has-visibility' : ''} ${removable.has(node.id) && onRemoveNode ? 'has-removal' : ''} ${selection?.has(node.id) ? 'is-batch-selected' : ''}`}
          >
            {selection?.mode && (
              <SelectionCheckbox
                id={node.id}
                label={node.label}
                checked={selection.has(node.id)}
                onToggle={selection.toggle}
              />
            )}
            <button
              className={`entity-row ${selectedId === node.id ? 'selected' : ''}`}
              aria-pressed={selectedId === node.id}
              onClick={(event) => {
                if (selection && (event.ctrlKey || event.metaKey)) selection.toggle(node.id);
                else onSelect(node.id);
              }}
              title={node.id}
            >
              <span className={`entity-dot ${node.kind}`} />
              <span>
                <strong>{node.label}</strong>
                <small>
                  {node.kind === 'transaction' && transactions[node.txid ?? '']
                    ? `(${transactions[node.txid!].vin.length} / ${transactions[node.txid!].vout.length})`
                    : node.kind}
                  {node.kind === 'transaction' && transactions[node.txid ?? ''] && (
                    <span className="entity-chain-status">
                      <TransactionBlockTime transaction={transactions[node.txid!]} />
                    </span>
                  )}
                  {hidden.has(node.id) && <EyeOff size={11} aria-label="Hidden from graph" />}
                  {annotations[node.id]?.bookmarked && (
                    <Bookmark size={11} aria-label="Bookmarked" />
                  )}
                </small>
                <Amount as="small" value={node.value} />
              </span>
            </button>
            <div className="entity-row-actions">
              {onSetHidden && (
                <button
                  type="button"
                  className="icon-button entity-row-restore"
                  aria-label={`${hidden.has(node.id) ? 'Show' : 'Hide'} ${node.label} ${hidden.has(node.id) ? 'in' : 'from'} graph`}
                  title={hidden.has(node.id) ? 'Show entity in graph' : 'Hide entity from graph'}
                  onClick={() => onSetHidden([node.id], !hidden.has(node.id))}
                >
                  {hidden.has(node.id) ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              )}
              {removable.has(node.id) && onRemoveNode && (
                <button
                  type="button"
                  className="icon-button danger entity-row-remove"
                  aria-label={
                    node.kind === 'address'
                      ? `Stop watching ${node.label}`
                      : `Remove ${node.label} from workspace`
                  }
                  title={
                    node.kind === 'address'
                      ? 'Stop watching address'
                      : 'Remove transaction from workspace'
                  }
                  onClick={() => onRemoveNode(node.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!nodes.length && (
          <p className="empty-panel">
            {totalCount
              ? 'No matching entities. Adjust or clear the filters.'
              : 'Load a wallet, address, transaction or example to begin.'}
          </p>
        )}
      </div>
      <div className="entity-pagination">
        <div>
          <span>
            {nodes.length
              ? `${first + 1}–${Math.min(first + pageSize, nodes.length)} of ${nodes.length.toLocaleString()}`
              : '0 results'}
          </span>
          <label>
            Per page
            <select
              aria-label="Entities per page"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
        <nav aria-label="Entity pages">
          <button
            type="button"
            aria-label="Previous entity page"
            disabled={activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            Page {activePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            aria-label="Next entity page"
            disabled={activePage + 1 >= pageCount}
            onClick={() => setPage(activePage + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </nav>
      </div>
    </div>
  );
}
