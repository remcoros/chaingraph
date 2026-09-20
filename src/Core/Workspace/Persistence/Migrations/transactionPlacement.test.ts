import { expect, it } from 'vitest';
import { migrateTransactionPlacement } from './transactionPlacement';

it('drops malformed legacy placement without discarding otherwise usable transaction records', () => {
  const txid = 'a'.repeat(64);
  expect(
    migrateTransactionPlacement({
      [txid]: {
        txid,
        vin: [{ coinbase: '00' }],
        vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
        mempool: true,
        confirmations: 1,
      },
    }),
  ).toEqual({
    [txid]: {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    },
  });
});
