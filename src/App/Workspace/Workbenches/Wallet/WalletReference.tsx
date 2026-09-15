import { CopyButton } from '../../../Controls/CopyButton';
import { ResponsiveIdentifier } from '../../../Controls/Display/ResponsiveIdentifier';

export function WalletReference({
  value,
  kind,
}: {
  value: string;
  kind: 'address' | 'outpoint' | 'transaction ID';
}) {
  return (
    <span className="wallet-reference">
      <code title={value}>
        <ResponsiveIdentifier value={value} />
      </code>
      <CopyButton value={value} label={`Copy ${kind}`} />
    </span>
  );
}
