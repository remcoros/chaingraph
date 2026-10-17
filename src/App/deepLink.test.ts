import { describe, expect, it } from 'vitest';
import { parseLookupFragment } from './deepLink';

const txid = 'a'.repeat(64);
// Public BIP173 test vector.
const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

describe('parseLookupFragment', () => {
  it('reads a transaction id from #?s=', () => {
    expect(parseLookupFragment(`#?s=${txid}`)).toBe(txid);
  });

  it('reads an outpoint from #?s=', () => {
    expect(parseLookupFragment(`#?s=${txid}:0`)).toBe(`${txid}:0`);
  });

  it('reads an address from #?s=', () => {
    expect(parseLookupFragment(`#?s=${address}`)).toBe(address);
  });

  it('keeps other parameters and returns the first s value', () => {
    expect(parseLookupFragment(`#?s=${txid}&x=1`)).toBe(txid);
    expect(parseLookupFragment(`#?s=${txid}&s=${'b'.repeat(64)}`)).toBe(txid);
  });

  it('trims surrounding whitespace', () => {
    expect(parseLookupFragment(`#?s=%20${txid}%20`)).toBe(txid);
  });

  it('ignores in-app anchors and non-lookup fragments', () => {
    expect(parseLookupFragment('#main-workspace')).toBeUndefined();
    expect(parseLookupFragment('#graph-workspace')).toBeUndefined();
    expect(parseLookupFragment('#')).toBeUndefined();
    expect(parseLookupFragment('')).toBeUndefined();
    expect(parseLookupFragment('#?foo=bar')).toBeUndefined();
    expect(parseLookupFragment('#?s=')).toBeUndefined();
    expect(parseLookupFragment('#?s=%20%09')).toBeUndefined();
  });
});
