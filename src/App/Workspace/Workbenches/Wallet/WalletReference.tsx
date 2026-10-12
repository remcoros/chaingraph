import { CopyButton } from '../../../Controls/CopyButton';
import { ResponsiveIdentifier } from '../../../Controls/Display/ResponsiveIdentifier';

export function WalletReference({
  value,
  kind,
  preferFull = false,
}: {
  value: string;
  kind: 'address' | 'outpoint' | 'transaction ID';
  preferFull?: boolean;
}) {
  return (
    <span className="wallet-reference">
      <code title={value}>
        <ResponsiveIdentifier value={value} preferFull={preferFull} />
      </code>
      <CopyButton value={value} label={`Copy ${kind}`} />
    </span>
  );
}
