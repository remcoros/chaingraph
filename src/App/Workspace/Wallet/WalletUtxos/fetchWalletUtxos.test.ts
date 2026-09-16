import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Network } from '../../../../Domain/Chain/network';
import type { Wallet } from '../../../../Domain/Wallet/walletTypes';
import { fetchWalletUtxos } from './fetchWalletUtxos';
import { addressToScriptHash } from '../../../../Domain/Wallet/wallet';

const id = (n: number) => n.toString(16).padStart(64, '0');
function wallet(count = 1, network: Network = 'mainnet'): Wallet {
  return {
    id: 'wallet',
    name: 'Wallet',
    key: '',
    color: '#ffffff',
    scriptType: 'p2wpkh',
    addresses: Array.from({ length: count }, (_, index) => {
      const bytes = new Uint8Array(20);
      new DataView(bytes.buffer).setUint32(0, index);
      const address = bitcoinAddress.toBech32(bytes, 0, network === 'mainnet' ? 'bc' : 'tb');
      return {
        address,
        index,
        branch: 0,
        path: `account/0/${index}`,
        scripthash: addressToScriptHash(address, network),
      };
    }),
  };
}
const unspent = { tx_hash: id(1), tx_pos: 2, value: 546, height: 100 };
const reply = (result: unknown) => ({ ok: true, json: async () => ({ result }) });
const respond = (result: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(result)));
afterEach(() => vi.unstubAllGlobals());

describe('wallet UTXO observation fetching', () => {
  it('uses isolated network requests, includes mempool records, deduplicates and sorts results', async () => {
    respond([unspent, unspent, { ...unspent, tx_hash: id(2), height: 0 }]);
    const input = wallet();
    const result = await fetchWalletUtxos('mainnet', input);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      network: 'mainnet',
      target: 'electrum',
      method: 'blockchain.scripthash.listunspent',
      params: [input.addresses[0].scripthash],
    });
    expect(result).toMatchObject({
      network: 'mainnet',
      walletId: input.id,
      checkedAddresses: 1,
      successfulAddresses: 1,
      totalAddresses: 1,
      nextCursor: undefined,
      errors: [],
    });
    expect(result.records.map((record) => record.txid)).toEqual([id(2), id(1)]);
    expect(result.records[1]).toMatchObject({
      address: input.addresses[0].address,
      scripthash: input.addresses[0].scripthash,
      vout: 2,
      valueSats: 546,
    });
    await fetchWalletUtxos('testnet4', wallet(1, 'testnet4'));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).network).toBe('testnet4');
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
  });
  it('limits each action to 100 addresses and four requests, with absolute progress and continuation', async () => {
    let active = 0,
      peak = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return reply([]);
      }),
    );
    const input = wallet(103);
    const first = await fetchWalletUtxos('mainnet', input);
    expect(fetch).toHaveBeenCalledTimes(100);
    expect(peak).toBe(4);
    expect(first).toMatchObject({
      checkedAddresses: 100,
      successfulAddresses: 100,
      nextCursor: 100,
      totalAddresses: 103,
    });
    const progress = vi.fn();
    const last = await fetchWalletUtxos('mainnet', input, {
      cursor: first.nextCursor,
      onProgress: progress,
    });
    expect(fetch).toHaveBeenCalledTimes(103);
    expect(last).toMatchObject({
      checkedAddresses: 103,
      successfulAddresses: 3,
      nextCursor: undefined,
    });
    expect(progress).toHaveBeenLastCalledWith(103, 103);
  });
  it.each([
    null,
    {},
    [{ ...unspent, tx_hash: 'bad' }],
    [{ ...unspent, tx_pos: -1 }],
    [{ ...unspent, tx_pos: 0x100000000 }],
    [{ ...unspent, value: 0.5 }],
    [{ ...unspent, value: 2_100_000_000_000_001 }],
    [{ ...unspent, value: -1 }],
    [{ ...unspent, height: -1 }],
    [{ ...unspent, height: 0.5 }],
    Array(10_001).fill(unspent),
  ])(
    'rejects malformed/bounded responses without reporting an empty complete wallet',
    async (response) => {
      respond(response);
      const result = await fetchWalletUtxos('mainnet', wallet());
      expect(result.records).toEqual([]);
      expect(result.successfulAddresses).toBe(0);
      expect(result.errors).toHaveLength(1);
    },
  );
  it('preserves other addresses when one request fails and never exposes upstream exception text', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('Sensitive upstream detail'))
        .mockResolvedValue(reply([unspent])),
    );
    const result = await fetchWalletUtxos('mainnet', wallet(2));
    expect(result.records).toHaveLength(1);
    expect(result).toMatchObject({ successfulAddresses: 1, checkedAddresses: 2 });
    expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Sensitive upstream detail');
  });
  it('rejects contradictory duplicate outpoints instead of selecting whichever request arrives first', async () => {
    respond([unspent]);
    const acrossAddresses = await fetchWalletUtxos('mainnet', wallet(2));
    expect(acrossAddresses.records).toEqual([]);
    expect(acrossAddresses.errors).toHaveLength(1);
    respond([unspent, { ...unspent, value: 547 }]);
    const sameAddress = await fetchWalletUtxos('mainnet', wallet());
    expect(sameAddress.records).toEqual([]);
    expect(sameAddress.errors).toHaveLength(1);
  });
  it('validates all address claims and cursor before RPC, including network mismatch', async () => {
    respond([]);
    await expect(fetchWalletUtxos('testnet4', wallet())).rejects.toThrow('Invalid address');
    const invalid = wallet(2);
    invalid.addresses[1].scripthash = id(999);
    await expect(fetchWalletUtxos('mainnet', invalid)).rejects.toThrow('script hash');
    for (const cursor of [-1, 0.5, 2])
      await expect(fetchWalletUtxos('mainnet', wallet(), { cursor })).rejects.toThrow(
        'continuation',
      );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('queries duplicate valid address claims once', async () => {
    respond([]);
    const input = wallet();
    input.addresses.push({ ...input.addresses[0] });
    expect((await fetchWalletUtxos('mainnet', input)).totalAddresses).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('discards late results and stops new requests when cancelled', async () => {
    const controller = new AbortController();
    const deliveries: ((value: ReturnType<typeof reply>) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => deliveries.push(resolve))),
    );
    const pending = fetchWalletUtxos('mainnet', wallet(10), { signal: controller.signal });
    await vi.waitFor(() => expect(deliveries).toHaveLength(4));
    controller.abort();
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    for (const deliver of deliveries) deliver(reply([unspent]));
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
    await expect(
      fetchWalletUtxos('mainnet', wallet(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
