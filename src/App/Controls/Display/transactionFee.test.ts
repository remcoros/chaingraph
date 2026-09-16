import { describe, expect, it } from 'vitest';
import { transactionFee } from './transactionFee';
import type { Transaction } from '../../../Domain/Chain/transaction';
import { newWorkspace } from '../../../Domain/Workspace/workspace';

const id = (value: number) => value.toString(16).padStart(64, '0');

function fixture() {
  const workspace = newWorkspace('Transaction fee fixture', 'mainnet');
  const parent: Transaction = {
    txid: id(1),
    vin: [],
    vout: [{ n: 0, value: 0.00001, scriptPubKey: { hex: '0014' } }],
  };
  const transaction: Transaction = {
    txid: id(2),
    vin: [{ txid: parent.txid, vout: 0 }],
    vout: [{ n: 0, value: 0.00000826, scriptPubKey: { hex: '0014' } }],
    blockHeight: 800000,
    blocktime: 1690168629,
    vsize: 1740,
  };
  workspace.transactions = {
    [parent.txid]: parent,
    [transaction.txid]: transaction,
  };
  return { workspace, transaction };
}

describe('transaction fees', () => {
  it('calculates the total fee and fee rate from complete local observations', () => {
    const { workspace, transaction } = fixture();
    expect(transactionFee(workspace, transaction)).toEqual({
      feeSats: 174,
      feeRateSatVb: 0.1,
    });
  });

  it('keeps fee evidence unknown when inputs or transaction size are missing', () => {
    const { workspace, transaction } = fixture();
    expect(
      transactionFee(workspace, { ...transaction, vin: [{ txid: id(3), vout: 0 }] }),
    ).toBeUndefined();
    expect(transactionFee(workspace, { ...transaction, vsize: undefined })).toBeUndefined();
    expect(
      transactionFee(workspace, { ...transaction, mempool: true, blockHeight: undefined }),
    ).toBeUndefined();
  });

  it('does not report an impossible negative fee', () => {
    const { workspace, transaction } = fixture();
    expect(
      transactionFee(workspace, {
        ...transaction,
        vout: [{ n: 0, value: 0.00001001, scriptPubKey: { hex: '0014' } }],
      }),
    ).toBeUndefined();
  });
});
