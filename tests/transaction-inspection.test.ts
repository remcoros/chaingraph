import { describe, expect, it, vi, afterEach } from 'vitest';
import { Transaction as BitcoinTransaction } from 'bitcoinjs-lib';
import {
  decodeRawTransaction,
  inspectScript,
  relatedTransactions,
} from '../src/domain/transactionInspection';
import { fetchRawInspection } from '../src/lib/transactionInspection';
import type { Transaction } from '../src/domain/types';

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
  const transaction: Transaction = {
    txid: raw.getId(),
    vin: [{ txid: '11'.repeat(32), vout: 3 }],
    vout: [{ n: 0, value: 0.00012345, scriptPubKey: { hex: '51' } }],
  };
  return { raw, transaction };
}

describe('display-only raw transaction inspection', () => {
  it('decodes SegWit bytes without confusing txid and witness transaction ID', () => {
    const { raw, transaction } = fixture(true);
    const result = decodeRawTransaction(raw.toHex(), transaction);
    expect(result.txid).toBe(transaction.txid);
    expect(result.wtxid).not.toBe(result.txid);
    expect(result.inputs[0]).toEqual({ script: '51', witness: ['aa', ''], sequence: 0xfffffffd });
    expect(result.outputs[0].script).toBe('51');
    expect(result.weight).toBe(raw.weight());
  });
  it('shows the actual coinbase serialization hash, not the witness-tree zero placeholder', () => {
    const raw = new BitcoinTransaction();
    raw.addInput(new Uint8Array(32), 0xffffffff, 0xffffffff, Uint8Array.of(0x51));
    raw.addOutput(Uint8Array.of(0x51), 5000000000n);
    const tx: Transaction = {
      txid: raw.getId(),
      vin: [{ coinbase: '51' }],
      vout: [{ n: 0, value: 50, scriptPubKey: { hex: '51' } }],
    };
    expect(decodeRawTransaction(raw.toHex(), tx).wtxid).toBe(raw.getId());
  });
  it('rejects mismatched IDs, inconsistent observations and malformed/oversized data', () => {
    const { raw, transaction } = fixture();
    expect(() =>
      decodeRawTransaction(raw.toHex(), { ...transaction, txid: '22'.repeat(32) }),
    ).toThrow(/ID does not match/);
    expect(() =>
      decodeRawTransaction(raw.toHex(), {
        ...transaction,
        vin: [{ txid: '11'.repeat(32), vout: 4 }],
      }),
    ).toThrow(/disagrees/);
    expect(() =>
      decodeRawTransaction(raw.toHex(), {
        ...transaction,
        vout: [{ n: 0, value: 0.00012344, scriptPubKey: { hex: '51' } }],
      }),
    ).toThrow(/disagrees/);
    for (const data of [null, {}, 'f', 'zz', '00', raw.toHex() + '00', '00'.repeat(4_000_001)])
      expect(() => decodeRawTransaction(data, transaction)).toThrow();
  });
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

describe('loaded transaction relationships', () => {
  it('retains creating and all loaded competing spends for the exact selected outpoint', () => {
    const { transaction: creating } = fixture();
    const spending = {
      ...creating,
      txid: '22'.repeat(32),
      vin: [{ txid: creating.txid, vout: 0 }],
    };
    const competing = { ...spending, txid: '33'.repeat(32) };
    const other = { ...spending, txid: '44'.repeat(32), vin: [{ txid: creating.txid, vout: 1 }] };
    const transactions = Object.fromEntries(
      [creating, spending, competing, other].map((tx) => [tx.txid, tx]),
    );
    const selected = {
      kind: 'output' as const,
      id: `out:${creating.txid}:0`,
      txid: creating.txid,
      vout: 0,
      label: '',
    };
    expect(relatedTransactions(transactions, selected).map((item) => item.role)).toEqual([
      'Creating',
      'Spending',
      'Spending',
    ]);
    delete transactions[creating.txid];
    expect(relatedTransactions(transactions, selected).map((item) => item.role)).toEqual([
      'Spending',
      'Spending',
    ]);
  });
});

afterEach(() => vi.unstubAllGlobals());
it('falls back to Electrum and does not continue after cancellation', async () => {
  const { raw, transaction } = fixture();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Not available' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ result: raw.toHex() }) });
  vi.stubGlobal('fetch', fetch);
  expect((await fetchRawInspection(transaction, new AbortController().signal)).txid).toBe(
    transaction.txid,
  );
  expect(JSON.parse(fetch.mock.calls[1][1].body).target).toBe('electrum');
  const controller = new AbortController();
  fetch.mockReset().mockImplementation(async () => {
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  });
  await expect(fetchRawInspection(transaction, controller.signal)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
