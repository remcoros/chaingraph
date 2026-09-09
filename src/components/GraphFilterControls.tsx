import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Filter, RotateCcw, X } from 'lucide-react';
import {
  activeFilterChips,
  activeFilterKeys,
  clearFilterKey,
  valueFilterError,
  type FilterKey,
  type GraphFilters,
} from '../domain/graphFilters';
import { AnchoredPopover } from './AnchoredPopover';
import './graph-filters.css';

export function SatoshiBound({
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

export interface FilterFieldProps {
  filters: GraphFilters;
  onChange: (filters: GraphFilters) => void;
  wallets?: readonly { id: string; name: string }[];
  tags?: readonly { id: string; name: string }[];
  /** Optional canvas amount threshold; the transaction flow keeps its own control. */
  amountControl?: ReactNode;
}

/** One implementation of the filter fields, shared by the popover and entity list. */
export function FilterFields({
  filters,
  onChange,
  wallets = [],
  tags = [],
  amountControl,
}: FilterFieldProps) {
  const patch = (change: Partial<GraphFilters>) => onChange({ ...filters, ...change });
  const walletValue = filters.walletId ? `id:${filters.walletId}` : (filters.walletMatch ?? 'all');
  const tagValue = filters.tagId ? `id:${filters.tagId}` : (filters.tagState ?? 'all');
  const error = valueFilterError(filters);
  return (
    <div className="filter-fields">
      <label>
        Entity type
        <select
          aria-label="Entity type filter"
          value={filters.kind ?? 'all'}
          onChange={(event) => patch({ kind: event.target.value as GraphFilters['kind'] })}
        >
          <option value="all">All types</option>
          <option value="transaction">Transactions</option>
          <option value="output">Outputs</option>
          <option value="address">Addresses</option>
        </select>
      </label>
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
      <label>
        Tags
        <select
          aria-label="Tag membership"
          value={tagValue}
          onChange={(event) => {
            const value = event.target.value;
            patch(
              value.startsWith('id:')
                ? { tagId: value.slice(3), tagState: undefined }
                : {
                    tagId: undefined,
                    tagState: value === 'all' ? undefined : (value as GraphFilters['tagState']),
                  },
            );
          }}
        >
          <option value="all">Any tag state</option>
          <option value="tagged">Has any tag</option>
          <option value="untagged">No tags</option>
          {tags.map((tag) => (
            <option key={tag.id} value={`id:${tag.id}`}>
              Tag: {tag.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Wallet membership
        <select
          aria-label="Wallet membership"
          value={walletValue}
          onChange={(event) => {
            const value = event.target.value;
            patch(
              value.startsWith('id:')
                ? { walletId: value.slice(3), walletMatch: undefined }
                : {
                    walletId: undefined,
                    walletMatch:
                      value === 'all' ? undefined : (value as GraphFilters['walletMatch']),
                  },
            );
          }}
        >
          <option value="all">Any wallet state</option>
          <option value="matched">Matches an imported wallet</option>
          <option value="unmatched">No wallet match</option>
          {wallets.map((wallet) => (
            <option key={wallet.id} value={`id:${wallet.id}`}>
              Wallet: {wallet.name}
            </option>
          ))}
        </select>
      </label>
      <div className="filter-field-pair">
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
      {error && (
        <p className="filter-field-error" role="alert">
          {error}
        </p>
      )}
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
          onChange={(event) => patch({ funding: event.target.value as GraphFilters['funding'] })}
        >
          <option value="all">Any entity</option>
          <option value="missing">Outputs missing funding data</option>
          <option value="loaded">Outputs with funding data</option>
        </select>
      </label>
      <p>
        Spend and funding filters select outputs only. No loaded spend means unknown, not unspent.
        Value limits exclude unknown amounts. Wallet membership comes from derived addresses and is
        not proof of ownership.
      </p>
      {amountControl && (
        <label className="filter-amount-field">
          Canvas amount threshold
          {amountControl}
        </label>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={filters.bookmarkedOnly ?? false}
          onChange={(event) => patch({ bookmarkedOnly: event.target.checked })}
        />
        Bookmarked only
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={filters.preserveContext ?? false}
          onChange={(event) => patch({ preserveContext: event.target.checked })}
        />
        Show connected context on canvas
      </label>
      <p>
        Context adds directly connected neighbors outside the matches. Select matching excludes
        connected context; a context entity you select explicitly stays a batch target.
      </p>
    </div>
  );
}

/** Removable chips for every active filter, plus a filters-only reset. */
export function FilterChips({
  filters,
  onChange,
  names,
  hiddenCount = 0,
  onShowAllHidden,
  onReset,
  extraFiltersActive = false,
  children,
}: {
  filters: GraphFilters;
  onChange: (filters: GraphFilters) => void;
  names?: { walletName?: string; tagName?: string };
  hiddenCount?: number;
  onShowAllHidden?: () => void;
  onReset?: () => void;
  extraFiltersActive?: boolean;
  children?: ReactNode;
}) {
  const chips = activeFilterChips(filters, names);
  if (!chips.length && !hiddenCount && !children) return null;
  return (
    <div className="filter-chips" aria-label="Active graph filters">
      {chips.map((chip) => (
        <span key={chip.key} className={`filter-chip filter-chip-${chip.kind}`}>
          <span>{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove filter: ${chip.label}`}
            title={`Remove filter: ${chip.label}`}
            onClick={() => onChange(clearFilterKey(filters, chip.key as FilterKey))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {children}
      {(chips.length > 0 || extraFiltersActive) && (
        <button
          type="button"
          className="text-button filter-reset"
          title="Clear every graph filter. Manually hidden entities stay hidden."
          onClick={() => (onReset ? onReset() : onChange({}))}
        >
          <RotateCcw size={11} /> Reset filters
        </button>
      )}
      {hiddenCount > 0 && onShowAllHidden && (
        <span className="filter-chip filter-chip-hidden">
          <span>{hiddenCount.toLocaleString('en-US')} hidden manually</span>
          <button
            type="button"
            aria-label={`Show all ${hiddenCount} manually hidden entities`}
            title="Manual hiding is separate from filters and survives Reset filters."
            onClick={onShowAllHidden}
          >
            Show
          </button>
        </span>
      )}
    </div>
  );
}

/** Popover trigger consolidating the canvas filter controls. */
export function GraphFilterButton({
  triggerLabel = 'Filters',
  className,
  onReset,
  extraFiltersActive = false,
  ...props
}: FilterFieldProps & {
  className?: string;
  triggerLabel?: string;
  onReset?: () => void;
  extraFiltersActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const count = activeFilterKeys(props.filters).length + Number(extraFiltersActive);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`graph-filter-trigger ${count ? 'active' : ''} ${className ?? ''}`}
        aria-label={count ? `${triggerLabel}, ${count} active` : triggerLabel}
        title="Filter the graph and entity list"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Filter size={14} />
        <span className="graph-nav-caption">{triggerLabel}</span>
        {count > 0 && <span className="graph-filter-count">{count}</span>}
      </button>
      {open && trigger.current && (
        <AnchoredPopover
          id={id}
          anchor={trigger.current}
          title={triggerLabel === 'Filters' ? 'Graph filters' : triggerLabel}
          width={318}
          className="graph-filter-popover"
          onClose={() => setOpen(false)}
        >
          <FilterFields {...props} />
          <div className="filter-popover-actions">
            <button
              type="button"
              disabled={!count}
              title="Clear every graph filter. Manually hidden entities stay hidden."
              onClick={() => (onReset ? onReset() : props.onChange({}))}
            >
              <RotateCcw size={12} /> Reset filters
            </button>
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
