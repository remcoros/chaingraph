import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../Core/ChainData';
import { relatedTransactions } from './relatedTransactions';

const id = (n: number) => n.toString(16).padStart(64, '0');
const transaction = (n: number, vin: Transaction['vin'] = []): Transaction => ({
  txid: id(n),
  vin,
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
});

describe('related transactions', () => {
  it('retains the creating and every loaded competing spend of the exact selected outpoint', () => {
    const creating = transaction(1);
    const spending = transaction(2, [{ txid: creating.txid, vout: 0 }]);
    const competing = { ...spending, txid: id(3) };
    const other = transaction(4, [{ txid: creating.txid, vout: 1 }]);
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
