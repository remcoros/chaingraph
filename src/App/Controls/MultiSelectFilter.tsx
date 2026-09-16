import { useId, useState, type ReactNode } from 'react';
import { ListFilter } from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
import { WalletHelp as HelpTooltip } from './Display/WalletHelp';

export interface MultiSelectFilterOption {
  id: string;
  label: string;
  description: string;
  count: number;
  note?: string;
}

export interface MultiSelectFilterLabels {
  trigger?: string;
  title?: string;
  optionNoun?: string;
  reset?: string;
  clear?: string;
  countHelpTitle?: string;
  countHelp?: ReactNode;
}

const DEFAULT_LABELS: Required<MultiSelectFilterLabels> = {
  trigger: 'Filter options',
  title: 'Filter options',
  optionNoun: 'options',
  reset: 'All options',
  clear: 'Clear options',
  countHelpTitle: 'Option counts',
  countHelp:
    'Show items that match any selected option and your other filters. An item can match several options, so counts may overlap.',
};

export function MultiSelectFilter({
  active,
  options,
  selectedIds,
  onChange,
  labels,
}: {
  active: boolean;
  options: readonly MultiSelectFilterOption[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  labels?: MultiSelectFilterLabels;
}) {
  const copy = { ...DEFAULT_LABELS, ...labels };
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
        <ListFilter size={14} /> {copy.trigger}
        <span className="multi-select-filter-count">
          {selectedIds.length === options.length ? 'All' : selectedIds.length || 'None'}
        </span>
      </button>
      {active && open && trigger && (
        <AnchoredPopover
          id={id}
          anchor={trigger}
          title={copy.title}
          width={390}
          onClose={() => setOpen(false)}
        >
          <div className="button-row multi-select-filter-tools">
            <button
              aria-label={`Reset to all ${copy.optionNoun}`}
              onClick={() => onChange(options.map((option) => option.id))}
            >
              {copy.reset}
            </button>
            <button onClick={() => onChange([])}>{copy.clear}</button>
            <HelpTooltip title={copy.countHelpTitle} active={active && open}>
              {copy.countHelp}
            </HelpTooltip>
          </div>
          <fieldset className="multi-select-filter-options">
            <legend className="multi-select-filter-legend">
              {selectedIds.length}/{options.length} {copy.optionNoun}
            </legend>
            {options.map((option) => (
              <div key={option.id}>
                <div className="multi-select-filter-option">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={option.label}
                      checked={selectedIds.includes(option.id)}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? [...selectedIds, option.id]
                            : selectedIds.filter((entry) => entry !== option.id),
                        )
                      }
                    />
                    <span title={option.label}>{option.label}</span>
                    <span className="multi-select-filter-count">{option.count}</span>
                  </label>
                  <HelpTooltip title={option.label} active={active && open}>
                    <p>{option.description}</p>
                    {option.note && <p className="muted">{option.note}</p>}
                  </HelpTooltip>
                </div>
              </div>
            ))}
          </fieldset>
        </AnchoredPopover>
      )}
    </>
  );
}
