import { describe, expect, it } from 'vitest';
import { addressNodeId, outputNodeId, short, txNodeId } from '../src/domain/types';

describe('consistent shortened references', () => {
  const txid = '1234567' + 'a'.repeat(50) + 'abcdefg';
  const validTxid = '1234567' + 'a'.repeat(50) + 'abcdef0';
  const address = 'bc1qabcdef012345678901234567890123456789';

  it('uses exactly seven characters at each end and three dots', () => {
    expect(short(txid)).toBe('1234567...abcdefg');
    expect(short(address)).toBe('bc1qabc...3456789');
    expect(short('small reference')).toBe('small reference');
  });

  it('formats canonical IDs like their raw identifiers without altering the originals', () => {
    expect(short(txNodeId(validTxid))).toBe(short(validTxid));
    expect(short(addressNodeId(address))).toBe(short(address));
    expect(txNodeId(validTxid)).toBe(`tx:${validTxid}`);
    expect(addressNodeId(address)).toBe(`addr:${address}`);
  });

  it('keeps the full output index separate from the seven trailing hash characters', () => {
    for (const index of [0, 9, 100, 4294967295]) {
      const expected = `1234567...abcdef0:${index}`;
      expect(short(`${validTxid}:${index}`)).toBe(expected);
      expect(short(outputNodeId(validTxid, index))).toBe(expected);
    }
  });
});
