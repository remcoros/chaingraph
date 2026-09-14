import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  newWorkspace,
  parseWorkspace,
  promoteInputContext,
} from '../src/Domain/Workspace/workspace';
import { outputNodeId, txNodeId, type Transaction } from '../src/Domain/types';

const id = (n: number) => n.toString(16).padStart(64, '0');
const output = (n: number) => ({ n, value: 0.01, scriptPubKey: {} });
const parent: Transaction = {
  txid: id(1),
  vin: [{ txid: id(99), vout: 0 }],
  vout: Array.from({ length: 4 }, (_, n) => output(n)),
};
const child: Transaction = {
  txid: id(2),
  vin: [{ txid: id(1), vout: 1 }],
  vout: [output(0)],
};
function workspace() {
  const w = newWorkspace('Input context', 'mainnet');
  w.transactions = { [parent.txid]: structuredClone(parent), [child.txid]: structuredClone(child) };
  w.inputContext = { [parent.txid]: [1] };
  return w;
}

describe('automatically hydrated transaction context', () => {
  it('keeps relevant previous outputs and both flow links without expanding parent siblings or ancestors', () => {
    const w = workspace();
    w.annotations[outputNodeId(parent.txid, 1)] = {
      label: 'Savings',
      icon: '🔒',
      note: 'Source',
      bookmarked: true,
    };
    const graph = buildGraph(w);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(
      [
        txNodeId(parent.txid),
        txNodeId(child.txid),
        outputNodeId(parent.txid, 1),
        outputNodeId(child.txid, 0),
      ].sort(),
    );
    expect(graph.links).toHaveLength(3);
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        source: txNodeId(parent.txid),
        target: outputNodeId(parent.txid, 1),
        kind: 'creates',
      }),
    );
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        source: outputNodeId(parent.txid, 1),
        target: txNodeId(child.txid),
        kind: 'spends',
      }),
    );
    expect(graph.nodes.find((node) => node.id === outputNodeId(parent.txid, 1))).toMatchObject({
      label: '🔒 Savings',
      value: 1_000_000,
    });
    expect(graph.nodes.find((node) => node.id === txNodeId(parent.txid))?.value).toBe(4_000_000);
    expect(w.transactions[parent.txid]).toEqual(parent);
    expect(parseWorkspace(JSON.parse(JSON.stringify(w))).inputContext).toEqual(w.inputContext);
  });

  it('includes every referenced parent output across displayed transactions without mutating stored scopes', () => {
    const w = workspace();
    w.transactions[id(3)] = { ...child, txid: id(3), vin: [{ txid: parent.txid, vout: 3 }] };
    const graph = buildGraph(w);
    expect(
      graph.nodes
        .filter((node) => node.kind === 'output' && node.txid === parent.txid)
        .map((node) => node.vout),
    ).toEqual([1, 3]);
    expect(graph.nodes.find((node) => node.id === outputNodeId(parent.txid, 3))?.value).toBe(
      1_000_000,
    );
    expect(w.inputContext).toEqual({ [parent.txid]: [1] });
    expect(graph.links.filter((link) => link.kind === 'spends')).toHaveLength(2);
  });

  it('promotes a context transaction to its complete graph by removing its scope and keeps legacy behavior', () => {
    const w = workspace();
    delete w.inputContext![parent.txid];
    const promoted = buildGraph(w);
    expect(
      promoted.nodes.filter((node) => node.kind === 'output' && node.txid === parent.txid),
    ).toHaveLength(4);
    expect(promoted.nodes.some((node) => node.id === outputNodeId(id(99), 0))).toBe(true);
    delete w.inputContext;
    expect(buildGraph(w)).toEqual(promoted);
    expect(parseWorkspace(w).inputContext).toBeUndefined();
  });

  it('promotes explicit targets immutably and preserves identity when there is nothing to promote', () => {
    const w = workspace();
    expect(promoteInputContext(w, [child.txid, id(999)])).toBe(w);
    const promoted = promoteInputContext(w, [parent.txid]);
    expect(promoted.inputContext).toBeUndefined();
    expect(promoted.transactions).toBe(w.transactions);
    expect(w.inputContext).toEqual({ [parent.txid]: [1] });
    expect(promoteInputContext(promoted, [parent.txid])).toBe(promoted);
  });

  it('keeps a 150-input/output transaction and 150 large parents at 451 rendered nodes', () => {
    const w = newWorkspace('Large flow', 'mainnet');
    const parents = Array.from({ length: 150 }, (_, n): Transaction => ({
      txid: id(n + 1),
      vin: Array.from({ length: 150 }, (_, index) => ({ txid: id(1000 + index), vout: n })),
      vout: Array.from({ length: 150 }, (_, index) => output(index)),
    }));
    const transaction: Transaction = {
      txid: id(999),
      vin: parents.map((tx, n) => ({ txid: tx.txid, vout: n })),
      vout: Array.from({ length: 150 }, (_, n) => output(n)),
    };
    w.transactions = Object.fromEntries([...parents, transaction].map((tx) => [tx.txid, tx]));
    w.inputContext = Object.fromEntries(parents.map((tx, n) => [tx.txid, [n]]));
    const parsed = parseWorkspace(w);
    const graph = buildGraph(parsed);
    expect(graph.nodes).toHaveLength(451);
    expect(graph.links).toHaveLength(450);
    expect(
      Object.values(parsed.transactions).reduce((count, tx) => count + tx.vout.length, 0),
    ).toBe(22_650);
  });

  it.each([
    { [id(1)]: [] },
    { [id(1)]: [1, 1] },
    { [id(1)]: [4] },
    { [id(1)]: [-1] },
    { [id(1)]: [1.5] },
    { [id(1)]: [0x100000000] },
    { [id(1)]: ['1'] },
    { [id(1)]: Array.from({ length: 10001 }, (_, n) => n) },
    { [id(99)]: [0] },
    { invalid: [0] },
  ])('rejects invalid, missing or duplicate context outpoints %#', (inputContext) => {
    expect(() => parseWorkspace({ ...workspace(), inputContext })).toThrow();
  });

  it('checks context budgets before deeply parsing imported transactions or index arrays', () => {
    expect(() =>
      parseWorkspace({
        transactions: 'invalid',
        inputContext: Object.fromEntries(Array.from({ length: 10001 }, (_, n) => [id(n), [0]])),
      }),
    ).toThrow('10,000 input-context transaction limit');
    expect(() =>
      parseWorkspace({
        transactions: 'invalid',
        inputContext: Object.fromEntries(
          Array.from({ length: 6 }, (_, n) => [id(n), Array(10000).fill(0)]),
        ),
      }),
    ).toThrow('50,000 input-context output limit');
  });

  it('checks address-history budgets even when input context is absent', () => {
    const base = newWorkspace('Address history budgets', 'mainnet');
    expect(() =>
      parseWorkspace({
        ...base,
        addressHistories: Object.fromEntries(
          Array.from({ length: 10001 }, (_, n) => [id(n), { history: [], truncated: false }]),
        ),
      }),
    ).toThrow('10,000 watched address history limit');

    expect(() =>
      parseWorkspace({
        ...base,
        addressHistories: Object.fromEntries(
          Array.from({ length: 6 }, (_, n) => [
            id(n),
            {
              history: Array.from({ length: 10000 }, (_, index) => ({
                tx_hash: id(index),
                height: 1,
              })),
              truncated: false,
            },
          ]),
        ),
      }),
    ).toThrow('50,000 address history entry limit');
  });
});
