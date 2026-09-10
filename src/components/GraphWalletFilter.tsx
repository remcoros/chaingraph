import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Wallet } from 'lucide-react';
import { selectedWalletFilterIds, type GraphFilters } from '../domain/graphFilters';
import { AnchoredPopover } from './AnchoredPopover';
import './graph-filters.css';

interface WalletFilterProps {
  filters: GraphFilters;
  wallets: readonly { id: string; name: string; color?: string }[];
  onChange: (filters: GraphFilters) => void;
}

/** Shared choices for the toolbar dropdown and the full filter panel. */
export function WalletFilterOptions({
  filters,
  wallets,
  onChange,
  autofocus = false,
}: WalletFilterProps & { autofocus?: boolean }) {
  const selected = selectedWalletFilterIds(filters);
  const [query, setQuery] = useState('');
  const options = [
    ...wallets,
    ...selected
      .filter((id) => !wallets.some((wallet) => wallet.id === id))
      .map((id) => ({ id, name: 'Removed wallet', color: undefined })),
  ];
  const matching = options.filter((wallet) =>
    wallet.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const update = (ids: string[]) =>
    onChange({ ...filters, walletId: undefined, walletIds: ids.length ? ids : undefined });
  return (
    <div className="wallet-filter-options">
      <div className="wallet-filter-tools">
        <span className="small muted">
          {selected.length ? 'Matches any selected wallet' : 'No wallet filter'}
        </span>
        <button
          type="button"
          className="text-button"
          disabled={!selected.length}
          onClick={() => update([])}
        >
          Clear
        </button>
      </div>
      {(options.length > 8 || query) && (
        <input
          type="search"
          data-autofocus={autofocus || undefined}
          aria-label="Find wallets"
          placeholder="Find wallets"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className="wallet-filter-list" role="group" aria-label="Wallet choices">
        {matching.map((wallet, index) => (
          <label key={wallet.id} className="wallet-filter-option">
            <input
              type="checkbox"
              data-autofocus={autofocus && options.length <= 8 && index === 0 ? true : undefined}
              checked={selected.includes(wallet.id)}
              disabled={!selected.includes(wallet.id) && selected.length >= 100}
              title={
                !selected.includes(wallet.id) && selected.length >= 100
                  ? 'Clear a selection before adding another wallet (100 maximum).'
                  : undefined
              }
              onChange={(event) =>
                update(
                  event.target.checked
                    ? [...selected, wallet.id]
                    : selected.filter((id) => id !== wallet.id),
                )
              }
            />
            <span className="wallet-filter-dot" style={{ backgroundColor: wallet.color }} />
            <span>{wallet.name}</span>
          </label>
        ))}
        {!matching.length && (
          <p className="small muted">
            {options.length ? 'No matching wallets.' : 'No imported wallets.'}
          </p>
        )}
      </div>
    </div>
  );
}

export function GraphWalletFilter({
  active = true,
  ...props
}: WalletFilterProps & { active?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const count = selectedWalletFilterIds(props.filters).length;
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`graph-filter-trigger ${count ? 'active' : ''}`}
        aria-label={count ? `Wallets, ${count} selected` : 'Wallets'}
        title="Filter by associated wallets"
        aria-haspopup="dialog"
        aria-expanded={active && open}
        aria-controls={active && open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Wallet size={14} /> Wallets
        {count > 0 && <span className="graph-filter-count">{count}</span>}
        <ChevronDown size={12} />
      </button>
      {active && open && trigger.current && (
        <AnchoredPopover
          id={id}
          anchor={trigger.current}
          title="Wallets"
          width={320}
          onClose={() => setOpen(false)}
        >
          <WalletFilterOptions {...props} autofocus />
        </AnchoredPopover>
      )}
    </>
  );
}
