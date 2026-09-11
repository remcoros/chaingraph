import { describe, expect, it } from 'vitest';
import { formatBitcoinAmount, formatSats } from '../src/domain/amountFormat';
import { activeFilterChips } from '../src/domain/graphFilters';

describe('exact Bitcoin amount display', () => {
  it.each([
    [0, '0\u00a0sats'],
    [1, '1\u00a0sat'],
    [-1, '-1\u00a0sat'],
    [999, '999\u00a0sats'],
    [25_000, '25\u202f000\u00a0sats'],
    [99_999_999, '99\u202f999\u202f999\u00a0sats'],
    [100_000_000, '1.00\u202f000\u202f000\u00a0BTC'],
    [100_000_001, '1.00\u202f000\u202f001\u00a0BTC'],
    [123_456_789, '1.23\u202f456\u202f789\u00a0BTC'],
    [-123_456_789, '-1.23\u202f456\u202f789\u00a0BTC'],
    [2_100_000_000_000_000, '21\u202f000\u202f000.00\u202f000\u202f000\u00a0BTC'],
  ])('formats %s satoshis without rounding or dropping digits', (value, expected) => {
    expect(formatBitcoinAmount(value)).toBe(expected);
    expect(formatBitcoinAmount(BigInt(value))).toBe(expected);
  });

  it('preserves bigint aggregates beyond number precision', () => {
    expect(formatBitcoinAmount(9_007_199_254_740_993n)).toBe(
      '90\u202f071\u202f992.54\u202f740\u202f993\u00a0BTC',
    );
  });

  it.each([undefined, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'keeps invalid or missing value %s distinct from zero',
    (value) => {
      expect(formatBitcoinAmount(value)).toBe('Unknown value');
      expect(formatSats(value)).toBe('Unknown value');
    },
  );

  it('keeps explicitly requested sats in their declared denomination', () => {
    expect(formatSats(100_000_000)).toBe('100\u202f000\u202f000\u00a0sats');
  });

  it('labels both ends of filter ranges that cross the unit boundary', () => {
    const [chip] = activeFilterChips({ minSats: 25_000, maxSats: 123_456_789 });
    expect(chip.label).toBe('25\u202f000\u00a0sats – 1.23\u202f456\u202f789\u00a0BTC');
  });
});
