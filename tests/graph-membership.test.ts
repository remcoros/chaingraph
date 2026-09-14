import { describe, expect, it } from 'vitest';
import {
  addGraphNodes,
  ensureGraphMembership,
  fullGraphMembershipEvidence,
  hideGraphNodes,
  MAX_GRAPH_ACTION_NODES,
  MAX_GRAPH_NODES,
  parseGraphNodeIds,
  projectGraphAddresses,
  projectGraphMembership,
  removeGraphNodes,
  showAllGraphOutputs,
} from '../src/Domain/Graph/graphMembership';
import { graphUnconnectedOutputIds } from '../src/Domain/Graph/graphBranch';
import { outputNodeId, txNodeId, type Transaction } from '../src/Domain/types';
import { buildGraph, newWorkspace, parseWorkspace } from '../src/Domain/Workspace/workspace';
import { createTemplateWorkspace } from '../src/Domain/Workspace/workspaceTemplates';
import { showAllNodes } from '../src/Domain/Graph/visibility';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
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
  const w = newWorkspace('Explicit graph fixture', 'mainnet');
  w.transactions = { [a]: structuredClone(funding) };
  return w;
}
const ids = (w: ReturnType<typeof workspace>) =>
  projectGraphMembership(buildGraph(w), w.view.graphNodeIds).nodes.map((node) => node.id);

describe('address display projection', () => {
  it('never adds an address outside explicit membership, including retained context', () => {
    const w = addGraphNodes(workspace(), [txNodeId(a), outputNodeId(a, 0)]);
    const evidence = fullGraphMembershipEvidence(w);
    expect(evidence.nodes.some((node) => node.id === `addr:${address}`)).toBe(true);
    const members = projectGraphMembership(evidence, w.view.graphNodeIds);
    expect(projectGraphAddresses(members, true)).toBe(members);
    expect(projectGraphAddresses(members, false, new Set([`addr:${address}`]))).toBe(members);
    expect(members.nodes.map((node) => node.id)).toEqual([txNodeId(a), outputNodeId(a, 0)]);
  });

  it('retains requested address context and non-address connections without changing evidence', () => {
    const otherAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
    const w = workspace();
    w.transactions[a].vout[1].scriptPubKey.address = otherAddress;
    w.transactions[b] = structuredClone(spending);
    const graph = fullGraphMembershipEvidence(w);
    const before = structuredClone(graph);
    const retained = new Set([`addr:${address}`]);
    const projected = projectGraphAddresses(graph, false, retained);
    expect(
      projected.nodes.filter((node) => node.kind === 'address').map((node) => node.id),
    ).toEqual([`addr:${address}`]);
    expect(projected.links.filter((link) => link.kind === 'address')).toEqual(
      graph.links.filter((link) => link.kind === 'address' && link.target === `addr:${address}`),
    );
    expect(projected.links.filter((link) => link.kind !== 'address')).toEqual(
      graph.links.filter((link) => link.kind !== 'address'),
    );
    expect(projected.links.some((link) => link.kind === 'spends')).toBe(true);
    for (const node of projected.nodes) expect(graph.nodes).toContain(node);
    for (const link of projected.links) expect(graph.links).toContain(link);
    expect(graph).toEqual(before);
    expect(retained).toEqual(new Set([`addr:${address}`]));
  });

  it('reuses the graph when no address would be excluded and restores from unchanged evidence', () => {
    const graph = fullGraphMembershipEvidence(workspace());
    expect(projectGraphAddresses(graph, true)).toBe(graph);
    expect(projectGraphAddresses(graph, false, new Set([`addr:${address}`]))).toBe(graph);
    const hidden = projectGraphAddresses(graph, false);
    expect(hidden.nodes.every((node) => node.kind !== 'address')).toBe(true);
    expect(hidden.links.every((link) => link.kind !== 'address')).toBe(true);
    expect(projectGraphAddresses(hidden, false)).toBe(hidden);
    expect(projectGraphAddresses(graph, true)).toBe(graph);
  });
});

describe('explicit canvas membership', () => {
  function connectedWorkspace() {
    const w = workspace();
    w.transactions[b] = structuredClone(spending);
    return addGraphNodes(w, [
      txNodeId(a),
      txNodeId(b),
      outputNodeId(a, 0),
      outputNodeId(a, 1),
      outputNodeId(b, 0),
    ]);
  }

  it('protects connecting I/O from terminal hide/remove even when temporary filters conceal neighbors', () => {
    const w = connectedWorkspace();
    w.view.graphNodeIds!.push(`addr:${address}`);
    w.inputContext = { [a]: [0] };
    w.view.smallAmountThreshold = 200_000_000;
    w.view.filters = { includeIds: [txNodeId(a)] };
    const evidence = fullGraphMembershipEvidence(w);
    const terminal = graphUnconnectedOutputIds(evidence, new Set(w.view.graphNodeIds));
    expect(terminal).toEqual(new Set([outputNodeId(b, 0)]));
    expect(hideGraphNodes(w, terminal).view.hiddenNodeIds).toEqual([outputNodeId(b, 0)]);
    expect(removeGraphNodes(w, terminal).view.graphNodeIds).toContain(outputNodeId(a, 0));
    expect(removeGraphNodes(w, terminal).view.graphNodeIds).toContain(outputNodeId(a, 1));

    w.view.hiddenNodeIds = [txNodeId(b), `addr:${address}`];
    const visible = new Set(
      w.view.graphNodeIds!.filter((id) => !w.view.hiddenNodeIds!.includes(id)),
    );
    const hideable = graphUnconnectedOutputIds(evidence, visible);
    expect(hideable).toEqual(new Set([outputNodeId(a, 0), outputNodeId(a, 1), outputNodeId(b, 0)]));
    // Removing still protects bridges to hidden members; hiding uses manual visibility.
    expect(graphUnconnectedOutputIds(evidence, new Set(w.view.graphNodeIds))).toEqual(terminal);
    expect(new Set(hideGraphNodes(w, hideable).view.hiddenNodeIds)).toEqual(
      new Set([txNodeId(b), `addr:${address}`, ...hideable]),
    );
  });

  it('shows all loaded direct I/O of canvas transactions and restores hidden or removed I/O without fetching', () => {
    const w = connectedWorkspace();
    const hidden = hideGraphNodes(w, [outputNodeId(a, 0), outputNodeId(b, 0)]);
    const removed = removeGraphNodes(hidden, [outputNodeId(a, 1)]);
    removed.inputContext = { [a]: [0] };
    removed.view.smallAmountThreshold = 200_000_000;
    removed.view.filters = { includeIds: [txNodeId(a)] };
    const shown = showAllGraphOutputs(removed);
    expect(new Set(shown.view.graphNodeIds)).toEqual(new Set(w.view.graphNodeIds));
    expect(shown.view.hiddenNodeIds).toBeUndefined();
    expect(shown.transactions).toBe(w.transactions);
    expect(shown.view.filters).toBe(removed.view.filters);
    expect(shown.inputContext).toBe(removed.inputContext);
    expect(showAllGraphOutputs(shown)).toBe(shown);
  });

  it('does not reveal hidden transactions or expand other loaded transactions and addresses', () => {
    const w = connectedWorkspace();
    const hidden = hideGraphNodes(w, [txNodeId(a)]);
    const shown = showAllGraphOutputs(hidden);
    expect(shown.view.hiddenNodeIds).toEqual([txNodeId(a), outputNodeId(a, 1)]);
    expect(shown.view.graphNodeIds).not.toContain(`addr:${address}`);
    const sparse = { ...w, view: { ...w.view, graphNodeIds: [txNodeId(b)] } };
    expect(new Set(showAllGraphOutputs(sparse).view.graphNodeIds)).toEqual(
      new Set([txNodeId(b), outputNodeId(a, 0), outputNodeId(b, 0)]),
    );
    expect(
      showAllGraphOutputs({ ...w, view: { ...w.view, graphNodeIds: [outputNodeId(a, 0)] } }).view
        .graphNodeIds,
    ).toEqual([outputNodeId(a, 0)]);
  });

  it('removes orphaned I/O but retains shared connections and unrelated existing orphans', () => {
    const w = connectedWorkspace();
    const unrelated = outputNodeId('c'.repeat(64), 0);
    w.view.graphNodeIds!.push(unrelated);
    const removed = removeGraphNodes(w, [txNodeId(a)]);
    expect(removed.view.graphNodeIds).toEqual([
      txNodeId(b),
      outputNodeId(a, 0),
      outputNodeId(b, 0),
      unrelated,
    ]);
    expect(removed.transactions).toBe(w.transactions);
    expect(removed.annotations).toBe(w.annotations);
    expect(removeGraphNodes(w, [txNodeId(a), txNodeId(b)]).view.graphNodeIds).toEqual([unrelated]);
  });

  it('hides newly orphaned I/O across sequential and batch hides and restores the group', () => {
    const w = connectedWorkspace();
    const first = hideGraphNodes(w, [txNodeId(a)]);
    expect(new Set(first.view.hiddenNodeIds)).toEqual(new Set([txNodeId(a), outputNodeId(a, 1)]));
    const second = hideGraphNodes(first, [txNodeId(b)]);
    expect(new Set(second.view.hiddenNodeIds)).toEqual(new Set(w.view.graphNodeIds));
    expect(new Set(hideGraphNodes(w, [txNodeId(a), txNodeId(b)]).view.hiddenNodeIds)).toEqual(
      new Set(w.view.graphNodeIds),
    );
    expect(second.view.graphNodeIds).toBe(w.view.graphNodeIds);
    expect(second.transactions).toBe(w.transactions);
    expect(showAllNodes(second).view.hiddenNodeIds).toBeUndefined();
    expect(addGraphNodes(second, [txNodeId(a)]).view.hiddenNodeIds).toContain(outputNodeId(a, 1));
  });

  it('counts admitted connections independently of filters, context scopes and address display', () => {
    const w = connectedWorkspace();
    w.view.graphNodeIds!.push(`addr:${address}`);
    w.inputContext = { [a]: [0] };
    w.view.smallAmountThreshold = 200_000_000;
    w.view.filters = { includeIds: [txNodeId(a)] };
    expect(w.view.showAddresses).toBe(false);
    const removed = removeGraphNodes(w, [txNodeId(a), txNodeId(b)]);
    expect(removed.view.graphNodeIds).toEqual([
      outputNodeId(a, 0),
      outputNodeId(a, 1),
      `addr:${address}`,
    ]);
    const hidden = hideGraphNodes(w, [txNodeId(a), txNodeId(b)]);
    expect(new Set(hidden.view.hiddenNodeIds)).toEqual(
      new Set([txNodeId(a), txNodeId(b), outputNodeId(b, 0)]),
    );
    w.view.hiddenNodeIds = [txNodeId(a), `addr:${address}`];
    expect(new Set(hideGraphNodes(w, [txNodeId(b)]).view.hiddenNodeIds)).toEqual(
      new Set([
        txNodeId(a),
        `addr:${address}`,
        txNodeId(b),
        outputNodeId(a, 0),
        outputNodeId(b, 0),
      ]),
    );
    expect(removeGraphNodes(w, [txNodeId(b)]).view.graphNodeIds).toContain(outputNodeId(a, 0));
  });

  it('keeps output hiding exact and ignores transactions outside graph membership', () => {
    const w = connectedWorkspace();
    const hidden = hideGraphNodes(w, [outputNodeId(a, 0)]);
    expect(hidden.view.hiddenNodeIds).toEqual([outputNodeId(a, 0)]);
    w.view.graphNodeIds = [outputNodeId(a, 0)];
    expect(hideGraphNodes(w, [txNodeId(a)]).view.hiddenNodeIds).toBeUndefined();
    expect(removeGraphNodes(w, [txNodeId(a)]).view.graphNodeIds).toEqual(w.view.graphNodeIds);
  });

  it('keeps newly loaded full transaction evidence off the canvas until explicitly added', () => {
    const w = workspace();
    expect(ids(w)).toEqual([]);
    const root = addGraphNodes(w, [txNodeId(a)]);
    expect(ids(root)).toEqual([txNodeId(a)]);
    const clicked = addGraphNodes(root, [outputNodeId(a, 1)]);
    expect(ids(clicked)).toEqual([txNodeId(a), outputNodeId(a, 1)]);
    expect(clicked.transactions).toBe(w.transactions);
    expect(clicked.transactions[a].vout).toHaveLength(2);
    expect(projectGraphMembership(buildGraph(clicked), clicked.view.graphNodeIds).links).toEqual([
      {
        id: `${txNodeId(a)}>${outputNodeId(a, 1)}`,
        source: txNodeId(a),
        target: outputNodeId(a, 1),
        kind: 'creates',
      },
    ]);
  });

  it('preserves all evidence, metadata, selection and geometry when removing exact nodes', () => {
    const w = addGraphNodes(workspace(), [txNodeId(a), outputNodeId(a, 0), outputNodeId(a, 1)]);
    w.view.selectionId = outputNodeId(a, 0);
    w.view.hiddenNodeIds = [outputNodeId(a, 0), outputNodeId(a, 1)];
    w.view.graphSnapshot = {
      version: 1,
      dimensions: 3,
      camera: {
        position: { x: 0, y: 0, z: 100 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      nodes: [{ id: outputNodeId(a, 0), x: 10, y: 20, z: 30 }],
    };
    w.annotations[outputNodeId(a, 0)] = {
      label: 'Keep note',
      note: 'Evidence remains loaded',
      bookmarked: true,
      icon: '',
    };
    const removed = removeGraphNodes(w, [outputNodeId(a, 0)]);
    expect(removed.transactions).toBe(w.transactions);
    expect(removed.annotations).toBe(w.annotations);
    expect(removed.findings).toBe(w.findings);
    expect(removed.view.graphSnapshot).toBe(w.view.graphSnapshot);
    expect(removed.view.selectionId).toBe(w.view.selectionId);
    expect(removed.view.hiddenNodeIds).toBe(w.view.hiddenNodeIds);
    expect(ids(removed)).toEqual([txNodeId(a), outputNodeId(a, 1)]);
    const restored = addGraphNodes(removed, [outputNodeId(a, 0)]);
    expect(restored.view.hiddenNodeIds).toEqual([outputNodeId(a, 1)]);
    expect(restored.view.graphSnapshot).toBe(w.view.graphSnapshot);
    expect(ids(restored)).toEqual(ids(w));
  });

  it.each([undefined, 1])(
    'migrates legacy schema %s once, retaining its scoped canvas',
    (version) => {
      const w = workspace();
      w.transactions[b] = structuredClone(spending);
      w.inputContext = { [a]: [0] };
      w.view.showAddresses = true;
      delete w.view.graphNodeIds;
      const { version: _version, ...unversioned } = w;
      const legacy = version === undefined ? unversioned : { ...unversioned, version };
      const before = structuredClone(legacy);
      const parsed = parseWorkspace(legacy);
      expect(parsed.version).toBe(4);
      expect(ids(parsed)).toEqual(buildGraph(w).nodes.map((node) => node.id));
      expect(parsed.view.graphNodeIds).not.toContain(outputNodeId(a, 1));
      expect(legacy).toEqual(before);
      const cleared = removeGraphNodes(parsed, parsed.view.graphNodeIds!);
      expect(parseWorkspace(cleared).view.graphNodeIds).toEqual([]);
      expect(ids(parseWorkspace(cleared))).toEqual([]);
    },
  );

  it('initializes legacy membership before evidence merge so unrelated new siblings stay out', () => {
    const w = workspace();
    delete w.view.graphNodeIds;
    const seeded = ensureGraphMembership(w);
    const merged = { ...seeded, transactions: { ...seeded.transactions, [b]: spending } };
    const added = addGraphNodes(merged, [txNodeId(b)]);
    expect(ids(added)).toContain(txNodeId(b));
    expect(ids(added)).not.toContain(outputNodeId(b, 0));
    expect(added.transactions[b].vout).toHaveLength(1);
    expect(w.view.graphNodeIds).toBeUndefined();
  });

  it('rejects missing membership in the current schema instead of repopulating the canvas', () => {
    const w = workspace();
    delete w.view.graphNodeIds;
    expect(() => parseWorkspace(w)).toThrow('missing explicit graph entity membership');
  });

  it('canonicalizes references, validates their network and bounds imports and actions', () => {
    expect(
      parseGraphNodeIds([`TX:${a.toUpperCase()}`, txNodeId(a), `out:${a}:0001`], 'mainnet'),
    ).toEqual([txNodeId(a), outputNodeId(a, 1)]);
    expect(() => parseGraphNodeIds([`addr:${address}`], 'testnet4')).toThrow();
    expect(() =>
      addGraphNodes(newWorkspace('Wrong network', 'testnet4'), [`addr:${address}`]),
    ).toThrow();
    expect(() => removeGraphNodes(workspace(), ['out:invalid:0'])).toThrow();
    expect(() =>
      parseGraphNodeIds(Array(MAX_GRAPH_NODES + 1).fill(txNodeId(a)), 'mainnet'),
    ).toThrow('graph entity limit');
    const w = workspace();
    expect(() =>
      parseWorkspace({
        ...w,
        view: { ...w.view, graphNodeIds: Array(MAX_GRAPH_NODES + 1).fill(txNodeId(a)) },
      }),
    ).toThrow('graph entity limit');
    expect(() => addGraphNodes(w, Array(MAX_GRAPH_ACTION_NODES + 1).fill(txNodeId(a)))).toThrow(
      'at most 50,000',
    );
    expect(w.view.graphNodeIds).toEqual([]);
  });

  it('does not project dangling links or discard input placeholder nodes explicitly admitted', () => {
    const w = workspace();
    w.transactions = { [b]: spending };
    const added = addGraphNodes(w, [txNodeId(b), outputNodeId(a, 0)]);
    const graph = projectGraphMembership(buildGraph(added), added.view.graphNodeIds);
    expect(graph.nodes.map((node) => node.id)).toEqual([txNodeId(b), outputNodeId(a, 0)]);
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0].kind).toBe('spends');
    expect(graph.nodes.find((node) => node.id === outputNodeId(a, 0))?.value).toBeUndefined();
    expect(projectGraphMembership(buildGraph(added), [outputNodeId(a, 0)]).links).toEqual([]);
  });

  it.each(['mainnet-wabisabi', 'testnet4-mixed-path'])(
    'projects only the curated starting canvas for example %s',
    async (template) => {
      const w = await createTemplateWorkspace(template);
      const root = txNodeId(w.view.transactionFlow!.transactionId!);
      const graph = projectGraphMembership(buildGraph(w), w.view.graphNodeIds);
      const visible = new Set(graph.nodes.map((node) => node.id));
      expect(visible).toEqual(new Set(w.view.graphNodeIds));
      expect(visible.has(root)).toBe(true);
      expect(visible.has(w.view.selectionId!)).toBe(true);
      expect(graph.links.some((link) => link.kind === 'spends' && link.target === root)).toBe(true);
      expect(graph.links.some((link) => link.kind === 'creates' && link.source === root)).toBe(
        true,
      );
      // The CoinJoin example opens on its complete transaction; the other keeps a
      // curated subset of the loaded evidence.
      if (template === 'mainnet-wabisabi') expect(visible.size).toBe(buildGraph(w).nodes.length);
      else expect(visible.size).toBeLessThan(buildGraph(w).nodes.length);
      expect(parseWorkspace(w)).toEqual(w);
    },
  );
});
