import { describe, expect, it } from 'vitest';
import { Transaction as BitcoinTransaction } from 'bitcoinjs-lib';
import { decodeRawTransaction } from './rawTransaction';
import { inspectScript } from './scripts';

function fixture(witness = false) {
  const raw = new BitcoinTransaction();
  raw.addInput(
    Uint8Array.from({ length: 32 }, () => 0x11),
    3,
    0xfffffffd,
    Uint8Array.of(0x51),
  );
  raw.addOutput(Uint8Array.of(0x51), 12345n);
  if (witness) raw.setWitness(0, [Uint8Array.of(0xaa), new Uint8Array()]);
  return raw;
}

describe('native raw transaction decoding', () => {
  it('decodes SegWit bytes without confusing the transaction and witness IDs', () => {
    const raw = fixture(true);
    const result = decodeRawTransaction(raw.toHex());
    expect(result.txid).toBe(raw.getId());
    expect(result.wtxid).not.toBe(result.txid);
    expect(result.inputs[0]).toEqual({
      txid: '11'.repeat(32),
      vout: 3,
      coinbase: false,
      script: '51',
      witness: ['aa', ''],
      sequence: 0xfffffffd,
    });
    expect(result.outputs[0]).toEqual({ value: 12345n, script: '51' });
    expect(result.weight).toBe(raw.weight());
  });

  it('uses the actual serialized coinbase transaction ID for a non-witness transaction', () => {
    const raw = new BitcoinTransaction();
    raw.addInput(new Uint8Array(32), 0xffffffff, 0xffffffff, Uint8Array.of(0x51));
    raw.addOutput(Uint8Array.of(0x51), 5000000000n);
    const result = decodeRawTransaction(raw.toHex());
    expect(result.wtxid).toBe(raw.getId());
    expect(result.inputs[0].coinbase).toBe(true);
  });

  it('rejects malformed, trailing and oversized raw transaction data before publishing a decode', () => {
    const raw = fixture();
    for (const data of [null, {}, 'f', 'zz', '00', raw.toHex() + '00', '00'.repeat(4_000_001)])
      expect(() => decodeRawTransaction(data)).toThrow();
  });
});

describe('script assembly inspection', () => {
  it('distinguishes unknown scripts, empty scripts, malformed pushes and normalized opcodes', () => {
    expect(inspectScript(undefined)).toEqual({});
    expect(inspectScript('')).toEqual({ hex: '', asm: '(empty script)' });
    expect(inspectScript('76a914' + '11'.repeat(20) + '88ac').asm).toBe(
      'OP_DUP OP_HASH160 ' + '11'.repeat(20) + ' OP_EQUALVERIFY OP_CHECKSIG',
    );
    expect(inspectScript('4c05aa')).toMatchObject({
      hex: '4c05aa',
      error: expect.stringMatching(/Malformed/),
    });
    expect(inspectScript('zz').error).toMatch(/Invalid/);
  });
});
