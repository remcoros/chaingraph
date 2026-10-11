import { expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTimeFormat';

it.each([
  ['2022-01-15T12:00:00Z', '2026-04-17T12:00:00Z', '4y 3m 2d ago'],
  ['2024-01-31T12:00:00Z', '2024-03-01T12:00:00Z', '1m 1d ago'],
  ['2025-01-01T12:00:00Z', '2025-01-03T15:00:00Z', '2d 3h ago'],
  ['2025-01-01T12:00:00Z', '2025-01-01T14:14:00Z', '2h 14m ago'],
  ['2025-01-01T12:00:00Z', '2025-01-01T12:03:25Z', '3m 25s ago'],
  ['2025-01-01T12:00:00Z', '2025-01-01T12:00:25Z', '25s ago'],
  ['2025-01-01T12:00:00Z', '2025-01-01T12:00:03Z', 'Just now'],
  ['2025-01-01T12:03:25Z', '2025-01-01T12:00:00Z', 'in 3m 25s'],
])('formats %s relative to %s with appropriate precision', (timestamp, now, expected) => {
  expect(formatRelativeTime(Date.parse(timestamp), Date.parse(now))).toBe(expected);
});

it('keeps invalid timestamps absent', () => {
  expect(formatRelativeTime(NaN, 0)).toBeUndefined();
  expect(formatRelativeTime(0, Infinity)).toBeUndefined();
});
