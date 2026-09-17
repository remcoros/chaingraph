import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
import { filterGraph } from '../../../src/App/Workspace/Workbenches/Graph/Filters/graphFilters';
import {
  canonicalEntityReference,
  outpointReference,
  transactionReference,
} from '../../../src/Core/Workspace/entityReferences';
import { MAX_HIDDEN_NODES } from '../../../src/Core/Workspace/view';

import {
  setNodesHidden,
  showAllNodes,
  transactionNodeIds,
} from '../../../src/App/Workspace/GraphState/visibility';

import type { Transaction } from '../../../src/Core/ChainData';

const a = 'a'.repeat(64),
  b = 'b'.repeat(64),
  c = 'c'.repeat(64);
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const funding: Transaction = {
  txid: a,
  vin: [{ coinbase: '00' }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { address } })),
};
const spending: Transaction = {
  txid: b,
  vin: [{ txid: a, vout: 0 }],
  vout: [{ n: 0, value: 0.9, scriptPubKey: {} }],
};
function workspace() {
  const w = createWorkspace('Visibility fixture', 'mainnet');
  w.chainData.transactions = { [a]: structuredClone(funding), [b]: structuredClone(spending) };
  w.annotations.entities[outpointReference(a, 0)] = {
    label: 'Personal savings',
    note: 'Known source',
    icon: '🔒',
    bookmarked: true,
  };
  return w;
}

describe('manual entity visibility', () => {
  it('hides only exact entity references and preserves all observations, annotations and findings', () => {
    const w = workspace();
    const hidden = setNodesHidden(w, [transactionReference(a)], true);
    expect(hidden.chainData.transactions).toBe(w.chainData.transactions);
    expect(hidden.annotations.entities).toBe(w.annotations.entities);
    expect(hidden.analysis.findings).toBe(w.analysis.findings);
    expect(buildGraph(hidden)).toEqual(buildGraph(w));
    const visible = filterGraph(buildGraph(hidden), {}, hidden.annotations.entities, {
      hiddenNodeIds: hidden.view.hiddenNodeIds,
    });
    expect(visible.nodes.some((node) => node.id === transactionReference(a))).toBe(false);
    expect(visible.nodes.some((node) => node.id === outpointReference(a, 0))).toBe(true);
    expect(visible.nodes.some((node) => node.id === outpointReference(a, 1))).toBe(true);
    expect(
      visible.links.some(
        (link) =>
          link.source === transactionReference(a) || link.target === transactionReference(a),
      ),
    ).toBe(false);
    expect(w.view.hiddenNodeIds).toBeUndefined();
  });

  it('does not resurrect hidden entities through connected context, focus or include filters', () => {
    const w = setNodesHidden(workspace(), [outpointReference(a, 0)], true);
    const graph = buildGraph(w);
    const visibility = { hiddenNodeIds: w.view.hiddenNodeIds };
    const adjacent = filterGraph(
      graph,
      { includeIds: [transactionReference(a)], preserveContext: true },
      w.annotations.entities,
      visibility,
    );
    expect(adjacent.nodes.map((node) => node.id)).toEqual([
      transactionReference(a),
      outpointReference(a, 1),
    ]);
    expect(adjacent.contextNodeIds).not.toContain(outpointReference(a, 0));
    const focused = filterGraph(
      graph,
      { focus: { id: transactionReference(a), hops: 2 } },
      {},
      visibility,
    );
    expect(focused.nodes.map((node) => node.id)).not.toContain(transactionReference(b));
    expect(
      filterGraph(graph, { includeIds: [outpointReference(a, 0)] }, {}, visibility).nodes,
    ).toEqual([]);
    expect(
      filterGraph(graph, { focus: { id: outpointReference(a, 0), hops: 2 } }, {}, visibility).nodes,
    ).toEqual([]);
  });

  it('retains observed funding and spending evidence when the corresponding transaction is hidden', () => {
    const w = setNodesHidden(workspace(), [transactionReference(a), transactionReference(b)], true);
    const result = filterGraph(
      buildGraph(w),
      { kind: 'output', spend: 'observed', funding: 'loaded' },
      {},
      { hiddenNodeIds: w.view.hiddenNodeIds },
    );
    expect(result.nodes.map((node) => node.id)).toEqual([outpointReference(a, 0)]);
    expect(result.links).toEqual([]);
  });

  it('offers separate hidden/all entity projections without changing the canvas visibility policy', () => {
    const w = setNodesHidden(workspace(), [outpointReference(a, 0), outpointReference(a, 1)], true);
    const graph = buildGraph(w);
    const hidden = filterGraph(
      graph,
      { query: 'Personal', preserveContext: false },
      w.annotations.entities,
      { hiddenNodeIds: w.view.hiddenNodeIds, mode: 'hidden' },
    );
    expect(hidden.nodes.map((node) => node.id)).toEqual([outpointReference(a, 0)]);
    expect(
      filterGraph(graph, {}, {}, { hiddenNodeIds: w.view.hiddenNodeIds, mode: 'all' }).nodes,
    ).toEqual(graph.nodes);
    expect(filterGraph(graph, {}, {}, { hiddenNodeIds: w.view.hiddenNodeIds }).nodes).toHaveLength(
      graph.nodes.length - 2,
    );
    expect(w.view.hiddenNodeIds).toHaveLength(2);
  });

  it('returns unique transaction inputs and outputs, excludes coinbase and keeps group actions reversible', () => {
    const w = setNodesHidden(workspace(), [outpointReference(a, 0)], true);
    expect(transactionNodeIds(funding, 'inputs')).toEqual([]);
    expect(transactionNodeIds(funding, 'outputs')).toEqual([
      outpointReference(a, 0),
      outpointReference(a, 1),
    ]);
    expect(transactionNodeIds(spending, 'inputs')).toEqual([outpointReference(a, 0)]);
    const hidden = setNodesHidden(w, transactionNodeIds(funding, 'outputs'), true);
    expect(hidden.view.hiddenNodeIds).toEqual([outpointReference(a, 0), outpointReference(a, 1)]);
    const shown = setNodesHidden(hidden, transactionNodeIds(funding, 'outputs'), false);
    expect(shown.view.hiddenNodeIds).toBeUndefined();
    expect(shown.chainData.transactions).toBe(w.chainData.transactions);
    expect(w.view.hiddenNodeIds).toEqual([outpointReference(a, 0)]);
    // Defensive duplicate handling never inflates the visibility count.
    expect(
      transactionNodeIds({ ...spending, vin: [...spending.vin, ...spending.vin] }, 'inputs'),
    ).toHaveLength(1);
  });

  it('preserves identity on no-ops and reveals only requested IDs without changing filters or another workspace', () => {
    const original = workspace();
    original.view.filters = { query: 'Savings' };
    const hidden = setNodesHidden(
      original,
      [outpointReference(a, 0), transactionReference(b)],
      true,
    );
    expect(setNodesHidden(hidden, [outpointReference(a, 0)], true)).toBe(hidden);
    expect(setNodesHidden(hidden, [transactionReference(c)], false)).toBe(hidden);
    const shown = setNodesHidden(hidden, [outpointReference(a, 0)], false);
    expect(shown.view.hiddenNodeIds).toEqual([transactionReference(b)]);
    const all = showAllNodes(shown);
    expect(all.view.filters).toBe(original.view.filters);
    expect(all.view.hiddenNodeIds).toBeUndefined();
    expect(showAllNodes(all)).toBe(all);
    expect(original.view.hiddenNodeIds).toBeUndefined();
    expect(workspace().view.hiddenNodeIds).toBeUndefined();
  });

  it('persists canonical bounded references, accepts off-graph IDs and validates network addresses', () => {
    const w = workspace();
    w.view.hiddenNodeIds = [
      `TX:${c.toUpperCase()}`,
      `out:${a.toUpperCase()}:0001`,
      `out:${a}:1`,
      `addr:${address.toUpperCase()}`,
    ];
    w.view.entityVisibility = 'hidden';
    const parsed = parseWorkspace(w);
    expect(parsed.view.hiddenNodeIds).toEqual([
      transactionReference(c),
      outpointReference(a, 1),
      `addr:${address}`,
    ]);
    expect(parsed.view.entityVisibility).toBe('hidden');
    const foreign = createWorkspace('Public network mismatch fixture', 'testnet4');
    foreign.view.hiddenNodeIds = [`addr:${address}`];
    expect(() => parseWorkspace(foreign)).toThrow();
    expect(() =>
      parseWorkspace({ ...w, view: { ...w.view, entityVisibility: 'invalid' } }),
    ).toThrow();
    expect(
      parseWorkspace({
        ...w,
        view: { ...w.view, hiddenNodeIds: undefined, entityVisibility: undefined },
      }).view.hiddenNodeIds,
    ).toBeUndefined();
    expect(canonicalEntityReference(`out:${a}:4294967295`, 'mainnet')).toBe(`out:${a}:4294967295`);
  });

  it.each([
    'out:invalid:0',
    `out:${a}:4294967296`,
    `out:${a}:-1`,
    `out:${a}:1.1`,
    `tx:${a}suffix`,
    'addr:not-a-bitcoin-address',
  ])('rejects malformed entity references %s', (reference) => {
    expect(() => setNodesHidden(workspace(), [reference], true)).toThrow();
    const document = createWorkspace('Public invalid reference fixture', 'mainnet');
    document.view.hiddenNodeIds = [reference];
    expect(() => parseWorkspace(document)).toThrow();
  });

  it('rejects oversized imports before parsing chain data and oversized action iterables atomically', () => {
    const references = Array(MAX_HIDDEN_NODES + 1).fill(transactionReference(a));
    expect(() =>
      parseWorkspace({ transactions: 'invalid', view: { hiddenNodeIds: references } }),
    ).toThrow('50,000 hidden entity limit');
    const w = workspace();
    expect(() => setNodesHidden(w, references, true)).toThrow('50,000 entity references');
    expect(w.view.hiddenNodeIds).toBeUndefined();
    expect(w.chainData.transactions[a]).toEqual(funding);
  });
});
