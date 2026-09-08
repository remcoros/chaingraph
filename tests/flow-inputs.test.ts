import { describe, expect, it } from 'vitest';
import { flowInputPlan, mergeFlowInputs } from '../src/lib/useFlowInputs';
import { newWorkspace, buildGraph, parseWorkspace } from '../src/domain/workspace';
import type { Transaction } from '../src/domain/types';

const grandparent = 'a'.repeat(64),
  parent = 'b'.repeat(64),
  child = 'c'.repeat(64);
const tx = (txid: string, source?: string): Transaction => ({
  txid,
  vin: source ? [{ txid: source, vout: 0 }] : [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
});
describe('displayed transaction input hydration scope', () => {
  it('loads direct inputs once and never walks all newly added parents recursively', () => {
    const w = newWorkspace('Public fixture', 'mainnet');
    w.transactions[child] = tx(child, parent);
    const selected = buildGraph(w).nodes.find((n) => n.id === `out:${parent}:0`)!;
    expect(flowInputPlan(w, selected)).toEqual({ transactionId: child, missing: [parent] });
    w.view.transactionFlow = { transactionId: child };
    w.transactions[parent] = tx(parent, grandparent);
    expect(flowInputPlan(w, selected)).toEqual({ transactionId: child, missing: [] });
    w.view.transactionFlow.transactionId = parent;
    expect(flowInputPlan(w, selected)).toEqual({ transactionId: parent, missing: [grandparent] });
  });
  it('deduplicates shared input transactions and ignores coinbase inputs', () => {
    const w = newWorkspace('Public fixture', 'testnet4');
    w.transactions[child] = {
      ...tx(child, parent),
      vin: [
        { txid: parent, vout: 0 },
        { txid: parent, vout: 1 },
      ],
    };
    const selected = buildGraph(w).nodes.find((n) => n.id === `tx:${child}`)!;
    expect(flowInputPlan(w, selected).missing).toEqual([parent]);
    w.transactions[child] = tx(child);
    expect(flowInputPlan(w, selected).missing).toEqual([]);
  });
});

describe('flow input merge and explicit promotion', () => {
  it('adds full previous transaction metadata while limiting its graph to the requested outputs', () => {
    const w = newWorkspace('Focused flow', 'mainnet');
    w.transactions[child] = tx(child, parent);
    const selected = buildGraph(w).nodes.find((node) => node.id === `tx:${child}`)!;
    const funding = {
      ...tx(parent, grandparent),
      vout: [0, 1, 2].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
    };
    const merged = mergeFlowInputs(w, child, selected, [funding]);
    expect(merged.inputContext).toEqual({ [parent]: [0] });
    expect(merged.transactions[parent]).toBe(funding);
    expect(merged.annotations).toBe(w.annotations);
    expect(buildGraph(merged).nodes.map((node) => node.id)).not.toContain(`out:${parent}:1`);
    expect(buildGraph(merged).nodes.map((node) => node.id)).not.toContain(`out:${grandparent}:0`);
    expect(parseWorkspace(merged).inputContext).toEqual({ [parent]: [0] });
    expect(w.transactions[parent]).toBeUndefined();
    expect(w.inputContext).toBeUndefined();
  });

  it('unions sorted outpoints and preserves context from other displayed transactions', () => {
    const w = newWorkspace('Shared input parent', 'mainnet');
    w.transactions[parent] = {
      ...tx(parent),
      vout: [0, 1, 2].map((n) => ({ n, value: 1, scriptPubKey: {} })),
    };
    w.transactions[child] = {
      ...tx(child),
      vin: [
        { txid: parent, vout: 2 },
        { txid: parent, vout: 0 },
      ],
    };
    w.inputContext = { [parent]: [1] };
    const merged = mergeFlowInputs(w, child, undefined, []);
    expect(merged.inputContext).toEqual({ [parent]: [0, 1, 2] });
    expect(w.inputContext).toEqual({ [parent]: [1] });
    expect(mergeFlowInputs(merged, child, undefined, [])).toBe(merged);
  });

  it('does not downgrade explicit transactions, including those added while hydration was in flight', () => {
    const w = newWorkspace('Concurrent explicit addition', 'mainnet');
    w.transactions[child] = tx(child, parent);
    w.transactions[parent] = tx(parent, grandparent);
    const merged = mergeFlowInputs(w, child, undefined, [tx(parent, grandparent)]);
    expect(merged.inputContext).toBeUndefined();
    expect(buildGraph(merged).nodes.map((node) => node.id)).toContain(`out:${grandparent}:0`);
    expect(mergeFlowInputs(merged, child, undefined, [])).toBe(merged);
  });

  it('promotes an inspected parent even without network activity while keeping another parent scoped', () => {
    const w = newWorkspace('Follow previous transaction', 'mainnet');
    w.transactions[child] = tx(child, parent);
    w.transactions[parent] = tx(parent, grandparent);
    w.transactions[grandparent] = tx(grandparent);
    w.inputContext = { [parent]: [0], [grandparent]: [0] };
    const merged = mergeFlowInputs(w, parent, undefined, []);
    expect(merged.inputContext).toEqual({ [grandparent]: [0] });
    expect(buildGraph(merged).links).toContainEqual(
      expect.objectContaining({
        source: `out:${grandparent}:0`,
        target: `tx:${parent}`,
        kind: 'spends',
      }),
    );
    expect(w.inputContext).toEqual({ [parent]: [0], [grandparent]: [0] });
  });

  it('hydrates a selected missing output without requiring a loaded spending transaction', () => {
    const w = newWorkspace('Output lookup', 'mainnet');
    const merged = mergeFlowInputs(
      w,
      undefined,
      { id: `out:${parent}:0`, kind: 'output', txid: parent, vout: 0, label: 'Selected output' },
      [tx(parent, grandparent)],
    );
    expect(merged.inputContext).toEqual({ [parent]: [0] });
    expect(buildGraph(merged).nodes).toHaveLength(2);
  });
});
