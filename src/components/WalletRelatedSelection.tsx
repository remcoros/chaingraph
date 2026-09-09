import { useEffect, useId, useRef, useState } from 'react';
import { CheckSquare, ChevronDown } from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
import { matchRelatedEntities } from '../domain/walletReviewContext';

type Candidate = { id: string; address?: string; txid?: string };

/** Explicit expansion within the current results, not a clustering heuristic. */
export function WalletRelatedSelection({
  active,
  candidates,
  seeds,
  onSelect,
}: {
  active: boolean;
  candidates: Candidate[];
  seeds: Candidate[];
  onSelect: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  const addresses = matchRelatedEntities(candidates, seeds, 'address');
  const transactions = matchRelatedEntities(candidates, seeds, 'transaction');
  if (!seeds.length || (!addresses.length && !transactions.length)) return null;
  return (
    <>
      <button
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open && active}
        onClick={() => setOpen(!open)}
      >
        <CheckSquare size={13} /> Select related <ChevronDown size={12} />
      </button>
      {open && active && (
        <AnchoredPopover
          id={id}
          anchor={trigger.current!}
          title="Select related results"
          onClose={() => setOpen(false)}
          width={300}
        >
          <p>
            Replace the selection with exact matches in this filtered list, including results under
            Show more. No other wallets or graph entities are added.
          </p>
          <button
            disabled={!addresses.length}
            onClick={() => {
              onSelect(addresses);
              setOpen(false);
            }}
          >
            Same address <strong>{addresses.length}</strong>
          </button>
          <button
            disabled={!transactions.length}
            onClick={() => {
              onSelect(transactions);
              setOpen(false);
            }}
          >
            Same transaction <strong>{transactions.length}</strong>
          </button>
          <p>
            Based on {seeds.length} {seeds.length === 1 ? 'selected item' : 'selected items'}.
            Matching an address or transaction does not establish a common owner.
          </p>
        </AnchoredPopover>
      )}
    </>
  );
}
