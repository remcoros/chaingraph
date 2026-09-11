/** Monetary displays take integer satoshis. Stored values and numeric inputs stay unchanged. */
const GROUP = '\u202f';
const UNIT_SPACE = '\u00a0';
const SATS_PER_BTC = 100_000_000n;

function integerSats(value?: number | bigint): bigint | undefined {
  if (typeof value === 'bigint') return value;
  return value !== undefined && Number.isSafeInteger(value) ? BigInt(value) : undefined;
}

const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);

/** Explicit satoshi denomination for surfaces whose unit is fixed. */
export function formatSats(value?: number | bigint): string {
  const amount = integerSats(value);
  if (amount === undefined) return 'Unknown value';
  const magnitude = amount < 0n ? -amount : amount;
  return `${grouped(amount.toString())}${UNIT_SPACE}${magnitude === 1n ? 'sat' : 'sats'}`;
}

/** Exact BTC display with eight decimal places grouped from the right. */
export function formatBitcoinAmount(value?: number | bigint): string {
  const amount = integerSats(value);
  if (amount === undefined) return 'Unknown value';
  const magnitude = amount < 0n ? -amount : amount;
  const whole = grouped((magnitude / SATS_PER_BTC).toString());
  const fraction = grouped((magnitude % SATS_PER_BTC).toString().padStart(8, '0'));
  return `${amount < 0n ? '-' : ''}${whole}.${fraction}${UNIT_SPACE}BTC`;
}
