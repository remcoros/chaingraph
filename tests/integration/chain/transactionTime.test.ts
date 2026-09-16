import { describe, expect, it } from 'vitest';
import {
  formatLocalTimestamp,
  transactionBlockTime,
} from '../../../src/App/Controls/Display/transactionTime';
import { walletRecordBlockObservation } from '../../../src/App/Workspace/Wallet/walletRecordBlockObservation';
import { transactionStatus } from '../../../src/App/Controls/Display/transactionStatus';
import type { Transaction } from '../../../src/Domain/Chain/transaction';

const tx: Transaction = {
  txid: 'a'.repeat(64),
  vin: [],
  vout: [],
  blockHeight: 800000,
  blocktime: 1690168629,
};

describe('saved block times', () => {
  it('formats the same historical time across browser timezones with exact seconds', () => {
    const previous = process.env.TZ;
    try {
      for (const timezone of ['Pacific/Honolulu', 'Europe/Amsterdam', 'Asia/Tokyo']) {
        process.env.TZ = timezone;
        expect(transactionBlockTime(tx)).toEqual({
          compact: '2023-07-24 03:17:09',
          exact: '2023-07-24 03:17:09',
          iso: '2023-07-24T03:17:09.000Z',
        });
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('uses blocktime, never current time or the generic time field', () => {
    expect(transactionBlockTime({ ...tx, time: 1 })).toEqual(transactionBlockTime(tx));
    expect(transactionBlockTime({ ...tx, blocktime: undefined, time: 1690168629 })).toBeUndefined();
    expect(
      transactionBlockTime({ ...tx, blockHeight: undefined, confirmations: 20 }),
    ).toBeDefined();
    expect(transactionStatus({ ...tx, blockHeight: undefined, confirmations: 20 }).label).toBe(
      'Confirmed',
    );
  });

  it('does not give mempool, missing, or conflicted observations a block date', () => {
    const unknown = { ...tx, blockHeight: undefined, confirmations: 0, time: 1690168629 };
    expect(transactionStatus(unknown).label).toBe('Status unknown');
    expect(transactionBlockTime(unknown)).toBeUndefined();
    expect(transactionStatus({ ...unknown, mempool: true }).label).toBe('Unconfirmed');
    expect(transactionBlockTime({ ...unknown, mempool: true })).toBeUndefined();
    expect(transactionBlockTime({ ...tx, confirmations: -1 })).toBeUndefined();
    expect(transactionBlockTime(undefined)).toBeUndefined();
  });

  it('handles missing/invalid times and the epoch without inventing dates', () => {
    for (const value of [undefined, NaN, Infinity, -1, 1e20])
      expect(transactionBlockTime({ ...tx, blocktime: value })).toBeUndefined();
    expect(transactionBlockTime({ ...tx, blocktime: 0 })?.exact).toBe('1970-01-01 00:00:00');
  });

  it('renders stored instants in the user timezone without a timezone suffix', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'Europe/Amsterdam';
      expect(formatLocalTimestamp('2026-09-11T19:53:28.000Z')).toBe('2026-09-11 21:53:28');
      process.env.TZ = 'Pacific/Honolulu';
      expect(formatLocalTimestamp('2026-09-11T19:53:28.000Z')).toBe('2026-09-11 09:53:28');
      expect(formatLocalTimestamp('not a timestamp')).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('keeps Wallet history/UTXO height observations separate from loaded block times', () => {
    const observed = (height?: number, mempool = false) =>
      walletRecordBlockObservation(tx.txid, tx, height, mempool);
    expect(transactionBlockTime(observed(800000))).toEqual(transactionBlockTime(tx));
    expect(transactionBlockTime(observed(800001))).toBeUndefined();
    for (const height of [0, -1]) {
      expect(transactionStatus(observed(height, true)).label).toBe('Unconfirmed');
      expect(transactionBlockTime(observed(height, true))).toBeUndefined();
    }
    const missing = walletRecordBlockObservation(tx.txid, undefined, undefined, false);
    expect(transactionStatus(missing).kind).toBe('unknown');
    const heightOnly = walletRecordBlockObservation(tx.txid, undefined, 800000, false);
    expect(transactionStatus(heightOnly).label).toBe('#800000');
    expect(transactionBlockTime(heightOnly)).toBeUndefined();
    const conflicted = walletRecordBlockObservation(
      tx.txid,
      { ...tx, confirmations: -1 },
      800000,
      false,
    );
    expect(transactionStatus(conflicted).kind).toBe('conflicted');
    expect(transactionBlockTime(conflicted)).toBeUndefined();
  });
});
