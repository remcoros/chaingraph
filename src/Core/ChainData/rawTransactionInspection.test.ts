import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transaction as BitcoinTransaction } from 'bitcoinjs-lib';
import type { Transaction } from './transaction';
import { decodeRawTransaction, fetchRawInspection } from './rawTransactionInspection';

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

describe('raw transaction inspection', () => {
  it('binds decoded SegWit bytes to the selected loaded transaction', () => {
    const { raw, transaction } = fixture(true);
    const result = decodeRawTransaction(raw.toHex(), transaction);
    expect(result.txid).toBe(transaction.txid);
    expect(result.wtxid).not.toBe(result.txid);
    expect(result.inputs[0]).toEqual({ script: '51', witness: ['aa', ''], sequence: 0xfffffffd });
    expect(result.outputs[0].script).toBe('51');
  });

  it('requires the exact coinbase sentinel for a saved coinbase input', () => {
    const raw = new BitcoinTransaction();
    raw.addInput(new Uint8Array(32), 0xffffffff, 0xffffffff, Uint8Array.of(0x51));
    raw.addOutput(Uint8Array.of(0x51), 5000000000n);
    const coinbase: Transaction = {
      txid: raw.getId(),
      vin: [{ coinbase: '51' }],
      vout: [{ n: 0, value: 50, scriptPubKey: { hex: '51' } }],
    };
    expect(decodeRawTransaction(raw.toHex(), coinbase).wtxid).toBe(raw.getId());
    const crafted = { ...coinbase, vin: [{ txid: '00'.repeat(32), vout: 0xffffffff }] };
    expect(() => decodeRawTransaction(raw.toHex(), crafted)).toThrow(/disagrees/);
  });

  it('binds a zero hash at a non-null index structurally without claiming UTXO existence', () => {
    const raw = new BitcoinTransaction();
    raw.addInput(new Uint8Array(32), 0, 0xffffffff, Uint8Array.of(0x51));
    raw.addOutput(Uint8Array.of(0x51), 1000n);
    const transaction: Transaction = {
      txid: raw.getId(),
      vin: [{ txid: '00'.repeat(32), vout: 0 }],
      vout: [{ n: 0, value: 0.00001, scriptPubKey: { hex: '51' } }],
    };
    expect(decodeRawTransaction(raw.toHex(), transaction).txid).toBe(transaction.txid);
  });

  it('rejects mismatched IDs and inconsistent loaded observations', () => {
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
  });
});

afterEach(() => vi.unstubAllGlobals());

it('falls back to Electrum and stops after cancellation', async () => {
  const { raw, transaction } = fixture();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Not available' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ result: raw.toHex() }) });
  vi.stubGlobal('fetch', fetch);
  expect(
    (await fetchRawInspection('testnet4', transaction, new AbortController().signal)).txid,
  ).toBe(transaction.txid);
  expect(JSON.parse(fetch.mock.calls[1][1].body).target).toBe('electrum');
  expect(fetch.mock.calls.map((call) => JSON.parse(call[1].body).network)).toEqual([
    'testnet4',
    'testnet4',
  ]);
  const controller = new AbortController();
  fetch.mockReset().mockImplementation(async () => {
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  });
  await expect(fetchRawInspection('testnet4', transaction, controller.signal)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps a delayed fallback on its original network while another inspection completes', async () => {
  const { raw, transaction } = fixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: { network: string; target: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string);
      calls.push({ network: request.network, target: request.target });
      if (request.network === 'mainnet' && request.target === 'core') {
        await waiting;
        return { ok: false, json: async () => ({ error: 'Not available' }) };
      }
      return { ok: true, json: async () => ({ result: raw.toHex() }) };
    }),
  );
  const mainnet = fetchRawInspection('mainnet', transaction, new AbortController().signal);
  const testnet = await fetchRawInspection('testnet4', transaction, new AbortController().signal);
  expect(testnet.txid).toBe(transaction.txid);
  release();
  expect((await mainnet).txid).toBe(transaction.txid);
  expect(calls).toEqual([
    { network: 'mainnet', target: 'core' },
    { network: 'testnet4', target: 'core' },
    { network: 'mainnet', target: 'electrum' },
  ]);
});
