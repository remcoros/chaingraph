import { formatBitcoinAmount, formatSats } from '../../../Domain/Chain/amountFormat';

/** Shared amount text and exact satoshi tooltip, without adding an interactive control. */
export function Amount({
  value,
  as: Element = 'span',
  className,
  unknown = 'Unknown value',
}: {
  value?: number | bigint;
  as?: 'span' | 'small' | 'strong' | 'dd';
  className?: string;
  unknown?: string;
}) {
  const amount = formatBitcoinAmount(value);
  const known = amount !== 'Unknown value';
  return (
    <Element
      className={['bitcoin-amount', className].filter(Boolean).join(' ')}
      title={known ? formatSats(value) : undefined}
    >
      {known ? amount : unknown}
    </Element>
  );
}
