import { describe, expect, it } from 'vitest';
import { deriveAddresses } from '../../Core/Workspace/Wallets/walletDerivation';
import type { Wallet } from '../../Core/Workspace/Wallets/wallets';

import { planEntityRemoval } from '../../Core/Workspace/entityRemoval';
import { removeWorkspaceEntity } from './entityRemoval';
import { addGraphNodes, projectGraphMembership } from './GraphState/graphMembership';
import { buildGraph } from './GraphState/graphEvidence';
import { createWorkspace } from '../../Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../Core/Workspace/Persistence';
import {
  promoteInputContext,
  markContextTransactions,
  clearContextProvenance,
} from '../../Core/Workspace/transactionContext';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';

const parent = 'a'.repeat(64),
  child = 'b'.repeat(64);
const address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const note = { label: '', note: 'Investigation note', icon: '', bookmarked: false };
function fixture() {
  const w = createWorkspace('Removal fixture', 'mainnet');
  w.chainData.transactions = {
    [parent]: {
      txid: parent,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    },
    [child]: {
      txid: child,
      vin: [{ txid: parent, vout: 0 }],
      vout: [{ n: 0, value: 0.9, scriptPubKey: { hex: '51' } }],
    },
  };
  return w;
}
describe('workspace entity removal', () => {
  it('does not retain an orphan input through an address edge lost with its creating transaction', () => {
    const w = fixture();
    const output = `out:${parent}:0`;
    const destination = `addr:${address}`;
    w.chainData.transactions[parent].vout[0].scriptPubKey = { address };
    w.chainData.watchedAddresses = [address];
    w.view.graphNodeIds = [`tx:${parent}`, output, destination];
    const next = removeWorkspaceEntity(w, `tx:${parent}`);
    expect(next.chainData.transactions[child]).toBe(w.chainData.transactions[child]);
    expect(buildGraph(next).nodes.some((node) => node.id === output)).toBe(true);
    expect(next.chainData.watchedAddresses).toEqual([address]);
    expect(next.view.graphNodeIds).toEqual([destination]);
    expect(parseWorkspace(next)).toEqual(next);
  });

  it.each([false, true])(
    'cleans up a removed transaction’s input only when its loaded parent is off the canvas (parent admitted: %s)',
    (parentAdmitted) => {
      const w = fixture();
      const inputId = `out:${parent}:0`;
      w.view.graphNodeIds = [
        ...(parentAdmitted ? [`tx:${parent}`] : []),
        `tx:${child}`,
        inputId,
        `out:${child}:0`,
      ];
      w.annotations.entities[inputId] = note;
      w.annotations.tags = [
        { id: crypto.randomUUID(), name: 'Keep evidence', color: '#339988', nodeIds: [inputId] },
      ];
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.view.graphNodeIds).toEqual(parentAdmitted ? [`tx:${parent}`, inputId] : []);
      expect(next.chainData.transactions[parent]).toBe(w.chainData.transactions[parent]);
      expect(next.chainData.transactions[child]).toBeUndefined();
      expect(next.annotations.entities[inputId]).toBe(note);
      expect(next.annotations.tags).toEqual(w.annotations.tags);
      expect(next.chainData.transactions[parent].vout).toHaveLength(1);
      expect(parseWorkspace(next)).toEqual(next);
      expect(w.view.graphNodeIds).toContain(inputId);
    },
  );

  it('does not resurrect removed siblings when a transaction is reloaded, while retaining shared outpoints', () => {
    const w = fixture();
    w.chainData.transactions[parent].vout.push({ n: 1, value: 0.5, scriptPubKey: { hex: '51' } });
    w.view.graphNodeIds = buildGraph(w).nodes.map((node) => node.id);
    const removed = removeWorkspaceEntity(w, `tx:${parent}`);
    expect(removed.view.graphNodeIds).toContain(`out:${parent}:0`);
    expect(removed.view.graphNodeIds).not.toContain(`tx:${parent}`);
    expect(removed.view.graphNodeIds).not.toContain(`out:${parent}:1`);
    const reloaded = addGraphNodes(
      {
        ...removed,
        chainData: {
          ...removed.chainData,
          transactions: {
            ...removed.chainData.transactions,
            [parent]: w.chainData.transactions[parent],
          },
        },
      },
      [`tx:${parent}`],
    );
    const ids = projectGraphMembership(buildGraph(reloaded), reloaded.view.graphNodeIds).nodes.map(
      (node) => node.id,
    );
    expect(ids).toContain(`tx:${parent}`);
    expect(ids).toContain(`out:${parent}:0`);
    expect(ids).not.toContain(`out:${parent}:1`);
    expect(reloaded.chainData.transactions[parent].vout).toHaveLength(2);
  });

  it('prunes only vanished address membership, preserving loaded associations even with addresses switched off', () => {
    for (const hasLoadedAssociation of [false, true]) {
      const w = fixture();
      w.chainData.watchedAddresses = [address];
      if (hasLoadedAssociation) w.chainData.transactions[parent].vout[0].scriptPubKey = { address };
      w.view.graphNodeIds = [`addr:${address}`, `tx:${'f'.repeat(64)}`];
      expect(w.view.showAddresses).toBe(false);
      const removed = removeWorkspaceEntity(w, `addr:${address}`);
      expect(removed.view.graphNodeIds?.includes(`addr:${address}`)).toBe(hasLoadedAssociation);
      expect(removed.view.graphNodeIds).toContain(`tx:${'f'.repeat(64)}`);
      expect(removed.chainData.transactions).toBe(w.chainData.transactions);
    }
  });

  it('removes unannotated transactions immediately but never edits individual outputs or inputs', () => {
    const w = fixture();
    expect(planEntityRemoval(w, `tx:${parent}`)?.requiresConfirmation).toBe(false);
    expect(planEntityRemoval(w, `out:${parent}:0`)).toBeUndefined();
    expect(removeWorkspaceEntity(w, `out:${parent}:0`)).toBe(w);
    const next = removeWorkspaceEntity(w, `tx:${parent}`);
    expect(next.chainData.transactions[parent]).toBeUndefined();
    expect(next.chainData.transactions[child]).toBe(w.chainData.transactions[child]);
    expect(buildGraph(next).nodes.some((node) => node.id === `out:${parent}:0`)).toBe(true);
    expect(w.chainData.transactions[parent]).toBeDefined();
    expect(() => parseWorkspace(next)).not.toThrow();
  });
  it('includes output notes, imported output tags and bookmarks in confirmation and preserves unrelated metadata', () => {
    const w = fixture();
    w.annotations.entities[`out:${parent}:0`] = note;
    w.annotations.entities[`tx:${child}`] = { ...note, label: 'Keep child' };
    w.view.inputContext = { [parent]: [0] };
    w.annotations.tags = [
      {
        id: crypto.randomUUID(),
        name: 'Shop',
        color: '#339988',
        nodeIds: [`out:${parent}:0`, `out:${parent}:7`, `tx:${child}`],
      },
    ];
    const plan = planEntityRemoval(w, `tx:${parent}`)!;
    expect(plan).toMatchObject({
      requiresConfirmation: true,
      annotationCount: 1,
      tagMembershipCount: 2,
    });
    const next = removeWorkspaceEntity(w, plan.nodeId);
    expect(next.view.inputContext).toBeUndefined();
    expect(next.annotations.entities).toEqual({
      [`tx:${child}`]: w.annotations.entities[`tx:${child}`],
    });
    expect(next.annotations.tags?.[0].nodeIds).toEqual([`tx:${child}`]);
    expect(next.annotations.tags?.[0].name).toBe('Shop');
    expect(w.annotations.tags[0].nodeIds).toHaveLength(3);
    expect(() => parseWorkspace(next)).not.toThrow();
    const bookmarked = fixture();
    bookmarked.annotations.entities[`tx:${parent}`] = {
      label: '',
      note: '',
      icon: '',
      bookmarked: true,
    };
    expect(planEntityRemoval(bookmarked, `tx:${parent}`)?.requiresConfirmation).toBe(true);
  });
  it('stops address monitoring and removes its annotations without changing shared transaction facts', () => {
    const w = fixture();
    w.chainData.watchedAddresses = [address];
    w.annotations.entities[`addr:${address}`] = { ...note, icon: '★' };
    w.annotations.tags = [
      {
        id: crypto.randomUUID(),
        name: 'Address group',
        color: '#339988',
        nodeIds: [`addr:${address}`, `tx:${child}`],
      },
    ];
    expect(planEntityRemoval(w, `addr:${address}`)).toMatchObject({
      kind: 'watched-address',
      requiresConfirmation: true,
    });
    const next = removeWorkspaceEntity(w, `addr:${address}`);
    expect(next.chainData.watchedAddresses).toEqual([]);
    expect(next.chainData.transactions).toBe(w.chainData.transactions);
    expect(next.annotations.entities[`addr:${address}`]).toBeUndefined();
    expect(next.annotations.tags?.[0].nodeIds).toEqual([`tx:${child}`]);
    expect(planEntityRemoval(next, `addr:${address}`)).toBeUndefined();
    expect(() => parseWorkspace(next)).not.toThrow();
  });
});

const grandparent = 'c'.repeat(64),
  other = 'd'.repeat(64);
function automaticBranch() {
  const w = fixture();
  w.chainData.transactions[grandparent] = {
    txid: grandparent,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 2, scriptPubKey: { hex: '51' } }],
  };
  w.chainData.transactions[parent] = {
    ...w.chainData.transactions[parent],
    vin: [{ txid: grandparent, vout: 0 }],
    vout: [
      ...w.chainData.transactions[parent].vout,
      { n: 1, value: 0.5, scriptPubKey: { hex: '51' } },
    ],
  };
  w.view.inputContext = { [parent]: [0], [grandparent]: [0] };
  return w;
}

describe('automatic ancestor cleanup after transaction removal', () => {
  it('removes an isolated explicit transaction and its multilevel automatic input branch', () => {
    const w = automaticBranch();
    w.view.hiddenNodeIds = [`out:${parent}:0`, `tx:${child}`];
    w.view.selectionId = `tx:${parent}`;
    w.view.panels = { flow: { height: 'expanded', transactionId: parent } };
    w.view.filters = {
      includeIds: [`tx:${child}`, `tx:${parent}`],
      focus: { id: `tx:${parent}`, hops: 1 },
    };
    const plan = planEntityRemoval(w, `tx:${child}`)!;
    expect(new Set(plan.removedTransactionIds)).toEqual(new Set([child, parent, grandparent]));
    expect(plan.automaticContextCount).toBe(2);
    expect(plan.requiresConfirmation).toBe(false);
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(next.chainData.transactions).toEqual({});
    expect(next.view.inputContext).toBeUndefined();
    expect(buildGraph(next)).toEqual({ nodes: [], links: [] });
    expect(next.view.hiddenNodeIds).toEqual([]);
    expect(next.view.selectionId).toBeUndefined();
    expect(next.view.panels?.flow?.transactionId).toBeUndefined();
    expect(next.view.filters).toMatchObject({ includeIds: [], focus: undefined });
    expect(Object.keys(w.chainData.transactions)).toHaveLength(3);
    expect(() => parseWorkspace(next)).not.toThrow();
  });

  it('retains a shared parent and its ancestry but removes the abandoned output scope', () => {
    const w = automaticBranch();
    w.chainData.transactions[other] = {
      ...w.chainData.transactions[child],
      txid: other,
      vin: [{ txid: parent, vout: 1 }],
    };
    w.view.inputContext![parent] = [0, 1];
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(planEntityRemoval(w, `tx:${child}`)?.automaticContextCount).toBe(0);
    expect(Object.keys(next.chainData.transactions).sort()).toEqual(
      [parent, grandparent, other].sort(),
    );
    expect(next.view.inputContext).toEqual({ [parent]: [1], [grandparent]: [0] });
    const ids = buildGraph(next).nodes.map((node) => node.id);
    expect(ids).toContain(`out:${parent}:1`);
    expect(ids).not.toContain(`out:${parent}:0`);
    expect(() => parseWorkspace(next)).not.toThrow();
  });

  it('preserves an independently loaded parent and its automatic dependencies', () => {
    const w = automaticBranch();
    delete w.view.inputContext![parent];
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(next.chainData.transactions[parent]).toBe(w.chainData.transactions[parent]);
    expect(next.chainData.transactions[grandparent]).toBe(w.chainData.transactions[grandparent]);
    expect(next.view.inputContext).toEqual({ [grandparent]: [0] });
  });

  for (const protection of ['note', 'bookmark', 'tag'] as const)
    it(`retains annotated orphan context protected by ${protection}`, () => {
      const w = automaticBranch();
      if (protection === 'tag')
        w.annotations.tags = [
          {
            id: crypto.randomUUID(),
            name: 'Retain evidence',
            color: '#339988',
            nodeIds: [`out:${parent}:0`],
          },
        ];
      else
        w.annotations.entities[`out:${parent}:0`] =
          protection === 'bookmark' ? { ...note, note: '', bookmarked: true } : note;
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.chainData.transactions[parent]).toBe(w.chainData.transactions[parent]);
      expect(next.chainData.transactions[grandparent]).toBe(w.chainData.transactions[grandparent]);
      expect(next.annotations.entities).toEqual(w.annotations.entities);
      expect(next.annotations.tags).toEqual(w.annotations.tags);
      expect(planEntityRemoval(w, `tx:${child}`)?.annotationCount).toBe(0);
      expect(() => parseWorkspace(next)).not.toThrow();
    });

  it('retains annotated address provenance and watched-address observations in automatic context', () => {
    for (const watched of [true, false]) {
      const w = automaticBranch();
      w.chainData.transactions[parent].vout[0].scriptPubKey = { address };
      if (watched) w.chainData.watchedAddresses = [address];
      else w.annotations.entities[`addr:${address}`] = note;
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.chainData.transactions[parent]).toBeDefined();
      expect(next.chainData.transactions[grandparent]).toBeDefined();
      expect(next.annotations.entities).toEqual(w.annotations.entities);
      expect(next.chainData.watchedAddresses).toEqual(w.chainData.watchedAddresses);
      expect(() => parseWorkspace(next)).not.toThrow();
    }
  });

  it('retains wallet history and activity references without modifying wallet metadata', () => {
    const key =
      'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    const derived = deriveAddresses(key, 'mainnet', 'p2wpkh', 0, 0, 1);
    for (const source of ['history', 'owned-output', 'owned-script'] as const) {
      const w = automaticBranch();
      const wallet: Wallet = {
        id: crypto.randomUUID(),
        name: 'Public BIP84 fixture',
        key,
        scriptType: 'p2wpkh',
        color: '#339988',
        addresses: derived.map((entry) => ({
          ...entry,
          history: source === 'history' ? [{ tx_hash: parent, height: 100 }] : [],
        })),
      };
      if (source === 'owned-output')
        w.chainData.transactions[parent].vout[0].scriptPubKey = { address: derived[0].address };
      if (source === 'owned-script')
        w.chainData.transactions[parent].vout[0].scriptPubKey = {
          hex: Buffer.from(
            bitcoinAddress.toOutputScript(derived[0].address, networks.bitcoin),
          ).toString('hex'),
        };
      w.wallets.definitions = [wallet];
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.chainData.transactions[parent]).toBe(w.chainData.transactions[parent]);
      expect(next.chainData.transactions[grandparent]).toBe(w.chainData.transactions[grandparent]);
      expect(next.wallets.definitions).toBe(w.wallets.definitions);
      expect(() => parseWorkspace(next)).not.toThrow();
    }
  });

  it('does not clean up or shrink unrelated automatic context', () => {
    const w = automaticBranch();
    const unrelated = 'e'.repeat(64),
      consumer = 'f'.repeat(64);
    w.chainData.transactions[unrelated] = {
      ...w.chainData.transactions[parent],
      txid: unrelated,
      vin: [{ coinbase: '00' }],
    };
    w.chainData.transactions[consumer] = {
      ...w.chainData.transactions[child],
      txid: consumer,
      vin: [{ txid: unrelated, vout: 0 }],
    };
    w.view.inputContext![unrelated] = [0, 1];
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(Object.keys(next.chainData.transactions).sort()).toEqual([unrelated, consumer].sort());
    expect(next.view.inputContext).toEqual({ [unrelated]: [0, 1] });
  });
});

describe('automatic ancestry provenance independent of render scope', () => {
  it('keeps promoted automatic ancestry removable with the original branch', () => {
    const original = automaticBranch();
    const expanded = promoteInputContext(original, [parent, grandparent]);
    expect(expanded.view.inputContext).toBeUndefined();
    expect(new Set(expanded.chainData.contextTransactionIds)).toEqual(
      new Set([parent, grandparent]),
    );
    expect(planEntityRemoval(expanded, `tx:${child}`)?.automaticContextCount).toBe(2);
    const next = removeWorkspaceEntity(expanded, `tx:${child}`);
    expect(buildGraph(next).nodes).toHaveLength(0);
    expect(next.chainData.contextTransactionIds ?? []).toEqual([]);
    expect(() => parseWorkspace(next)).not.toThrow();
  });

  it('marks newly fetched ancestry and gives explicit observations independent lifetime', () => {
    const original = automaticBranch();
    delete original.view.inputContext;
    const marked = markContextTransactions(original, [parent, grandparent, parent, 'f'.repeat(64)]);
    expect(marked.chainData.contextTransactionIds).toEqual([parent, grandparent]);
    expect(markContextTransactions(marked, [parent])).toBe(marked);
    const independent = clearContextProvenance(marked, [parent]);
    expect(independent.chainData.contextTransactionIds).toEqual([grandparent]);
    expect(clearContextProvenance(independent, [parent])).toBe(independent);
    const next = removeWorkspaceEntity(independent, `tx:${child}`);
    expect(next.chainData.transactions[parent]).toBe(original.chainData.transactions[parent]);
    expect(next.chainData.transactions[grandparent]).toBe(
      original.chainData.transactions[grandparent],
    );
    expect(() => parseWorkspace(next)).not.toThrow();
    const legacy = clearContextProvenance(automaticBranch(), [parent]);
    expect(legacy.view.inputContext).toEqual({ [grandparent]: [0] });
    expect(legacy.chainData.contextTransactionIds).toBeUndefined();
  });

  it('rejects duplicate, missing and excessive provenance records at import/save validation', () => {
    const w = automaticBranch();
    expect(() =>
      parseWorkspace({
        ...w,
        chainData: { ...w.chainData, contextTransactionIds: [parent, parent] },
      }),
    ).toThrow('duplicate');
    expect(() =>
      parseWorkspace({
        ...w,
        chainData: { ...w.chainData, contextTransactionIds: ['f'.repeat(64)] },
      }),
    ).toThrow('loaded transaction');
    expect(() =>
      parseWorkspace({
        ...w,
        chainData: { ...w.chainData, contextTransactionIds: Array(10001).fill(parent) },
      }),
    ).toThrow('10,000 context transaction limit');
    expect(
      parseWorkspace({ ...w, chainData: { ...w.chainData, contextTransactionIds: [parent] } })
        .chainData.contextTransactionIds,
    ).toEqual([parent]);
  });
});
