import { useId, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { AnchoredPopover } from '../../../Controls/AnchoredPopover';
import { WalletHelp } from '../../../Controls/Display/WalletHelp';

export interface WalletCategoryOption {
  id: string;
  label: string;
  description: string;
  count: number;
  note?: string;
}

export function WalletCategoryFilter({
  active,
  categories,
  selected,
  onChange,
  title = 'Wallet finding types',
  countHelp = 'Show items that match any selected type and your other filters. An item can match several types, so counts may overlap. A zero means no matching items are listed. These choices filter the list; choose Analyze to look for new findings.',
}: {
  active: boolean;
  title?: string;
  countHelp?: string;
  categories: readonly WalletCategoryOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  // Adjusting during render rather than in an effect: losing the control closes
  // its popover in the same pass, with no extra render showing it still open.
  if (open && !active) setOpen(false);
  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-expanded={active && open}
        aria-controls={active && open ? id : undefined}
        onClick={(event) => {
          setTrigger(event.currentTarget);
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <ListFilter size={14} /> Finding types
        <span className="wallet-count">
          {selected.length === categories.length ? 'All' : selected.length || 'None'}
        </span>
      </button>
      {active && open && trigger && (
        <AnchoredPopover
          id={id}
          anchor={trigger}
          title={title}
          width={390}
          onClose={() => setOpen(false)}
        >
          <div className="button-row wallet-category-tools">
            <button
              aria-label="Reset to all types"
              onClick={() => onChange(categories.map((category) => category.id))}
            >
              All types
            </button>
            <button onClick={() => onChange([])}>Clear types</button>
            <WalletHelp title="Finding type counts" active={active && open}>
              {countHelp}
            </WalletHelp>
          </div>
          <fieldset className="wallet-category-options">
            <legend className="wallet-category-legend">
              {selected.length}/{categories.length} types
            </legend>
            {categories.map((category) => (
              <div key={category.id}>
                <div className="wallet-category-option">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={category.label}
                      checked={selected.includes(category.id)}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? [...selected, category.id]
                            : selected.filter((entry) => entry !== category.id),
                        )
                      }
                    />
                    <span title={category.label}>{category.label}</span>
                    <span className="wallet-count">{category.count}</span>
                  </label>
                  <WalletHelp title={category.label} active={active && open}>
                    <p>{category.description}</p>
                    {category.note && <p className="muted">{category.note}</p>}
                  </WalletHelp>
                </div>
              </div>
            ))}
          </fieldset>
        </AnchoredPopover>
      )}
    </>
  );
}
