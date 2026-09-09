import { short } from '../domain/types';
import { CopyButton } from './CopyButton';

export function WalletReference({
  value,
  kind,
  length = 12,
}: {
  value: string;
  kind: 'address' | 'outpoint' | 'transaction ID';
  length?: number;
}) {
  return (
    <span className="wallet-reference">
      <code title={value}>{short(value, length)}</code>
      <CopyButton value={value} label={`Copy ${kind}`} />
    </span>
  );
}
