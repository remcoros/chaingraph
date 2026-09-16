import { describe, expect, it } from 'vitest';
import {
  GraphMetadataProjection,
  EMPTY_GRAPH_ANNOTATIONS,
} from '../src/App/Workspace/Workbenches/Graph/graphMetadata';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import { fullGraphMembershipEvidence } from '../src/Domain/Graph/graphMembership';
import { buildTagIndex } from '../src/Domain/Metadata/tags';
import { filterGraph } from '../src/Domain/Graph/graphFilters';
import { sortEntities } from '../src/App/Workspace/Workbenches/Graph/EntitiesPanel/entitySort';
import type { Annotation, GraphData, Workspace } from '../src/Domain/types';

const id = '1'.repeat(64);
const transaction = `tx:${id}`;
const output = `out:${id}:0`;
const address = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
const blank: Annotation = { label: '', icon: '', note: '', bookmarked: false };
const matches = new Map();
function setup() {
  const workspace = newWorkspace('Metadata fixture', 'mainnet');
  workspace.transactions[id] = {
    txid: id,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1, scriptPubKey: { address } }],
  };
  const graph = fullGraphMembershipEvidence({ ...workspace, annotations: EMPTY_GRAPH_ANNOTATIONS });
  const cache = new GraphMetadataProjection();
  const tags = buildTagIndex(workspace, graph);
  return {
    workspace,
    graph,
    cache,
    project: (w: Workspace) => cache.project(graph, w, tags, matches, 'all'),
  };
}
const labelGraph = (
  graph: GraphData,
  labeled: ReadonlyMap<string, GraphData['nodes'][number]>,
) => ({
  ...graph,
  nodes: graph.nodes.map((node) => labeled.get(node.id) ?? node),
});

describe('graph metadata projection', () => {
  it('keeps graph presentation unchanged for bookmark and note edits, while metadata filters stay accurate', () => {
    const { workspace, graph, project } = setup();
    const initial = project(workspace);
    const edited = {
      ...workspace,
      annotations: { [output]: { ...blank, bookmarked: true, note: 'review later' } },
    };
    expect(project(edited)).toBe(initial);
    expect(
      filterGraph(graph, { bookmarkedOnly: true }, edited.annotations).matchedNodes.map(
        (n) => n.id,
      ),
    ).toEqual([output]);
    expect(
      filterGraph(graph, { query: 'review later' }, edited.annotations).matchedNodes.map(
        (n) => n.id,
      ),
    ).toEqual([output]);
    expect(project(workspace)).toBe(initial);
    expect(
      filterGraph(graph, { bookmarkedOnly: true }, workspace.annotations).matchedNodes,
    ).toEqual([]);
  });

  it('updates only edited appearances and preserves label sorting, icon search, clearing and replayed renders', () => {
    const { workspace, graph, project } = setup();
    const initial = project(workspace);
    const edited = {
      ...workspace,
      annotations: {
        [transaction]: { ...blank, label: 'Zebra' },
        [output]: { ...blank, label: 'Apple', icon: '★' },
      },
    };
    const changed = project(edited);
    expect(changed.presentation.get(`addr:${address}`)).toBe(
      initial.presentation.get(`addr:${address}`),
    );
    expect(changed.presentation.get(output)).toMatchObject({ label: 'Apple', icon: '★' });
    const displayed = labelGraph(graph, changed.labeledNodes);
    expect(displayed.nodes.find((n) => n.id === output)?.label).toBe('★ Apple');
    expect(
      sortEntities(
        displayed.nodes.filter((n) => n.kind !== 'address'),
        'label',
      ).map((n) => n.id),
    ).toEqual([output, transaction]);
    expect(
      filterGraph(graph, { query: '★ Apple' }, edited.annotations).matchedNodes.map((n) => n.id),
    ).toEqual([output]);
    const cleared = project(workspace);
    expect(cleared.presentation.get(output)).toMatchObject({ label: '', icon: '' });
    expect(cleared.labeledNodes.size).toBe(0);
    // Older snapshots must remain valid after later and abandoned projections.
    expect(changed.presentation.get(output)?.label).toBe('Apple');
    expect(project(edited).labeledNodes.get(output)?.label).toBe('★ Apple');
  });

  it('patches address-inherited tags and clears their color without changing unrelated nodes', () => {
    const { workspace, graph, cache } = setup();
    const initial = cache.project(
      graph,
      workspace,
      buildTagIndex(workspace, graph),
      matches,
      'all',
    );
    const tagged = {
      ...workspace,
      tags: [{ id: 'fixture', name: 'Recognized', color: '#f7931a', nodeIds: [`addr:${address}`] }],
    };
    const changed = cache.project(graph, tagged, buildTagIndex(tagged, graph), matches, 'all');
    expect(changed.presentation.get(transaction)).toBe(initial.presentation.get(transaction));
    for (const nodeId of [output, `addr:${address}`]) {
      expect(changed.presentation.get(nodeId)).toMatchObject({
        tags: ['Recognized'],
        color: '#f7931a',
        highlight: true,
      });
    }
    const cleared = cache.project(
      graph,
      workspace,
      buildTagIndex(workspace, graph),
      matches,
      'all',
    );
    expect(cleared.presentation.get(output)).toMatchObject({
      tags: [],
      color: undefined,
      highlight: undefined,
    });
    expect(changed.presentation.get(output)?.tags).toEqual(['Recognized']);
  });

  it('drops old node metadata when graph evidence changes', () => {
    const { workspace, graph, cache, project } = setup();
    project({ ...workspace, annotations: { [output]: { ...blank, label: 'Old output' } } });
    const next = cache.project({ nodes: [], links: [] }, workspace, new Map(), matches, 'all');
    expect(next.presentation.size).toBe(0);
    expect(next.labeledNodes.size).toBe(0);
    expect(
      cache.project(graph, workspace, new Map(), matches, 'all').presentation.get(output)?.label,
    ).toBe('');
  });
});
