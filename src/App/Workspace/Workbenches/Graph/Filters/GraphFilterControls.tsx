import { useId, useState, type ReactNode } from 'react';
import { Filter, RotateCcw, X } from 'lucide-react';
import {
  activeFilterChips,
  activeFilterKeys,
  clearFilterKey,
  type FilterKey,
} from './filterPresentation';
import {
  valueFilterError,
  selectedWalletFilterIds,
} from '../../../../../Domain/Graph/graphFilters';
import type { GraphFilters } from '../../../../../Domain/types';
import { AnchoredPopover } from '../../../../Controls/AnchoredPopover';
import { Amount } from '../../../../Controls/Display/Amount';
import { WalletFilterOptions } from './GraphWalletFilter';
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
  const [shown, setShown] = useState(value);
  // Adjusting during render rather than in an effect, so the field never paints
  // a stale entry for a frame. Object.is keeps an unparsable entry, which
  // reports NaN, from counting as a change on every render.
  if (!Object.is(shown, value)) {
    setShown(value);
    if (value === undefined || Number.isFinite(value)) setText(value?.toString() ?? '');
  }
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={0}
      max={2_100_000_000_000_000}
      step={1}
      placeholder="No limit"
      value={text}
      aria-invalid={
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < 0 || value > 2_100_000_000_000_000)
      }
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        onChange(
          raw === '' && !event.currentTarget.validity.badInput
            ? undefined
            : event.currentTarget.valueAsNumber,
        );
      }}
    />
  );
}

export interface FilterFieldProps {
  filters: GraphFilters;
  onChange: (filters: GraphFilters) => void;
  wallets?: readonly { id: string; name: string; color?: string }[];
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
  const selectedWallets = selectedWalletFilterIds(filters);
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
          value={filters.walletMatch ?? 'all'}
          onChange={(event) =>
            patch({
              walletMatch:
                event.target.value === 'all'
                  ? undefined
                  : (event.target.value as GraphFilters['walletMatch']),
            })
          }
        >
          <option value="all">Any wallet state</option>
          <option value="matched">Matches an imported wallet</option>
          <option value="unmatched">No wallet match</option>
        </select>
      </label>
      <details className="wallet-filter-details">
        <summary>
          Wallets{selectedWallets.length ? ` · ${selectedWallets.length} selected` : ''}
        </summary>
        <WalletFilterOptions filters={filters} wallets={wallets} onChange={onChange} />
      </details>
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
    </div>
  );
}

/** Context is an action on filtered results, not a filter or selection expansion. */
export function GraphConnectionsAction({
  filters,
  onChange,
  extraNodeCount = 0,
  pending = false,
}: {
  filters: GraphFilters;
  onChange: (filters: GraphFilters) => void;
  extraNodeCount?: number;
  pending?: boolean;
}) {
  const enabled = filters.preserveContext ?? false;
  if (!enabled && extraNodeCount === 0) return null;
  return (
    <button
      type="button"
      className="text-button graph-connections-action"
      disabled={!enabled && pending}
      title={
        enabled
          ? 'Return to filter matches and cancel any unfinished connection layout.'
          : 'Add loaded nodes one connection from these filter matches to the canvas. Does not fetch more data.'
      }
      onClick={(event) => {
        // Turning context off can remove this action after the result count settles.
        if (enabled) event.currentTarget.parentElement?.focus();
        onChange({ ...filters, preserveContext: !enabled });
      }}
    >
      {enabled
        ? 'Hide connections'
        : pending
          ? 'Show connections'
          : `Show connections (+${extraNodeCount.toLocaleString()})`}
    </button>
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
  names?: { walletName?: string; walletNames?: string[]; tagName?: string };
  hiddenCount?: number;
  onShowAllHidden?: () => void;
  onReset?: () => void;
  extraFiltersActive?: boolean;
  children?: ReactNode;
}) {
  const chips = activeFilterChips(filters, names);
  if (!chips.length && !hiddenCount && !children) return null;
  return (
    <div className="filter-chips" aria-label="Active graph filters" tabIndex={-1}>
      {chips.map((chip) => (
        <span key={chip.key} className={`filter-chip filter-chip-${chip.kind}`}>
          <span title={chip.key === 'value' ? chip.label : undefined}>
            {chip.key !== 'value' ? (
              chip.label
            ) : filters.minSats !== undefined && filters.maxSats !== undefined ? (
              <>
                <Amount value={filters.minSats} /> – <Amount value={filters.maxSats} />
              </>
            ) : filters.minSats !== undefined ? (
              <>
                Min <Amount value={filters.minSats} />
              </>
            ) : (
              <>
                Max <Amount value={filters.maxSats} />
              </>
            )}
          </span>
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
  title = 'Filter the graph and entity list',
  ...props
}: FilterFieldProps & {
  className?: string;
  triggerLabel?: string;
  onReset?: () => void;
  extraFiltersActive?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  const count =
    activeFilterKeys(props.filters).filter((key) => key !== 'preserveContext').length +
    Number(extraFiltersActive);
  return (
    <>
      <button
        ref={setTrigger}
        type="button"
        className={`graph-filter-trigger ${count ? 'active' : ''} ${className ?? ''}`}
        aria-label={count ? `${triggerLabel}, ${count} active` : triggerLabel}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Filter size={14} />
        <span className="graph-nav-caption">{triggerLabel}</span>
        {count > 0 && <span className="graph-filter-count">{count}</span>}
      </button>
      {open && trigger && (
        <AnchoredPopover
          id={id}
          anchor={trigger}
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
