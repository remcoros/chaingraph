import { describe, expect, it } from 'vitest';
import { deriveAddresses } from '../src/lib/wallet';
import type { Wallet } from '../src/domain/types';
import { planEntityRemoval, removeWorkspaceEntity } from '../src/domain/entityRemoval';
import { addGraphNodes, projectGraphMembership } from '../src/domain/graphMembership';
import {
  buildGraph,
  newWorkspace,
  parseWorkspace,
  promoteInputContext,
  markContextTransactions,
  clearContextProvenance,
} from '../src/domain/workspace';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';

const parent = 'a'.repeat(64),
  child = 'b'.repeat(64);
const address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const note = { label: '', note: 'Investigation note', icon: '', bookmarked: false };
function fixture() {
  const w = newWorkspace('Removal fixture', 'mainnet');
  w.transactions = {
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
    w.transactions[parent].vout[0].scriptPubKey = { address };
    w.watchedAddresses = [address];
    w.view.graphNodeIds = [`tx:${parent}`, output, destination];
    const next = removeWorkspaceEntity(w, `tx:${parent}`);
    expect(next.transactions[child]).toBe(w.transactions[child]);
    expect(buildGraph(next).nodes.some((node) => node.id === output)).toBe(true);
    expect(next.watchedAddresses).toEqual([address]);
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
      w.annotations[inputId] = note;
      w.tags = [
        { id: crypto.randomUUID(), name: 'Keep evidence', color: '#339988', nodeIds: [inputId] },
      ];
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.view.graphNodeIds).toEqual(parentAdmitted ? [`tx:${parent}`, inputId] : []);
      expect(next.transactions[parent]).toBe(w.transactions[parent]);
      expect(next.transactions[child]).toBeUndefined();
      expect(next.annotations[inputId]).toBe(note);
      expect(next.tags).toEqual(w.tags);
      expect(next.transactions[parent].vout).toHaveLength(1);
      expect(parseWorkspace(next)).toEqual(next);
      expect(w.view.graphNodeIds).toContain(inputId);
    },
  );

  it('does not resurrect removed siblings when a transaction is reloaded, while retaining shared outpoints', () => {
    const w = fixture();
    w.transactions[parent].vout.push({ n: 1, value: 0.5, scriptPubKey: { hex: '51' } });
    w.view.graphNodeIds = buildGraph(w).nodes.map((node) => node.id);
    const removed = removeWorkspaceEntity(w, `tx:${parent}`);
    expect(removed.view.graphNodeIds).toContain(`out:${parent}:0`);
    expect(removed.view.graphNodeIds).not.toContain(`tx:${parent}`);
    expect(removed.view.graphNodeIds).not.toContain(`out:${parent}:1`);
    const reloaded = addGraphNodes(
      { ...removed, transactions: { ...removed.transactions, [parent]: w.transactions[parent] } },
      [`tx:${parent}`],
    );
    const ids = projectGraphMembership(buildGraph(reloaded), reloaded.view.graphNodeIds).nodes.map(
      (node) => node.id,
    );
    expect(ids).toContain(`tx:${parent}`);
    expect(ids).toContain(`out:${parent}:0`);
    expect(ids).not.toContain(`out:${parent}:1`);
    expect(reloaded.transactions[parent].vout).toHaveLength(2);
  });

  it('prunes only vanished address membership, preserving loaded associations even with addresses switched off', () => {
    for (const hasLoadedAssociation of [false, true]) {
      const w = fixture();
      w.watchedAddresses = [address];
      if (hasLoadedAssociation) w.transactions[parent].vout[0].scriptPubKey = { address };
      w.view.graphNodeIds = [`addr:${address}`, `tx:${'f'.repeat(64)}`];
      expect(w.view.showAddresses).toBe(false);
      const removed = removeWorkspaceEntity(w, `addr:${address}`);
      expect(removed.view.graphNodeIds?.includes(`addr:${address}`)).toBe(hasLoadedAssociation);
      expect(removed.view.graphNodeIds).toContain(`tx:${'f'.repeat(64)}`);
      expect(removed.transactions).toBe(w.transactions);
    }
  });

  it('removes unannotated transactions immediately but never edits individual outputs or inputs', () => {
    const w = fixture();
    expect(planEntityRemoval(w, `tx:${parent}`)?.requiresConfirmation).toBe(false);
    expect(planEntityRemoval(w, `out:${parent}:0`)).toBeUndefined();
    expect(removeWorkspaceEntity(w, `out:${parent}:0`)).toBe(w);
    const next = removeWorkspaceEntity(w, `tx:${parent}`);
    expect(next.transactions[parent]).toBeUndefined();
    expect(next.transactions[child]).toBe(w.transactions[child]);
    expect(buildGraph(next).nodes.some((node) => node.id === `out:${parent}:0`)).toBe(true);
    expect(w.transactions[parent]).toBeDefined();
    expect(() => parseWorkspace(next)).not.toThrow();
  });
  it('includes output notes, imported output tags and bookmarks in confirmation and preserves unrelated metadata', () => {
    const w = fixture();
    w.annotations[`out:${parent}:0`] = note;
    w.annotations[`tx:${child}`] = { ...note, label: 'Keep child' };
    w.inputContext = { [parent]: [0] };
    w.tags = [
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
    expect(next.inputContext).toBeUndefined();
    expect(next.annotations).toEqual({ [`tx:${child}`]: w.annotations[`tx:${child}`] });
    expect(next.tags?.[0].nodeIds).toEqual([`tx:${child}`]);
    expect(next.tags?.[0].name).toBe('Shop');
    expect(w.tags[0].nodeIds).toHaveLength(3);
    expect(() => parseWorkspace(next)).not.toThrow();
    const bookmarked = fixture();
    bookmarked.annotations[`tx:${parent}`] = { label: '', note: '', icon: '', bookmarked: true };
    expect(planEntityRemoval(bookmarked, `tx:${parent}`)?.requiresConfirmation).toBe(true);
  });
  it('stops address monitoring and removes its annotations without changing shared transaction facts', () => {
    const w = fixture();
    w.watchedAddresses = [address];
    w.annotations[`addr:${address}`] = { ...note, icon: '★' };
    w.tags = [
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
    expect(next.watchedAddresses).toEqual([]);
    expect(next.transactions).toBe(w.transactions);
    expect(next.annotations[`addr:${address}`]).toBeUndefined();
    expect(next.tags?.[0].nodeIds).toEqual([`tx:${child}`]);
    expect(planEntityRemoval(next, `addr:${address}`)).toBeUndefined();
    expect(() => parseWorkspace(next)).not.toThrow();
  });
});

const grandparent = 'c'.repeat(64),
  other = 'd'.repeat(64);
function automaticBranch() {
  const w = fixture();
  w.transactions[grandparent] = {
    txid: grandparent,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 2, scriptPubKey: { hex: '51' } }],
  };
  w.transactions[parent] = {
    ...w.transactions[parent],
    vin: [{ txid: grandparent, vout: 0 }],
    vout: [...w.transactions[parent].vout, { n: 1, value: 0.5, scriptPubKey: { hex: '51' } }],
  };
  w.inputContext = { [parent]: [0], [grandparent]: [0] };
  return w;
}

describe('automatic ancestor cleanup after transaction removal', () => {
  it('removes an isolated explicit transaction and its multilevel automatic input branch', () => {
    const w = automaticBranch();
    w.view.hiddenNodeIds = [`out:${parent}:0`, `tx:${child}`];
    w.view.selectionId = `tx:${parent}`;
    w.view.transactionFlow = { open: true, transactionId: parent };
    w.view.filters = {
      includeIds: [`tx:${child}`, `tx:${parent}`],
      focus: { id: `tx:${parent}`, hops: 1 },
    };
    const plan = planEntityRemoval(w, `tx:${child}`)!;
    expect(new Set(plan.removedTransactionIds)).toEqual(new Set([child, parent, grandparent]));
    expect(plan.automaticContextCount).toBe(2);
    expect(plan.requiresConfirmation).toBe(false);
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(next.transactions).toEqual({});
    expect(next.inputContext).toBeUndefined();
    expect(buildGraph(next)).toEqual({ nodes: [], links: [] });
    expect(next.view.hiddenNodeIds).toEqual([]);
    expect(next.view.selectionId).toBeUndefined();
    expect(next.view.transactionFlow?.transactionId).toBeUndefined();
    expect(next.view.filters).toMatchObject({ includeIds: [], focus: undefined });
    expect(Object.keys(w.transactions)).toHaveLength(3);
    expect(() => parseWorkspace(next)).not.toThrow();
  });

  it('retains a shared parent and its ancestry but removes the abandoned output scope', () => {
    const w = automaticBranch();
    w.transactions[other] = {
      ...w.transactions[child],
      txid: other,
      vin: [{ txid: parent, vout: 1 }],
    };
    w.inputContext![parent] = [0, 1];
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(planEntityRemoval(w, `tx:${child}`)?.automaticContextCount).toBe(0);
    expect(Object.keys(next.transactions).sort()).toEqual([parent, grandparent, other].sort());
    expect(next.inputContext).toEqual({ [parent]: [1], [grandparent]: [0] });
    const ids = buildGraph(next).nodes.map((node) => node.id);
    expect(ids).toContain(`out:${parent}:1`);
    expect(ids).not.toContain(`out:${parent}:0`);
    expect(() => parseWorkspace(next)).not.toThrow();
  });

  it('preserves an independently loaded parent and its automatic dependencies', () => {
    const w = automaticBranch();
    delete w.inputContext![parent];
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(next.transactions[parent]).toBe(w.transactions[parent]);
    expect(next.transactions[grandparent]).toBe(w.transactions[grandparent]);
    expect(next.inputContext).toEqual({ [grandparent]: [0] });
  });

  for (const protection of ['note', 'bookmark', 'tag'] as const)
    it(`retains annotated orphan context protected by ${protection}`, () => {
      const w = automaticBranch();
      if (protection === 'tag')
        w.tags = [
          {
            id: crypto.randomUUID(),
            name: 'Retain evidence',
            color: '#339988',
            nodeIds: [`out:${parent}:0`],
          },
        ];
      else
        w.annotations[`out:${parent}:0`] =
          protection === 'bookmark' ? { ...note, note: '', bookmarked: true } : note;
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.transactions[parent]).toBe(w.transactions[parent]);
      expect(next.transactions[grandparent]).toBe(w.transactions[grandparent]);
      expect(next.annotations).toEqual(w.annotations);
      expect(next.tags).toEqual(w.tags);
      expect(planEntityRemoval(w, `tx:${child}`)?.annotationCount).toBe(0);
      expect(() => parseWorkspace(next)).not.toThrow();
    });

  it('retains annotated address provenance and watched-address observations in automatic context', () => {
    for (const watched of [true, false]) {
      const w = automaticBranch();
      w.transactions[parent].vout[0].scriptPubKey = { address };
      if (watched) w.watchedAddresses = [address];
      else w.annotations[`addr:${address}`] = note;
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.transactions[parent]).toBeDefined();
      expect(next.transactions[grandparent]).toBeDefined();
      expect(next.annotations).toEqual(w.annotations);
      expect(next.watchedAddresses).toEqual(w.watchedAddresses);
      expect(() => parseWorkspace(next)).not.toThrow();
    }
  });

  it('retains wallet history and activity references without modifying wallet metadata', () => {
    const key =
      'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    const derived = deriveAddresses(key, 'mainnet', 'p2wpkh', 0, 0, 1);
    for (const source of ['history', 'activity', 'owned-output', 'owned-script'] as const) {
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
      if (source === 'activity') wallet.unreviewedTransactionIds = [parent];
      if (source === 'owned-output')
        w.transactions[parent].vout[0].scriptPubKey = { address: derived[0].address };
      if (source === 'owned-script')
        w.transactions[parent].vout[0].scriptPubKey = {
          hex: Buffer.from(
            bitcoinAddress.toOutputScript(derived[0].address, networks.bitcoin),
          ).toString('hex'),
        };
      w.wallets = [wallet];
      const next = removeWorkspaceEntity(w, `tx:${child}`);
      expect(next.transactions[parent]).toBe(w.transactions[parent]);
      expect(next.transactions[grandparent]).toBe(w.transactions[grandparent]);
      expect(next.wallets).toBe(w.wallets);
      expect(() => parseWorkspace(next)).not.toThrow();
    }
  });

  it('does not clean up or shrink unrelated automatic context', () => {
    const w = automaticBranch();
    const unrelated = 'e'.repeat(64),
      consumer = 'f'.repeat(64);
    w.transactions[unrelated] = {
      ...w.transactions[parent],
      txid: unrelated,
      vin: [{ coinbase: '00' }],
    };
    w.transactions[consumer] = {
      ...w.transactions[child],
      txid: consumer,
      vin: [{ txid: unrelated, vout: 0 }],
    };
    w.inputContext![unrelated] = [0, 1];
    const next = removeWorkspaceEntity(w, `tx:${child}`);
    expect(Object.keys(next.transactions).sort()).toEqual([unrelated, consumer].sort());
    expect(next.inputContext).toEqual({ [unrelated]: [0, 1] });
  });
});

describe('automatic ancestry provenance independent of render scope', () => {
  it('keeps promoted automatic ancestry removable with the original branch', () => {
    const original = automaticBranch();
    const expanded = promoteInputContext(original, [parent, grandparent]);
    expect(expanded.inputContext).toBeUndefined();
    expect(new Set(expanded.contextTransactionIds)).toEqual(new Set([parent, grandparent]));
    expect(planEntityRemoval(expanded, `tx:${child}`)?.automaticContextCount).toBe(2);
    const next = removeWorkspaceEntity(expanded, `tx:${child}`);
    expect(buildGraph(next).nodes).toHaveLength(0);
    expect(next.contextTransactionIds ?? []).toEqual([]);
    expect(() => parseWorkspace(next)).not.toThrow();
  });

  it('marks newly fetched ancestry and gives explicit observations independent lifetime', () => {
    const original = automaticBranch();
    delete original.inputContext;
    const marked = markContextTransactions(original, [parent, grandparent, parent, 'f'.repeat(64)]);
    expect(marked.contextTransactionIds).toEqual([parent, grandparent]);
    expect(markContextTransactions(marked, [parent])).toBe(marked);
    const independent = clearContextProvenance(marked, [parent]);
    expect(independent.contextTransactionIds).toEqual([grandparent]);
    expect(clearContextProvenance(independent, [parent])).toBe(independent);
    const next = removeWorkspaceEntity(independent, `tx:${child}`);
    expect(next.transactions[parent]).toBe(original.transactions[parent]);
    expect(next.transactions[grandparent]).toBe(original.transactions[grandparent]);
    expect(() => parseWorkspace(next)).not.toThrow();
    const legacy = clearContextProvenance(automaticBranch(), [parent]);
    expect(legacy.inputContext).toEqual({ [grandparent]: [0] });
    expect(legacy.contextTransactionIds).toBeUndefined();
  });

  it('rejects duplicate, missing and excessive provenance records at import/save validation', () => {
    const w = automaticBranch();
    expect(() => parseWorkspace({ ...w, contextTransactionIds: [parent, parent] })).toThrow(
      'duplicate',
    );
    expect(() => parseWorkspace({ ...w, contextTransactionIds: ['f'.repeat(64)] })).toThrow(
      'loaded transaction',
    );
    expect(() =>
      parseWorkspace({ ...w, contextTransactionIds: Array(10001).fill(parent) }),
    ).toThrow('10,000 context transaction limit');
    expect(parseWorkspace({ ...w, contextTransactionIds: [parent] }).contextTransactionIds).toEqual(
      [parent],
    );
  });
});
