import { short } from '../domain/types';
import { CopyButton } from './CopyButton';

export function WalletReference({
  value,
  kind,
}: {
  value: string;
  kind: 'address' | 'outpoint' | 'transaction ID';
}) {
  return (
    <span className="wallet-reference">
      <code title={value}>{short(value)}</code>
      <CopyButton value={value} label={`Copy ${kind}`} />
    </span>
  );
}
