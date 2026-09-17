import { describe, expect, it } from 'vitest';
import { describeWorkspaceChange } from './undoDescription';
import { createWorkspace } from '../createWorkspace';
import type { AnalysisFinding } from '../Analysis/finding';
import type { Annotation } from '../Annotations/annotations';
import type { Wallet } from '../Wallets/wallets';
import type { Workspace } from '../workspace';

const annotation: Annotation = { label: '', note: '', icon: '', bookmarked: false };
const finding: AnalysisFinding = {
  id: 'finding',
  algorithm: 'test',
  title: 'Finding',
  description: '',
  nodeIds: [],
  txids: [],
  createdAt: '2026-01-01',
};
const wallet: Wallet = {
  id: 'wallet',
  name: 'Wallet',
  key: 'public fixture',
  scriptType: 'p2wpkh',
  color: '#abcdef',
  addresses: [],
};
function workspace(): Workspace {
  return createWorkspace('Undo fixture', 'mainnet');
}

describe('undo action descriptions', () => {
  it.each([
    [{ label: 'Savings' }, 'Change label'],
    [{ note: 'Known invoice' }, 'Edit note'],
    [{ icon: 'star' }, 'Change icon'],
    [{ bookmarked: true }, 'Add bookmark'],
    [{ label: 'Savings', icon: 'star' }, 'Edit annotations'],
  ] as const)(
    'describes changed annotation fields without including their values',
    (patch, expected) => {
      const before = workspace();
      expect(
        describeWorkspaceChange(before, {
          ...before,
          annotations: { ...before.annotations, entities: { 'tx:a': { ...annotation, ...patch } } },
        }),
      ).toBe(expected);
    },
  );

  it('describes removal of the only populated annotation field', () => {
    const before = {
      ...workspace(),
      annotations: {
        ...workspace().annotations,
        entities: { 'tx:a': { ...annotation, bookmarked: true } },
      },
    };
    expect(
      describeWorkspaceChange(before, {
        ...before,
        annotations: { ...before.annotations, entities: {} },
      }),
    ).toBe('Remove bookmark');
  });

  it('does not choose one label for mixed annotation or bookmark edits', () => {
    const before = {
      ...workspace(),
      annotations: {
        ...workspace().annotations,
        entities: { 'tx:a': { ...annotation, bookmarked: true } },
      },
    };
    const after = {
      ...before,
      annotations: {
        ...before.annotations,
        entities: { 'tx:a': annotation, 'tx:b': { ...annotation, bookmarked: true } },
      },
    };
    expect(describeWorkspaceChange(before, after)).toBe('Edit annotations');
  });

  it('counts actual graph membership changes, ignoring list ordering and duplicates', () => {
    const before = workspace();
    before.view.graphNodeIds = ['tx:a', 'out:a:0'];
    expect(
      describeWorkspaceChange(before, {
        ...before,
        view: {
          ...before.view,
          graphNodeIds: ['out:a:0', 'tx:a', 'out:a:1', 'out:a:2', 'out:a:2'],
        },
      }),
    ).toBe('Add 2 outputs');
    expect(
      describeWorkspaceChange(before, { ...before, view: { ...before.view, graphNodeIds: [] } }),
    ).toBe('Remove 2 nodes');
  });

  it('distinguishes hiding from removing and showing from adding', () => {
    const before = workspace();
    const hidden = {
      ...before,
      view: { ...before.view, hiddenNodeIds: ['out:a:0', 'out:a:1', 'tx:a'] },
    };
    expect(describeWorkspaceChange(before, hidden)).toBe('Hide 3 nodes');
    expect(describeWorkspaceChange(hidden, before)).toBe('Show 3 nodes');
  });

  it('describes renderer changes as a view edit', () => {
    const before = workspace();
    expect(
      describeWorkspaceChange(before, {
        ...before,
        view: { ...before.view, glow: !before.view.glow, sizeBy: 'degree' },
      }),
    ).toBe('Change view');
  });

  it('does not interpret implicit graph membership as an empty explicit graph', () => {
    const before = workspace();
    before.view.graphNodeIds = undefined;
    expect(
      describeWorkspaceChange(before, {
        ...before,
        view: { ...before.view, graphNodeIds: ['tx:a'] },
      }),
    ).toBe('Change view');
  });

  it('keeps transaction addition concise when its graph/context and stale findings follow', () => {
    const before = { ...workspace(), analysis: { ...workspace().analysis, findings: [finding] } };
    const after: Workspace = {
      ...before,
      chainData: { ...before.chainData, transactions: { a: { txid: 'a', vin: [], vout: [] } } },
      analysis: { ...before.analysis, findings: [{ ...finding, stale: true }] },
      view: {
        ...before.view,
        graphNodeIds: ['tx:a'],
        selectionId: 'tx:a',
        inputContext: { a: [0] },
      },
    };
    expect(describeWorkspaceChange(before, after)).toBe('Add transaction');
    expect(describeWorkspaceChange(after, before)).toBe('Remove transaction');
  });

  it('describes wallet identity and naming changes without guessing at other wallet edits', () => {
    const before = workspace();
    const added = { ...before, wallets: { ...before.wallets, definitions: [wallet] } };
    expect(describeWorkspaceChange(before, added)).toBe('Add wallet');
    expect(describeWorkspaceChange(added, before)).toBe('Remove wallet');
    expect(
      describeWorkspaceChange(added, {
        ...added,
        wallets: { ...added.wallets, definitions: [{ ...wallet, name: 'Renamed' }] },
      }),
    ).toBe('Rename wallet');
    expect(
      describeWorkspaceChange(added, {
        ...added,
        wallets: { ...added.wallets, definitions: [{ ...wallet, color: '#000000' }] },
      }),
    ).toBe('Edit workspace');
  });

  it('distinguishes tag creation, membership edits and removal', () => {
    const before = workspace();
    const tag = { id: 'tag', name: 'Tag', color: '#abcdef', nodeIds: [] as string[] };
    const added = { ...before, annotations: { ...before.annotations, tags: [tag] } };
    expect(describeWorkspaceChange(before, added)).toBe('Add tag');
    expect(
      describeWorkspaceChange(added, {
        ...added,
        annotations: { ...added.annotations, tags: [{ ...tag, nodeIds: ['tx:a'] }] },
      }),
    ).toBe('Assign tag');
    expect(describeWorkspaceChange(added, before)).toBe('Remove tag');
  });

  it('counts batch annotation changes and distinguishes tag assignment from metadata editing', () => {
    const before = workspace();
    expect(
      describeWorkspaceChange(before, {
        ...before,
        annotations: {
          ...before.annotations,
          entities: {
            'tx:a': { ...annotation, label: 'First' },
            'tx:b': { ...annotation, label: 'Second' },
          },
        },
      }),
    ).toBe('Change 2 labels');
    const tag = { id: 'tag', name: 'Tag', color: '#abcdef', nodeIds: ['tx:a'] };
    const tagged = { ...before, annotations: { ...before.annotations, tags: [tag] } };
    expect(
      describeWorkspaceChange(tagged, {
        ...tagged,
        annotations: { ...tagged.annotations, tags: [{ ...tag, nodeIds: [] }] },
      }),
    ).toBe('Remove tag');
    expect(
      describeWorkspaceChange(tagged, {
        ...tagged,
        annotations: { ...tagged.annotations, tags: [{ ...tag, nodeIds: ['tx:b'] }] },
      }),
    ).toBe('Change tags');
    expect(
      describeWorkspaceChange(tagged, {
        ...tagged,
        annotations: { ...tagged.annotations, tags: [{ ...tag, name: 'Renamed' }] },
      }),
    ).toBe('Edit tag');
  });

  it('distinguishes running analysis from excluding and restoring findings', () => {
    const before = workspace();
    const analysed = { ...before, analysis: { ...before.analysis, findings: [finding] } };
    const excluded = {
      ...analysed,
      analysis: { ...analysed.analysis, findings: [{ ...finding, excluded: true }] },
    };
    expect(describeWorkspaceChange(before, analysed)).toBe('Run analysis');
    expect(describeWorkspaceChange(analysed, excluded)).toBe('Exclude finding');
    expect(describeWorkspaceChange(excluded, analysed)).toBe('Restore finding');
  });

  it('uses a broad description for unknown or unrelated mixed changes', () => {
    const before = workspace();
    expect(
      describeWorkspaceChange(before, {
        ...before,
        name: 'Renamed',
        annotations: {
          ...before.annotations,
          entities: { 'tx:a': { ...annotation, label: 'Label' } },
        },
      }),
    ).toBe('Edit workspace');
    expect(
      describeWorkspaceChange(before, {
        ...before,
        chainData: { ...before.chainData, watchedAddresses: ['public fixture'] },
      }),
    ).toBe('Edit workspace');
    expect(describeWorkspaceChange(before, before)).toBe('Edit workspace');
    expect(describeWorkspaceChange(before, { ...before, name: 'Renamed' })).toBe(
      'Rename workspace',
    );
    expect(describeWorkspaceChange(before, { ...before, description: 'Notes' })).toBe(
      'Edit workspace description',
    );
  });

  it('does not inspect unchanged transaction observations for a metadata edit', () => {
    const before = workspace();
    const transactions = new Proxy(before.chainData.transactions, {
      ownKeys() {
        throw new Error('Unchanged transactions must not be inspected');
      },
    });
    const source = { ...before, chainData: { ...before.chainData, transactions: transactions } };
    expect(describeWorkspaceChange(source, { ...source, name: 'Renamed' })).toBe(
      'Rename workspace',
    );
  });
});
