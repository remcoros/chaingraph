import { describe, expect, it } from 'vitest';
import { legacyWorkspace } from '../../../../tests/fixtures/legacyWorkspace';
import {
  addGraphNodes,
  ensureGraphMembership,
  fullGraphMembershipEvidence,
  hideGraphNodes,
  projectGraphAddresses,
  projectGraphMembership,
  removeGraphNodes,
  showAllGraphOutputs,
} from './graphMembership';
import {
  MAX_GRAPH_ACTION_NODES,
  MAX_GRAPH_NODES,
  parseGraphNodeIds,
} from '../../../Core/Workspace/view';
import { outpointReference, transactionReference } from '../../../Core/Workspace/entityReferences';
import { graphUnconnectedOutputIds } from './graphBranch';

import type { Transaction } from '../../../Core/ChainData';
import { buildGraph } from './graphEvidence';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../Core/Workspace/Persistence';
import { createTemplateWorkspace } from '../../Examples/workspaceTemplates';
import { showAllNodes } from './visibility';

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
  const w = createWorkspace('Explicit graph fixture', 'mainnet');
  w.chainData.transactions = { [a]: structuredClone(funding) };
  return w;
}
const ids = (w: ReturnType<typeof workspace>) =>
  projectGraphMembership(buildGraph(w), w.view.graphNodeIds).nodes.map((node) => node.id);

describe('address display projection', () => {
  it('never adds an address outside explicit membership, including retained context', () => {
    const w = addGraphNodes(workspace(), [transactionReference(a), outpointReference(a, 0)]);
    const evidence = fullGraphMembershipEvidence(w);
    expect(evidence.nodes.some((node) => node.id === `addr:${address}`)).toBe(true);
    const members = projectGraphMembership(evidence, w.view.graphNodeIds);
    expect(projectGraphAddresses(members, true)).toBe(members);
    expect(projectGraphAddresses(members, false, new Set([`addr:${address}`]))).toBe(members);
    expect(members.nodes.map((node) => node.id)).toEqual([
      transactionReference(a),
      outpointReference(a, 0),
    ]);
  });

  it('retains requested address context and non-address connections without changing evidence', () => {
    const otherAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
    const w = workspace();
    w.chainData.transactions[a].vout[1].scriptPubKey.address = otherAddress;
    w.chainData.transactions[b] = structuredClone(spending);
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
    w.chainData.transactions[b] = structuredClone(spending);
    return addGraphNodes(w, [
      transactionReference(a),
      transactionReference(b),
      outpointReference(a, 0),
      outpointReference(a, 1),
      outpointReference(b, 0),
    ]);
  }

  it('protects connecting I/O from terminal hide/remove even when temporary filters conceal neighbors', () => {
    const w = connectedWorkspace();
    w.view.graphNodeIds!.push(`addr:${address}`);
    w.view.inputContext = { [a]: [0] };
    w.view.smallAmountThreshold = 200_000_000;
    w.view.filters = { includeIds: [transactionReference(a)] };
    const evidence = fullGraphMembershipEvidence(w);
    const terminal = graphUnconnectedOutputIds(evidence, new Set(w.view.graphNodeIds));
    expect(terminal).toEqual(new Set([outpointReference(b, 0)]));
    expect(hideGraphNodes(w, terminal).view.hiddenNodeIds).toEqual([outpointReference(b, 0)]);
    expect(removeGraphNodes(w, terminal).view.graphNodeIds).toContain(outpointReference(a, 0));
    expect(removeGraphNodes(w, terminal).view.graphNodeIds).toContain(outpointReference(a, 1));

    w.view.hiddenNodeIds = [transactionReference(b), `addr:${address}`];
    const visible = new Set(
      w.view.graphNodeIds!.filter((id) => !w.view.hiddenNodeIds!.includes(id)),
    );
    const hideable = graphUnconnectedOutputIds(evidence, visible);
    expect(hideable).toEqual(
      new Set([outpointReference(a, 0), outpointReference(a, 1), outpointReference(b, 0)]),
    );
    // Removing still protects bridges to hidden members; hiding uses manual visibility.
    expect(graphUnconnectedOutputIds(evidence, new Set(w.view.graphNodeIds))).toEqual(terminal);
    expect(new Set(hideGraphNodes(w, hideable).view.hiddenNodeIds)).toEqual(
      new Set([transactionReference(b), `addr:${address}`, ...hideable]),
    );
  });

  it('shows all loaded direct I/O of canvas transactions and restores hidden or removed I/O without fetching', () => {
    const w = connectedWorkspace();
    const hidden = hideGraphNodes(w, [outpointReference(a, 0), outpointReference(b, 0)]);
    const removed = removeGraphNodes(hidden, [outpointReference(a, 1)]);
    removed.view.inputContext = { [a]: [0] };
    removed.view.smallAmountThreshold = 200_000_000;
    removed.view.filters = { includeIds: [transactionReference(a)] };
    const shown = showAllGraphOutputs(removed);
    expect(new Set(shown.view.graphNodeIds)).toEqual(new Set(w.view.graphNodeIds));
    expect(shown.view.hiddenNodeIds).toBeUndefined();
    expect(shown.chainData.transactions).toBe(w.chainData.transactions);
    expect(shown.view.filters).toBe(removed.view.filters);
    expect(shown.view.inputContext).toBe(removed.view.inputContext);
    expect(showAllGraphOutputs(shown)).toBe(shown);
  });

  it('does not reveal hidden transactions or expand other loaded transactions and addresses', () => {
    const w = connectedWorkspace();
    const hidden = hideGraphNodes(w, [transactionReference(a)]);
    const shown = showAllGraphOutputs(hidden);
    expect(shown.view.hiddenNodeIds).toEqual([transactionReference(a), outpointReference(a, 1)]);
    expect(shown.view.graphNodeIds).not.toContain(`addr:${address}`);
    const sparse = { ...w, view: { ...w.view, graphNodeIds: [transactionReference(b)] } };
    expect(new Set(showAllGraphOutputs(sparse).view.graphNodeIds)).toEqual(
      new Set([transactionReference(b), outpointReference(a, 0), outpointReference(b, 0)]),
    );
    expect(
      showAllGraphOutputs({ ...w, view: { ...w.view, graphNodeIds: [outpointReference(a, 0)] } })
        .view.graphNodeIds,
    ).toEqual([outpointReference(a, 0)]);
  });

  it('removes orphaned I/O but retains shared connections and unrelated existing orphans', () => {
    const w = connectedWorkspace();
    const unrelated = outpointReference('c'.repeat(64), 0);
    w.view.graphNodeIds!.push(unrelated);
    const removed = removeGraphNodes(w, [transactionReference(a)]);
    expect(removed.view.graphNodeIds).toEqual([
      transactionReference(b),
      outpointReference(a, 0),
      outpointReference(b, 0),
      unrelated,
    ]);
    expect(removed.chainData.transactions).toBe(w.chainData.transactions);
    expect(removed.annotations.entities).toBe(w.annotations.entities);
    expect(
      removeGraphNodes(w, [transactionReference(a), transactionReference(b)]).view.graphNodeIds,
    ).toEqual([unrelated]);
  });

  it('hides newly orphaned I/O across sequential and batch hides and restores the group', () => {
    const w = connectedWorkspace();
    const first = hideGraphNodes(w, [transactionReference(a)]);
    expect(new Set(first.view.hiddenNodeIds)).toEqual(
      new Set([transactionReference(a), outpointReference(a, 1)]),
    );
    const second = hideGraphNodes(first, [transactionReference(b)]);
    expect(new Set(second.view.hiddenNodeIds)).toEqual(new Set(w.view.graphNodeIds));
    expect(
      new Set(
        hideGraphNodes(w, [transactionReference(a), transactionReference(b)]).view.hiddenNodeIds,
      ),
    ).toEqual(new Set(w.view.graphNodeIds));
    expect(second.view.graphNodeIds).toBe(w.view.graphNodeIds);
    expect(second.chainData.transactions).toBe(w.chainData.transactions);
    expect(showAllNodes(second).view.hiddenNodeIds).toBeUndefined();
    expect(addGraphNodes(second, [transactionReference(a)]).view.hiddenNodeIds).toContain(
      outpointReference(a, 1),
    );
  });

  it('counts admitted connections independently of filters, context scopes and address display', () => {
    const w = connectedWorkspace();
    w.view.graphNodeIds!.push(`addr:${address}`);
    w.view.inputContext = { [a]: [0] };
    w.view.smallAmountThreshold = 200_000_000;
    w.view.filters = { includeIds: [transactionReference(a)] };
    expect(w.view.showAddresses).toBe(false);
    const removed = removeGraphNodes(w, [transactionReference(a), transactionReference(b)]);
    expect(removed.view.graphNodeIds).toEqual([
      outpointReference(a, 0),
      outpointReference(a, 1),
      `addr:${address}`,
    ]);
    const hidden = hideGraphNodes(w, [transactionReference(a), transactionReference(b)]);
    expect(new Set(hidden.view.hiddenNodeIds)).toEqual(
      new Set([transactionReference(a), transactionReference(b), outpointReference(b, 0)]),
    );
    w.view.hiddenNodeIds = [transactionReference(a), `addr:${address}`];
    expect(new Set(hideGraphNodes(w, [transactionReference(b)]).view.hiddenNodeIds)).toEqual(
      new Set([
        transactionReference(a),
        `addr:${address}`,
        transactionReference(b),
        outpointReference(a, 0),
        outpointReference(b, 0),
      ]),
    );
    expect(removeGraphNodes(w, [transactionReference(b)]).view.graphNodeIds).toContain(
      outpointReference(a, 0),
    );
  });

  it('keeps output hiding exact and ignores transactions outside graph membership', () => {
    const w = connectedWorkspace();
    const hidden = hideGraphNodes(w, [outpointReference(a, 0)]);
    expect(hidden.view.hiddenNodeIds).toEqual([outpointReference(a, 0)]);
    w.view.graphNodeIds = [outpointReference(a, 0)];
    expect(hideGraphNodes(w, [transactionReference(a)]).view.hiddenNodeIds).toBeUndefined();
    expect(removeGraphNodes(w, [transactionReference(a)]).view.graphNodeIds).toEqual(
      w.view.graphNodeIds,
    );
  });

  it('keeps newly loaded full transaction evidence off the canvas until explicitly added', () => {
    const w = workspace();
    expect(ids(w)).toEqual([]);
    const root = addGraphNodes(w, [transactionReference(a)]);
    expect(ids(root)).toEqual([transactionReference(a)]);
    const clicked = addGraphNodes(root, [outpointReference(a, 1)]);
    expect(ids(clicked)).toEqual([transactionReference(a), outpointReference(a, 1)]);
    expect(clicked.chainData.transactions).toBe(w.chainData.transactions);
    expect(clicked.chainData.transactions[a].vout).toHaveLength(2);
    expect(projectGraphMembership(buildGraph(clicked), clicked.view.graphNodeIds).links).toEqual([
      {
        id: `${transactionReference(a)}>${outpointReference(a, 1)}`,
        source: transactionReference(a),
        target: outpointReference(a, 1),
        kind: 'creates',
      },
    ]);
  });

  it('preserves all evidence, metadata, selection and geometry when removing exact nodes', () => {
    const w = addGraphNodes(workspace(), [
      transactionReference(a),
      outpointReference(a, 0),
      outpointReference(a, 1),
    ]);
    w.view.selectionId = outpointReference(a, 0);
    w.view.hiddenNodeIds = [outpointReference(a, 0), outpointReference(a, 1)];
    w.view.graphSnapshot = {
      version: 1,
      dimensions: 3,
      camera: {
        position: { x: 0, y: 0, z: 100 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      nodes: [{ id: outpointReference(a, 0), x: 10, y: 20, z: 30 }],
    };
    w.annotations.entities[outpointReference(a, 0)] = {
      label: 'Keep note',
      note: 'Evidence remains loaded',
      bookmarked: true,
      icon: '',
    };
    const removed = removeGraphNodes(w, [outpointReference(a, 0)]);
    expect(removed.chainData.transactions).toBe(w.chainData.transactions);
    expect(removed.annotations.entities).toBe(w.annotations.entities);
    expect(removed.analysis.findings).toBe(w.analysis.findings);
    expect(removed.view.graphSnapshot).toBe(w.view.graphSnapshot);
    expect(removed.view.selectionId).toBe(w.view.selectionId);
    expect(removed.view.hiddenNodeIds).toBe(w.view.hiddenNodeIds);
    expect(ids(removed)).toEqual([transactionReference(a), outpointReference(a, 1)]);
    const restored = addGraphNodes(removed, [outpointReference(a, 0)]);
    expect(restored.view.hiddenNodeIds).toEqual([outpointReference(a, 1)]);
    expect(restored.view.graphSnapshot).toBe(w.view.graphSnapshot);
    expect(ids(restored)).toEqual(ids(w));
  });

  it.each([undefined, 1])(
    'migrates legacy schema %s once, retaining its scoped canvas',
    (version) => {
      const w = workspace();
      w.chainData.transactions[b] = structuredClone(spending);
      w.view.inputContext = { [a]: [0] };
      w.view.showAddresses = true;
      delete w.view.graphNodeIds;
      const unversioned = legacyWorkspace(w);
      const legacy = version === undefined ? unversioned : { ...unversioned, version };
      const before = structuredClone(legacy);
      const parsed = parseWorkspace(legacy);
      expect(parsed.version).toBe(6);
      expect(ids(parsed)).toEqual(buildGraph(w).nodes.map((node) => node.id));
      expect(parsed.view.graphNodeIds).not.toContain(outpointReference(a, 1));
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
    const merged = {
      ...seeded,
      chainData: {
        ...seeded.chainData,
        transactions: { ...seeded.chainData.transactions, [b]: spending },
      },
    };
    const added = addGraphNodes(merged, [transactionReference(b)]);
    expect(ids(added)).toContain(transactionReference(b));
    expect(ids(added)).not.toContain(outpointReference(b, 0));
    expect(added.chainData.transactions[b].vout).toHaveLength(1);
    expect(w.view.graphNodeIds).toBeUndefined();
  });

  it('rejects missing membership in the current schema instead of repopulating the canvas', () => {
    const w = workspace();
    delete w.view.graphNodeIds;
    expect(() => parseWorkspace(w)).toThrow('missing explicit graph entity membership');
  });

  it('canonicalizes references, validates their network and bounds imports and actions', () => {
    expect(
      parseGraphNodeIds(
        [`TX:${a.toUpperCase()}`, transactionReference(a), `out:${a}:0001`],
        'mainnet',
      ),
    ).toEqual([transactionReference(a), outpointReference(a, 1)]);
    expect(() => parseGraphNodeIds([`addr:${address}`], 'testnet4')).toThrow();
    expect(() =>
      addGraphNodes(createWorkspace('Wrong network', 'testnet4'), [`addr:${address}`]),
    ).toThrow();
    expect(() => removeGraphNodes(workspace(), ['out:invalid:0'])).toThrow();
    expect(() =>
      parseGraphNodeIds(Array(MAX_GRAPH_NODES + 1).fill(transactionReference(a)), 'mainnet'),
    ).toThrow('graph entity limit');
    const w = workspace();
    expect(() =>
      parseWorkspace({
        ...w,
        view: { ...w.view, graphNodeIds: Array(MAX_GRAPH_NODES + 1).fill(transactionReference(a)) },
      }),
    ).toThrow('graph entity limit');
    expect(() =>
      addGraphNodes(w, Array(MAX_GRAPH_ACTION_NODES + 1).fill(transactionReference(a))),
    ).toThrow('at most 50,000');
    expect(w.view.graphNodeIds).toEqual([]);
  });

  it('does not project dangling links or discard input placeholder nodes explicitly admitted', () => {
    const w = workspace();
    w.chainData.transactions = { [b]: spending };
    const added = addGraphNodes(w, [transactionReference(b), outpointReference(a, 0)]);
    const graph = projectGraphMembership(buildGraph(added), added.view.graphNodeIds);
    expect(graph.nodes.map((node) => node.id)).toEqual([
      transactionReference(b),
      outpointReference(a, 0),
    ]);
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0].kind).toBe('spends');
    expect(graph.nodes.find((node) => node.id === outpointReference(a, 0))?.value).toBeUndefined();
    expect(projectGraphMembership(buildGraph(added), [outpointReference(a, 0)]).links).toEqual([]);
  });

  it.each(['mainnet-wabisabi', 'testnet4-mixed-path'])(
    'projects only the curated starting canvas for example %s',
    async (template) => {
      const w = await createTemplateWorkspace(template);
      const root = transactionReference(w.view.panels!.flow!.transactionId!);
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
