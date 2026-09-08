import { SMALL_AMOUNT_PRESETS } from '../domain/smallAmounts';

export function SmallAmountControl({
  threshold = 0,
  onChange,
  hiddenCount,
  context,
}: {
  threshold?: number;
  onChange: (threshold: number) => void;
  hiddenCount?: number;
  context: 'graph' | 'flow';
}) {
  const presets: readonly number[] = SMALL_AMOUNT_PRESETS.some((value) => value === threshold)
    ? SMALL_AMOUNT_PRESETS
    : [...SMALL_AMOUNT_PRESETS, threshold].sort((a, b) => a - b);
  return (
    <span className={`small-amount-control ${threshold ? 'is-active' : ''}`}>
      <select
        aria-label={`Hide small amounts in ${context}`}
        title="Hide inputs and outputs below this amount in the graph and flow. Selected outputs remain visible. This is not a dust policy."
        value={threshold}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {presets.map((value) => (
          <option key={value} value={value}>
            {value ? `< ${value.toLocaleString('en-US')} sats` : 'All amounts'}
          </option>
        ))}
      </select>
      {threshold > 0 && hiddenCount !== undefined && hiddenCount > 0 && (
        <button
          type="button"
          className="text-button small-amount-restore"
          title="Show all amounts. Other graph filters and manually hidden entities remain unchanged."
          aria-label={`Show ${hiddenCount} amount-filtered outputs`}
          onClick={() => onChange(0)}
        >
          {hiddenCount} filtered
        </button>
      )}
    </span>
  );
}
