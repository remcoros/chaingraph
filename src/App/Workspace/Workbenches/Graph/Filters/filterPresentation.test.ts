import { expect, it } from 'vitest';
import { activeFilterChips } from './filterPresentation';

it('uses BTC at both ends of a filter range', () => {
  const [chip] = activeFilterChips({ minSats: 25_000, maxSats: 123_456_789 });
  expect(chip.label).toBe('0.00\u2009025\u2009000\u2009BTC – 1.23\u2009456\u2009789\u2009BTC');
});
