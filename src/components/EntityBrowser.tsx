import { Amount } from './Amount';
import { TransactionBlockTime } from './TransactionBlockTime';
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  ArrowRightFromLine,
  ArrowUpDown,
  Asterisk,
  Bookmark,
  Box,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
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
import { short, type Annotation, type GraphNode, type Transaction } from '../domain/types';
import './entity-browser.css';
import type { VisibilityProps } from './VisibilityActions';
import { AnchoredPopover } from './AnchoredPopover';
import { GraphConnectionsAction, GraphFilterButton } from './GraphFilterControls';
import { SelectionCheckbox } from './SelectionToolbar';
import type { EntitySelection } from '../lib/useEntitySelection';

/** Icons mirror the transaction flow block (Box), output side toolbar (ArrowRightFromLine)
 * and the graph's address-node toggle (Layers), so entities read the same way everywhere. */
const TYPE_FILTERS: { value: GraphNode['kind']; label: string; Icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { value: 'transaction', label: 'Transactions', Icon: Box },
  { value: 'output', label: 'Outputs', Icon: ArrowRightFromLine },
  { value: 'address', label: 'Addresses', Icon: Layers },
];
const TYPE_ICON = Object.fromEntries(TYPE_FILTERS.map(({ value, Icon }) => [value, Icon])) as Record<
  GraphNode['kind'],
  ComponentType<{ size?: number; className?: string }>
>;

const SORT_OPTIONS: { value: EntitySort; label: string }[] = [
  { value: 'graph', label: 'Graph order' },
  { value: 'label', label: 'Label A–Z' },
  { value: 'value-desc', label: 'Value high first' },
  { value: 'value-asc', label: 'Value low first' },
  { value: 'type', label: 'Entity type' },
];

/** Popover-backed sort trigger, matching the graph filter button's disclosure pattern. */
function EntitySortButton({
  sort,
  onChange,
}: {
  sort: EntitySort;
  onChange: (sort: EntitySort) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = SORT_OPTIONS.find((option) => option.value === sort);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`entity-sort-trigger ${sort !== 'graph' ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="Sort the entity list"
        onClick={() => setOpen((value) => !value)}
      >
        <ArrowUpDown size={12} />
        <span>{current?.label ?? 'Sort'}</span>
      </button>
      {open && trigger.current && (
        <AnchoredPopover
          id={id}
          anchor={trigger.current}
          title="Sort entities"
          width={200}
          className="entity-sort-popover"
          onClose={() => setOpen(false)}
        >
          <div role="menu" className="entity-sort-options">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === sort}
                className={option.value === sort ? 'active' : ''}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

type VisibilityMode = 'visible' | 'hidden' | 'all' | 'graph';
/** Manual "Not hidden"/"Match graph" distinction collapses into one default state
 * for the tri-state control; both still map through unchanged to onVisibilityChange. */
const VISIBILITY_CYCLE: VisibilityMode[] = ['graph', 'hidden', 'all'];
const VISIBILITY_META: Record<
  VisibilityMode,
  { Icon: ComponentType<{ size?: number; className?: string }>; label: string; hint: string }
> = {
  graph: {
    Icon: Eye,
    label: 'On graph',
    hint: 'Listing entities currently drawn on the canvas.',
  },
  visible: {
    Icon: Eye,
    label: 'On graph',
    hint: 'Listing entities currently drawn on the canvas.',
  },
  hidden: {
    Icon: EyeOff,
    label: 'Hidden',
    hint: 'Listing only entities manually hidden from the graph.',
  },
  all: {
    Icon: Asterisk,
    label: 'All',
    hint: 'Listing every loaded entity, hidden or shown.',
  },
};
function nextVisibility(current: VisibilityMode): VisibilityMode {
  const index = VISIBILITY_CYCLE.indexOf(current === 'visible' ? 'graph' : current);
  return VISIBILITY_CYCLE[(index + 1) % VISIBILITY_CYCLE.length];
}

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
  visibility = 'graph',
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
          data-testid="entity-filter-query"
          aria-label="Filter graph entities"
          type="search"
          placeholder="Search labels, IDs, notes…"
          value={filters.query ?? ''}
          onChange={(event) => patch({ query: event.target.value })}
        />
        <div className="entity-icon-row">
          <div className="entity-type-toggle" role="group" aria-label="Filter by entity type">
            {TYPE_FILTERS.map(({ value, label, Icon }) => {
              const active = filters.kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  data-testid={`entity-type-filter-${value}`}
                  className={`entity-icon-toggle entity-type-${value} ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  aria-label={label}
                  title={active ? `Showing ${label.toLowerCase()} only. Click to show all types.` : `Show ${label.toLowerCase()} only`}
                  onClick={() => patch({ kind: active ? 'all' : value })}
                >
                  <Icon size={13} />
                </button>
              );
            })}
          </div>
          {onVisibilityChange &&
            (() => {
              const meta = VISIBILITY_META[visibility];
              return (
                <button
                  type="button"
                  data-testid="entity-visibility-toggle"
                  className={`entity-icon-toggle entity-visibility-toggle ${visibility !== 'graph' && visibility !== 'visible' ? 'active' : ''}`}
                  title={`${meta.hint} Click to cycle visibility.`}
                  aria-label={`Entity visibility: ${meta.label}. Click to cycle.`}
                  onClick={() => onVisibilityChange(nextVisibility(visibility))}
                >
                  <meta.Icon size={13} />
                  <span>{meta.label}</span>
                  {hiddenCount > 0 && visibility !== 'hidden' && (
                    <span className="entity-visibility-badge">{hiddenCount}</span>
                  )}
                </button>
              );
            })()}
        </div>
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
        {activeFilters && (
          <button
            type="button"
            className="entity-clear-filters"
            onClick={() => (onResetFilters ? onResetFilters() : onFiltersChange({}))}
            aria-label="Clear entity and graph filters"
          >
            <X size={12} /> Clear filters
          </button>
        )}
        {selection?.mode && (
          <div className="entity-selection-bar">
            <span role="status">{selection.count.toLocaleString()} selected</span>
            {selectable.length > 0 && (
              <button
                type="button"
                className="entity-selection-primary"
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
        {(visibility === 'visible' || visibility === 'graph') && (
          <GraphConnectionsAction
            filters={filters}
            onChange={onFiltersChange}
            extraNodeCount={contextNodeCount}
            pending={contextPreviewPending}
          />
        )}
        <div className="entity-result-count" tabIndex={-1}>
          <span role="status">
            {contextPreviewPending
              ? 'Filtering…'
              : `${nodes.length.toLocaleString()} ${visibility === 'graph' ? 'on graph' : 'matches'} / ${totalCount.toLocaleString()} loaded`}
          </span>
          <div className="entity-result-actions">
            <EntitySortButton sort={sort} onChange={setSort} />
          </div>
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
      <div ref={listRef} className="entity-list" data-testid="entity-list" aria-label="Matching graph entities">
        {sorted.slice(first, first + pageSize).map((node) => {
          const KindIcon = TYPE_ICON[node.kind];
          return (
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
            <div
              className={`entity-row ${selectedId === node.id ? 'selected' : ''}`}
              data-testid="entity-row"
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === node.id}
              onClick={(event) => {
                if (selection && (event.ctrlKey || event.metaKey)) selection.toggle(node.id);
                else onSelect(node.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                if (selection && (event.ctrlKey || event.metaKey)) selection.toggle(node.id);
                else onSelect(node.id);
              }}
              title={node.id}
            >
              <span className="entity-row-header">
                <KindIcon size={12} className={`entity-row-icon ${node.kind}`} />
                <span className="entity-row-title">
                  <strong>{short(node.id)}</strong>
                  {node.kind === 'transaction' && transactions[node.txid ?? ''] && (
                    <small className="entity-row-io">
                      ({transactions[node.txid!].vin.length} / {transactions[node.txid!].vout.length})
                    </small>
                  )}
                </span>
              </span>
              <span className="entity-row-lower">
                <span className="entity-row-body">
                  {annotations[node.id]?.label && (
                    <small className="entity-row-label">
                      {annotations[node.id]!.icon ? `${annotations[node.id]!.icon} ` : ''}
                      {annotations[node.id]!.label}
                    </small>
                  )}
                  {node.kind === 'transaction' && transactions[node.txid ?? ''] && (
                    <span className="entity-chain-status">
                      <TransactionBlockTime transaction={transactions[node.txid!]} />
                    </span>
                  )}
                  <Amount as="small" value={node.value} />
                </span>
                <span className="entity-row-status">
                  {annotations[node.id]?.bookmarked && (
                    <Bookmark size={12} aria-label="Bookmarked" />
                  )}
                </span>
                <span className="entity-row-actions">
                  {onSetHidden && (
                    <button
                      type="button"
                      className="icon-button entity-row-restore"
                      aria-label={`${hidden.has(node.id) ? 'Show' : 'Hide'} ${node.label} ${hidden.has(node.id) ? 'in' : 'from'} graph`}
                      title={hidden.has(node.id) ? 'Show entity in graph' : 'Hide entity from graph'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSetHidden([node.id], !hidden.has(node.id));
                      }}
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
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveNode(node.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </span>
            </div>
          </div>
          );
        })}
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
