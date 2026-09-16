import { describe, expect, it } from 'vitest';
import { indexLoadedSpends, selectedFlowLeg } from './transactionFlow';
import { outputNodeId } from '../../../../../Domain/Metadata/entityReferences';
import type { Transaction } from '../../../../../Domain/Chain/transaction';

const creator: Transaction = {
  txid: 'a'.repeat(64),
  vin: [{ coinbase: '00' }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: {} })),
};
const spender: Transaction = {
  txid: 'b'.repeat(64),
  vin: [{ txid: creator.txid, vout: 1 }],
  vout: [{ n: 0, value: 0.9, scriptPubKey: {} }],
};

describe('transaction flow relationships', () => {
  it('follows the exact output backwards and forwards without conflating sibling outputs', () => {
    const id = outputNodeId(creator.txid, 1);
    expect(selectedFlowLeg(creator, id)).toEqual({ direction: 'next', index: 1 });
    expect(selectedFlowLeg(spender, id)).toEqual({ direction: 'previous', index: 0 });
    expect(selectedFlowLeg(spender, outputNodeId(creator.txid, 0))).toBeUndefined();
    const index = indexLoadedSpends({ creator, spender });
    expect(index.get(id)).toEqual([spender]);
    expect(index.has(outputNodeId(creator.txid, 0))).toBe(false);
  });

  it('keeps competing loaded spends, ignores coinbase and deduplicates an invalid repeated input', () => {
    const alternative = { ...spender, txid: 'c'.repeat(64), vin: [...spender.vin, ...spender.vin] };
    const index = indexLoadedSpends({ creator, spender, alternative });
    expect(index.size).toBe(1);
    expect(index.get(outputNodeId(creator.txid, 1))).toEqual([spender, alternative]);
    expect(indexLoadedSpends({ creator }).size).toBe(0);
    expect(selectedFlowLeg(creator)).toBeUndefined();
  });
});
