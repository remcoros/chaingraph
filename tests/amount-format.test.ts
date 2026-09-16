import { describe, expect, it } from 'vitest';
import { formatBitcoinAmount, formatSats } from '../src/Domain/Chain/amountFormat';
import { activeFilterChips } from '../src/App/Workspace/Workbenches/Graph/Filters/filterPresentation';

describe('exact Bitcoin amount display', () => {
  it.each([
    [0, '0.00\u2009000\u2009000\u2009BTC'],
    [1, '0.00\u2009000\u2009001\u2009BTC'],
    [-1, '-0.00\u2009000\u2009001\u2009BTC'],
    [999, '0.00\u2009000\u2009999\u2009BTC'],
    [25_000, '0.00\u2009025\u2009000\u2009BTC'],
    [99_999_999, '0.99\u2009999\u2009999\u2009BTC'],
    [100_000_000, '1.00\u2009000\u2009000\u2009BTC'],
    [100_000_001, '1.00\u2009000\u2009001\u2009BTC'],
    [123_456_789, '1.23\u2009456\u2009789\u2009BTC'],
    [-123_456_789, '-1.23\u2009456\u2009789\u2009BTC'],
    [2_100_000_000_000_000, '21\u2009000\u2009000.00\u2009000\u2009000\u2009BTC'],
  ])('formats %s satoshis without rounding or dropping digits', (value, expected) => {
    expect(formatBitcoinAmount(value)).toBe(expected);
    expect(formatBitcoinAmount(BigInt(value))).toBe(expected);
  });

  it('preserves bigint aggregates beyond number precision', () => {
    expect(formatBitcoinAmount(9_007_199_254_740_993n)).toBe(
      '90\u2009071\u2009992.54\u2009740\u2009993\u2009BTC',
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
    expect(formatSats(100_000_000)).toBe('100\u2009000\u2009000\u2009sats');
  });

  it('uses BTC at both ends of a filter range', () => {
    const [chip] = activeFilterChips({ minSats: 25_000, maxSats: 123_456_789 });
    expect(chip.label).toBe('0.00\u2009025\u2009000\u2009BTC – 1.23\u2009456\u2009789\u2009BTC');
  });
});
