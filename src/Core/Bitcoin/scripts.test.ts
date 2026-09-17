import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  addressToScript,
  addressToScriptHash,
  scriptHash,
  scriptHashHex,
  scriptToAddress,
} from './scripts';

const taproot = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';

describe('network-aware script primitives', () => {
  it('round-trips a BIP86 Taproot output script without relying on bitcoinjs address decoding', () => {
    const script = addressToScript(taproot, 'mainnet');
    expect(bytesToHex(script)).toMatch(/^5120[0-9a-f]{64}$/);
    expect(scriptToAddress(script, 'mainnet')).toBe(taproot);
    expect(scriptToAddress(script, 'testnet4')).toMatch(/^tb1p/);
  });

  it('uses one byte-level Electrum hash implementation for address and hex inputs', () => {
    const script = addressToScript('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'mainnet');
    const hex = bytesToHex(script);
    expect(scriptHashHex(hex)).toBe(scriptHash(script));
    expect(addressToScriptHash('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'mainnet')).toBe(
      scriptHashHex(hex),
    );
  });

  it('keeps malformed script hex and foreign-network addresses invalid', () => {
    expect(() => scriptHashHex('abc')).toThrow('Invalid Bitcoin script hex');
    expect(() => addressToScript(taproot, 'testnet4')).toThrow('Invalid address');
  });
});
