import { describe, expect, it } from 'vitest';
import { MAX_MONEY_SATS } from '../Bitcoin';
import { addressBalanceSats, type AddressBalanceObservation } from './observations';

const balance: AddressBalanceObservation = {
  network: 'mainnet',
  confirmedSats: 125_000,
  unconfirmedSats: -25_000,
  checkedAt: '2026-10-12T12:00:00Z',
};

describe('observed address balance', () => {
  it('includes pending changes and distinguishes an observed zero from missing evidence', () => {
    expect(addressBalanceSats(balance)).toBe(100_000);
    expect(addressBalanceSats({ ...balance, confirmedSats: 0, unconfirmedSats: 0 })).toBe(0);
    expect(addressBalanceSats(undefined)).toBeUndefined();
  });

  it('sums checked coins and preserves an explicitly empty check as zero', () => {
    const observation = {
      network: 'mainnet' as const,
      checkedAt: balance.checkedAt,
      utxos: [
        { txid: 'a'.repeat(64), vout: 0, valueSats: 2_000, height: 800_000 },
        { txid: 'a'.repeat(64), vout: 1, valueSats: 3_000, height: 0 },
      ],
    };
    expect(addressBalanceSats(observation)).toBe(5_000);
    expect(addressBalanceSats({ ...observation, utxos: [] })).toBe(0);
    expect(
      addressBalanceSats({ ...observation, utxos: [observation.utxos[0], observation.utxos[0]] }),
    ).toBeUndefined();
    expect(
      addressBalanceSats({
        ...observation,
        utxos: [{ ...observation.utxos[0], valueSats: -1 }],
      }),
    ).toBeUndefined();
  });

  it('rejects invalid amounts and impossible totals without displaying them as zero', () => {
    for (const invalid of [
      { confirmedSats: -1, unconfirmedSats: 0 },
      { confirmedSats: 1.5, unconfirmedSats: 0 },
      { confirmedSats: 0, unconfirmedSats: -1 },
      { confirmedSats: MAX_MONEY_SATS, unconfirmedSats: 1 },
      { confirmedSats: MAX_MONEY_SATS + 1, unconfirmedSats: -1 },
    ])
      expect(addressBalanceSats({ ...balance, ...invalid })).toBeUndefined();
  });
});
