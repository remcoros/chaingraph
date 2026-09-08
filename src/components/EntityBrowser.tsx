import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import {
  sortEntities,
  valueFilterError,
  type EntitySort,
  type GraphFilters,
} from '../domain/graphFilters';
import { formatSats, type Annotation, type GraphNode } from '../domain/types';
import './entity-browser.css';

interface Props {
  nodes: GraphNode[];
  annotations: Record<string, Annotation>;
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  totalCount?: number;
  contextCount?: number;
}

function SatoshiBound({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value?: number) => void;
}) {
  const [text, setText] = useState(value?.toString() ?? '');
  useEffect(() => {
    if (value === undefined || Number.isFinite(value)) setText(value?.toString() ?? '');
  }, [value]);
  return (
    <input
      aria-label={label}
      type="text"
      inputMode="numeric"
      placeholder="No limit"
      value={text}
      aria-invalid={
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < 0 || value > 2_100_000_000_000_000)
      }
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        onChange(raw === '' ? undefined : /^\d+$/.test(raw) ? Number(raw) : Number.NaN);
      }}
    />
  );
}

export default function EntityBrowser({
  nodes,
  annotations,
  filters,
  onFiltersChange,
  selectedId,
  onSelect,
  totalCount = nodes.length,
  contextCount = 0,
}: Props) {
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
  useEffect(() => setPage(0), [filterKey, sort, pageSize]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [activePage, filterKey, sort]);
  useEffect(() => {
    if (!selectedId) return;
    const index = sorted.findIndex((node) => node.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
    // Follow explicit selection changes without undoing the user's next-page action.
  }, [selectedId]);
  const activeFilters = Boolean(
    filters.query ||
    (filters.kind && filters.kind !== 'all') ||
    (filters.label && filters.label !== 'all') ||
    filters.bookmarkedOnly ||
    filters.minSats !== undefined ||
    filters.maxSats !== undefined ||
    (filters.spend && filters.spend !== 'all') ||
    (filters.funding && filters.funding !== 'all') ||
    filters.focus ||
    filters.includeIds ||
    filters.tagId ||
    filters.walletId ||
    filters.preserveContext,
  );
  return (
    <div className="entity-browser">
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
        <details className="entity-advanced">
          <summary>
            <SlidersHorizontal size={13} /> More filters
          </summary>
          <div className="entity-advanced-fields">
            <label>
              Labels
              <select
                aria-label="Entity label state"
                value={filters.label ?? 'all'}
                onChange={(event) => patch({ label: event.target.value as GraphFilters['label'] })}
              >
                <option value="all">Any label state</option>
                <option value="labeled">Has a user label</option>
                <option value="unlabeled">No user label</option>
              </select>
            </label>
            <label className="entity-bookmark-filter">
              <input
                type="checkbox"
                checked={filters.bookmarkedOnly ?? false}
                onChange={(event) => patch({ bookmarkedOnly: event.target.checked })}
              />{' '}
              Bookmarked only
            </label>
            <div className="entity-filter-pair">
              <label>
                Min sats
                <SatoshiBound
                  label="Minimum entity value in sats"
                  value={filters.minSats}
                  onChange={(minSats) => patch({ minSats })}
                />
              </label>
              <label>
                Max sats
                <SatoshiBound
                  label="Maximum entity value in sats"
                  value={filters.maxSats}
                  onChange={(maxSats) => patch({ maxSats })}
                />
              </label>
            </div>
            <label>
              Loaded spend evidence
              <select
                aria-label="Output spend evidence"
                value={filters.spend ?? 'all'}
                onChange={(event) => patch({ spend: event.target.value as GraphFilters['spend'] })}
              >
                <option value="all">Any entity</option>
                <option value="observed">Outputs with a loaded spend</option>
                <option value="unknown">Outputs without a loaded spend</option>
              </select>
            </label>
            <label>
              Funding data
              <select
                aria-label="Output funding data"
                value={filters.funding ?? 'all'}
                onChange={(event) =>
                  patch({ funding: event.target.value as GraphFilters['funding'] })
                }
              >
                <option value="all">Any entity</option>
                <option value="missing">Outputs missing funding data</option>
                <option value="loaded">Outputs with funding data</option>
              </select>
            </label>
            <p>
              Spend and funding filters select outputs only. No loaded spend means unknown, not
              unspent. Value limits exclude unknown amounts.
            </p>
            <label className="entity-bookmark-filter">
              <input
                type="checkbox"
                checked={filters.preserveContext ?? false}
                onChange={(event) => patch({ preserveContext: event.target.checked })}
              />
              Show connected context on canvas
            </label>
            <p>
              Context adds directly connected neighbors outside the matches, within the current
              focus. Filters reset when switching workspaces.
            </p>
          </div>
        </details>
        {error && (
          <p className="entity-filter-error" role="alert">
            {error}
          </p>
        )}
        <div className="entity-result-count">
          <span role="status">
            {nodes.length.toLocaleString()} matches / {totalCount.toLocaleString()} loaded
          </span>
          {activeFilters && (
            <button
              type="button"
              onClick={() => onFiltersChange({})}
              aria-label="Clear entity and graph filters"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
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
          <button
            key={node.id}
            className={`entity-row ${selectedId === node.id ? 'selected' : ''}`}
            aria-pressed={selectedId === node.id}
            onClick={() => onSelect(node.id)}
            title={node.id}
          >
            <span className={`entity-dot ${node.kind}`} />
            <span>
              <strong>{node.label}</strong>
              <small>
                {node.kind} · {formatSats(node.value)}
                {annotations[node.id]?.bookmarked && <Bookmark size={11} aria-label="Bookmarked" />}
              </small>
            </span>
          </button>
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
