import { describe, expect, it } from 'vitest';
import { ancestryNotice } from './ancestryNotice';

const complete = {
  transactions: [],
  failed: 0,
  truncated: false,
  resolvedTransactionIds: ['a'.repeat(64)],
  previousTransactionIds: ['b'.repeat(64)],
};
describe('ancestry progress explanation', () => {
  it('keeps an ordinary completed expansion quiet', () => {
    expect(ancestryNotice(complete)).toBe('');
  });
  it('describes a coinbase root without a zero-added failure message', () => {
    expect(ancestryNotice({ ...complete, previousTransactionIds: [] })).toBe(
      'Coinbase transaction: no previous inputs to load.',
    );
  });
  it('preserves retry guidance for an unavailable branch', () => {
    expect(ancestryNotice({ ...complete, failed: 1 })).toBe(
      '1 previous transaction could not be loaded. Retry the path to continue.',
    );
  });
});
