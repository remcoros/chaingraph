import { describe, expect, it } from 'vitest';
import { short } from './referenceFormat';

describe('consistent shortened references', () => {
  const txid = '1234567' + 'a'.repeat(50) + 'abcdefg';
  const validTxid = '1234567' + 'a'.repeat(50) + 'abcdef0';
  const address = 'bc1qabcdef012345678901234567890123456789';

  it('uses exactly eight characters at each end and three dots', () => {
    expect(short(txid)).toBe('1234567a...aabcdefg');
    expect(short(address)).toBe('bc1qabcd...23456789');
    expect(short('small reference')).toBe('small reference');
  });

  it('formats canonical IDs like their raw identifiers without altering the originals', () => {
    expect(short(`tx:${validTxid}`)).toBe(short(validTxid));
    expect(short(`addr:${address}`)).toBe(short(address));
  });

  it('keeps the full output index separate from the trailing hash characters', () => {
    for (const index of [0, 9, 100, 4294967295]) {
      const expected = `1234567a...aabcdef0:${index}`;
      expect(short(`${validTxid}:${index}`)).toBe(expected);
      expect(short(`out:${validTxid}:${index}`)).toBe(expected);
    }
  });
});
