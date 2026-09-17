import { describe, expect, it } from 'vitest';
import { indexPreviousOutputs, resolvePreviousOutput } from './prevouts';
import type { Transaction } from './transaction';

const creator = 'a'.repeat(64);
const spender = 'b'.repeat(64);
const output = { value: 1, scriptPubKey: { hex: '51' } };
const transaction: Transaction = {
  txid: spender,
  vin: [{ txid: creator, vout: 3, prevout: output }],
  vout: [{ n: 0, ...output }],
};

describe('native previous-output indexing', () => {
  it('uses native outpoint keys without depending on workspace reference syntax', () => {
    const data = { network: 'mainnet' as const, transactions: { [spender]: transaction } };
    const index = indexPreviousOutputs(data);
    expect([...index.keys()]).toEqual([`${spender}:0`, `${creator}:3`]);
    expect(index.has(`out:${creator}:3`)).toBe(false);
    expect(resolvePreviousOutput(data, transaction.vin[0], index)).toMatchObject({
      status: 'attached',
      output: { n: 3, ...output },
    });
    expect(data.transactions).not.toHaveProperty(creator);
  });

  it('keeps loaded, missing and conflicting observations distinct', () => {
    const parent: Transaction = {
      txid: creator,
      vin: [{ coinbase: '00' }],
      vout: Array.from({ length: 4 }, (_, n) => ({ n, ...output })),
    };
    const data = {
      network: 'mainnet' as const,
      transactions: { [creator]: parent, [spender]: transaction },
    };
    expect(resolvePreviousOutput(data, { txid: creator, vout: 3 }).status).toBe('loaded');
    expect(resolvePreviousOutput(data, { txid: 'c'.repeat(64), vout: 0 }).status).toBe('missing');
    const contradictory = { ...parent, vout: parent.vout.map((item) => ({ ...item, value: 2 })) };
    expect(
      resolvePreviousOutput(
        { ...data, transactions: { ...data.transactions, [creator]: contradictory } },
        { txid: creator, vout: 3 },
      ).status,
    ).toBe('conflict');
  });
});
