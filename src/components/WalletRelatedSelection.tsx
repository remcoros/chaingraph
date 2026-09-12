import { useEffect, useId, useState } from 'react';
import { CheckSquare, ChevronDown } from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
import { matchRelatedEntities } from '../domain/walletReviewContext';

type Candidate = {
  id: string;
  address?: string;
  txid?: string;
  transactionIds?: readonly string[];
};

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
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
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
        aria-haspopup="dialog"
        aria-expanded={open && active}
        onClick={(event) => {
          setTrigger(event.currentTarget);
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <CheckSquare size={13} /> Select related <ChevronDown size={12} />
      </button>
      {open && active && trigger && (
        <AnchoredPopover
          id={id}
          anchor={trigger}
          title="Select related results"
          onClose={() => setOpen(false)}
          width={300}
        >
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
            title="Match creating transactions for outputs or one-hop context transactions for address groups"
            onClick={() => {
              onSelect(transactions);
              setOpen(false);
            }}
          >
            Same transaction <strong>{transactions.length}</strong>
          </button>
          <p>Exact matches within the current results.</p>
        </AnchoredPopover>
      )}
    </>
  );
}
