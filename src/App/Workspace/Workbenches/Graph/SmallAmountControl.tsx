import { formatBitcoinAmount } from '../../../../Core/Formatting';
import { SMALL_AMOUNT_PRESETS } from './smallAmounts';

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
        title={`Show input and output amounts strictly above this threshold in the ${context === 'flow' ? 'transaction flow' : '3D/flat graph'} only. Selected outputs remain visible. This is not a dust policy.`}
        value={threshold}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {presets.map((value) => (
          <option key={value} value={value}>
            {value ? `> ${formatBitcoinAmount(value)}` : 'All amounts'}
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
