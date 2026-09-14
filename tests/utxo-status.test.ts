import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentUtxo } from '../src/Infra/Bitcoin/utxoStatus';

const txid = 'a'.repeat(64);
const output = { value: 0.00000546, scriptPubKey: { hex: '51' } };
const response = {
  bestblock: 'b'.repeat(64),
  confirmations: 3,
  value: output.value,
  scriptPubKey: { hex: '51' },
  coinbase: false,
};
const respond = (result: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result }) }));
afterEach(() => vi.unstubAllGlobals());

describe('explicit current UTXO observation', () => {
  it('queries the exact network/outpoint including mempool and validates known output facts', async () => {
    respond(response);
    const observation = await fetchCurrentUtxo('testnet4', txid, 3, output);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      network: 'testnet4',
      target: 'core',
      method: 'gettxout',
      params: [txid, 3, true],
    });
    expect(observation).toMatchObject({
      network: 'testnet4',
      txid,
      vout: 3,
      status: 'unspent',
      includeMempool: true,
      confirmations: 3,
    });
    expect(Number.isFinite(Date.parse(observation.checkedAt))).toBe(true);
    expect(output).toEqual({ value: 0.00000546, scriptPubKey: { hex: '51' } });
  });
  it('keeps null absent rather than inferring a spender or spent state', async () => {
    respond(null);
    const observation = await fetchCurrentUtxo('mainnet', txid, 0);
    expect(observation.status).toBe('absent');
    expect(observation.bestblock).toBeUndefined();
    expect(observation.confirmations).toBeUndefined();
  });
  it('accepts mempool or immature coinbase observations without claiming spendability', async () => {
    respond({ ...response, confirmations: 0, coinbase: true });
    expect((await fetchCurrentUtxo('mainnet', txid, 0, output)).status).toBe('unspent');
  });
  it.each([
    {},
    false,
    [],
    { ...response, value: -1 },
    { ...response, value: 21_000_001 },
    { ...response, value: 0.000000001 },
    { ...response, confirmations: -1 },
    { ...response, bestblock: 'bad' },
    { ...response, scriptPubKey: { hex: '0' } },
    { ...response, scriptPubKey: { hex: 'gg' } },
    { ...response, scriptPubKey: { hex: '51'.repeat(10001) } },
  ])('rejects malformed node data without publishing a status', async (result) => {
    respond(result);
    await expect(fetchCurrentUtxo('mainnet', txid, 0)).rejects.toThrow('invalid UTXO response');
  });
  it('rejects valid-shaped results inconsistent with loaded amount or script', async () => {
    respond({ ...response, value: 0.00000547 });
    await expect(fetchCurrentUtxo('mainnet', txid, 0, output)).rejects.toThrow('disagrees');
    respond({ ...response, scriptPubKey: { hex: '52' } });
    await expect(fetchCurrentUtxo('mainnet', txid, 0, output)).rejects.toThrow('disagrees');
  });
  it('rejects invalid outpoints before network access', async () => {
    respond(null);
    for (const index of [-1, 0.5, 0x100000000])
      await expect(fetchCurrentUtxo('mainnet', txid, index)).rejects.toThrow(
        'valid transaction output',
      );
    await expect(fetchCurrentUtxo('mainnet', 'bad', 0)).rejects.toThrow('valid transaction output');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('discards a response after cancellation even when the transport ignores abort', async () => {
    const controller = new AbortController();
    let deliver!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      }),
    );
    const pending = fetchCurrentUtxo('mainnet', txid, 0, output, controller.signal);
    await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
    controller.abort();
    deliver({ result: response });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
