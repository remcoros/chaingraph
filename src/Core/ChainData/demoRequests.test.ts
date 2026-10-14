import { afterEach, expect, it, vi } from 'vitest';
import { backendNetworks, backendStatus, rpc } from './api';
import { fetchRawInspection } from './rawTransactionInspection';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('rejects every demo transport entry before sending an HTTP request, including raw-byte fallback', async () => {
  vi.stubGlobal('__DEMO_MODE__', true);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
  expect(await backendNetworks()).toEqual([]);
  expect((await backendStatus('mainnet')).connected).toBe(false);
  await expect(rpc('mainnet', 'core', 'getblockcount', [])).rejects.toThrow();
  await expect(
    fetchRawInspection(
      'mainnet',
      { txid: 'a'.repeat(64), vin: [], vout: [] },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
