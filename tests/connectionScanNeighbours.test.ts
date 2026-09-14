import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  validateScanSettings,
} from '../src/Domain/ConnectionScan/connectionScan';
import {
  indexScanNeighbours,
  prepareNeighbourScanTargets,
} from '../src/Domain/ConnectionScan/connectionScanNeighbours';
import type { GraphData, GraphLink, GraphNode, Transaction } from '../src/Domain/types';
import { buildGraph, newWorkspace } from '../src/Domain/Workspace/workspace';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${id(n)}`;
const out = (n: number, vout = 0) => `out:${id(n)}:${vout}`;
const node = (id: string): GraphNode => ({
  id,
  kind: id.startsWith('tx:') ? 'transaction' : id.startsWith('out:') ? 'output' : 'address',
  label: id,
});
const link = (source: string, target: string, kind: GraphLink['kind']): GraphLink => ({
  id: `${source}>${target}`,
  source,
  target,
  kind,
});
const targets = (graph: GraphData, source: string) =>
  prepareNeighbourScanTargets({ source, neighbours: indexScanNeighbours(graph) });
const transaction = (n: number, inputs: [number, number][] = []): Transaction => ({
  txid: id(n),
  vin: inputs.length ? inputs.map(([n, vout]) => ({ txid: id(n), vout })) : [{ coinbase: '00' }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});

describe('nearest loaded scan targets', () => {
  it('includes sibling inputs and both sides of the source using only observed links', () => {
    const workspace = newWorkspace('Public neighbours fixture', 'mainnet');
    workspace.transactions = {
      [id(1)]: transaction(1),
      [id(2)]: transaction(2),
      [id(3)]: transaction(3, [
        [1, 0],
        [2, 1],
      ]),
      [id(9)]: transaction(9),
    };
    const result = targets(buildGraph(workspace), out(1));
    expect(result.ids.slice(0, 2)).toEqual([tx(1), tx(3)]);
    expect(result.ids).toContain(out(2, 1));
    expect(result.ids).toContain(out(3));
    expect(result.ids).toContain(tx(2));
    expect(result.ids).not.toContain(out(1));
    expect(result.ids).not.toContain(tx(9));
    expect(result.ids).toHaveLength(8);
    expect(result.capped).toBe(false);
  });

  it('does not let canvas membership or visibility remove loaded neighbours', () => {
    const workspace = newWorkspace('Public neighbours fixture', 'mainnet');
    workspace.transactions = { [id(1)]: transaction(1), [id(2)]: transaction(2, [[1, 0]]) };
    const expected = targets(buildGraph(workspace), tx(1));
    workspace.view.graphNodeIds = [tx(1)];
    workspace.view.hiddenNodeIds = [tx(2), out(1), out(2)];
    expect(targets(buildGraph(workspace), tx(1))).toEqual(expected);
    expect(expected.ids).toContain(tx(2));
  });

  it('ignores addresses, address associations, missing endpoints and non-chain edge shapes', () => {
    const graph: GraphData = {
      nodes: [tx(1), tx(2), out(1), out(2), 'addr:public'].map(node),
      links: [
        link(tx(1), out(1), 'creates'),
        link(out(1), 'addr:public', 'address'),
        link(out(2), 'addr:public', 'address'),
        link(out(1), out(2), 'address'),
        link(out(1), out(2), 'spends'),
        link(tx(1), tx(2), 'creates'),
        link(out(1), tx(99), 'spends'),
      ],
    };
    expect(targets(graph, tx(1))).toEqual({ ids: [out(1)], capped: false });
  });

  it('keeps exact loaded prevouts connected without inventing an absent creating transaction', () => {
    const workspace = newWorkspace('Public neighbours fixture', 'mainnet');
    workspace.transactions = {
      [id(3)]: transaction(3, [
        [1, 50],
        [1, 150],
      ]),
    };
    const result = targets(buildGraph(workspace), out(1, 150));
    expect(result.ids).toEqual([tx(3), out(1, 50), out(3), out(3, 1)]);
    expect(result.ids).not.toContain(tx(1));
  });

  it('visits reconverging branches once even when loaded links form an undirected loop', () => {
    const workspace = newWorkspace('Public neighbours fixture', 'mainnet');
    workspace.transactions = {
      [id(1)]: transaction(1),
      [id(2)]: transaction(2, [
        [1, 0],
        [1, 1],
      ]),
    };
    expect(targets(buildGraph(workspace), out(1))).toEqual({
      ids: [tx(1), tx(2), out(1, 1), out(2), out(2, 1)],
      capped: false,
    });
  });

  it('orders nearer targets first with deterministic ties, regardless of graph insertion order', () => {
    const graph: GraphData = {
      nodes: [tx(1), tx(2), out(1), out(1, 1), out(2)].map(node),
      links: [
        link(tx(1), out(1, 1), 'creates'),
        link(tx(1), out(1), 'creates'),
        link(out(1), tx(2), 'spends'),
        link(tx(2), out(2), 'creates'),
        link(tx(1), out(1), 'creates'),
      ],
    };
    const expected = { ids: [out(1), out(1, 1), tx(2), out(2)], capped: false };
    expect(targets(graph, tx(1))).toEqual(expected);
    expect(
      targets({ nodes: [...graph.nodes].reverse(), links: [...graph.links].reverse() }, tx(1)),
    ).toEqual(expected);
  });

  it('caps actual overflow at 1,000 nearest targets, but does not mark exactly 1,000 as capped', () => {
    const outputs = Array.from({ length: 1000 }, (_, n) => out(1, n));
    const graph: GraphData = {
      nodes: [tx(1), ...outputs].map(node),
      links: outputs.map((output) => link(tx(1), output, 'creates')),
    };
    expect(targets(graph, tx(1))).toEqual({ ids: [...outputs].sort(), capped: false });
    graph.nodes.push(node(tx(2)));
    graph.links.push(link(out(1), tx(2), 'spends'));
    const result = targets(graph, tx(1));
    expect(result).toEqual({ ids: [...outputs].sort(), capped: true });
    expect(result.ids).not.toContain(tx(2));
    graph.nodes.push(node(out(1, 1000)));
    graph.links.push(link(tx(1), out(1, 1000), 'creates'));
    expect(targets(graph, tx(1))).toEqual({
      ids: [...outputs, out(1, 1000)].sort().slice(0, 1000),
      capped: true,
    });
  });

  it('prepares independent snapshots that do not change when the graph or later targets change', () => {
    const graph: GraphData = {
      nodes: [tx(1), out(1)].map(node),
      links: [link(tx(1), out(1), 'creates')],
    };
    const neighbours = indexScanNeighbours(graph);
    const frozen = prepareNeighbourScanTargets({ source: tx(1), neighbours });
    graph.nodes.push(node(tx(2)));
    graph.links.push(link(out(1), tx(2), 'spends'));
    const next = targets(graph, tx(1));
    expect(next.ids).toContain(tx(2));
    next.ids.length = 0;
    expect(frozen).toEqual({ ids: [out(1)], capped: false });
    expect(prepareNeighbourScanTargets({ source: tx(1), neighbours })).toEqual(frozen);
  });

  it('returns no targets for an isolated or absent source and rejects an address source', () => {
    const graph: GraphData = { nodes: [node(tx(1))], links: [] };
    expect(targets(graph, tx(1))).toEqual({ ids: [], capped: false });
    expect(targets(graph, tx(2))).toEqual({ ids: [], capped: false });
    expect(() => targets(graph, 'addr:public')).toThrow('Choose a transaction or output');
  });

  it('defaults to neighbours while preserving each explicitly chosen saved scope', () => {
    expect(DEFAULT_SCAN_SETTINGS.targetScope).toBe('neighbours');
    for (const targetScope of ['neighbours', 'visible', 'added', 'custom'] as const) {
      const settings = { ...DEFAULT_SCAN_SETTINGS, targetScope };
      expect(validateScanSettings(settings)).toEqual(settings);
    }
  });
});
