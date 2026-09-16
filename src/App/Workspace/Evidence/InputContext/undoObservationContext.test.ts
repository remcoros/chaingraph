import { describe, expect, it } from 'vitest';
import { carryObservationContext } from './undoObservationContext';
import { createWorkspace } from '../../createWorkspace';
import { parseWorkspace } from '../../Persistence/Format';
const a = 'a'.repeat(64),
  b = 'b'.repeat(64);
function workspace() {
  const w = createWorkspace('Context delta fixture', 'mainnet');
  for (const id of [a, b])
    w.transactions[id] = {
      txid: id,
      vin: [{ coinbase: '00' }],
      vout: [
        { n: 0, value: 1, scriptPubKey: { hex: '51' } },
        { n: 1, value: 1, scriptPubKey: { hex: '51' } },
      ],
    };
  return w;
}
describe('quiet observation context deltas', () => {
  it('keeps historical removed ancestry unchanged on camera-only saves', () => {
    const history = { ...workspace(), inputContext: { [a]: [0] }, contextTransactionIds: [a] };
    const before = workspace();
    delete before.transactions[a];
    const after = { ...before, view: { ...before.view, glow: false } };
    expect(carryObservationContext(history, before, after)).toBe(history);
  });
  it('applies only changed transaction scopes and provenance, retaining unrelated historical context', () => {
    const history = {
      ...workspace(),
      inputContext: { [a]: [0], [b]: [0] },
      contextTransactionIds: [a, b],
    };
    const before = { ...workspace(), inputContext: { [b]: [0] }, contextTransactionIds: [b] };
    const after = { ...before, inputContext: { [b]: [1] }, contextTransactionIds: undefined };
    const next = carryObservationContext(history, before, after);
    expect(next.inputContext).toEqual({ [a]: [0], [b]: [1] });
    expect(next.contextTransactionIds).toEqual([a]);
    expect(history.inputContext[b]).toEqual([0]);
    expect(() => parseWorkspace(next)).not.toThrow();
  });
  it('does not install context for a transaction absent from a historical snapshot', () => {
    const history = workspace();
    delete history.transactions[b];
    const before = workspace();
    const after = { ...before, inputContext: { [b]: [0] }, contextTransactionIds: [b] };
    expect(carryObservationContext(history, before, after)).toBe(history);
  });
  it('does not churn snapshots for semantically identical context records', () => {
    const before = { ...workspace(), inputContext: { [a]: [0] }, contextTransactionIds: [a] };
    const after = { ...before, inputContext: { [a]: [0] }, contextTransactionIds: [a] };
    expect(carryObservationContext(before, before, after)).toBe(before);
  });
});
