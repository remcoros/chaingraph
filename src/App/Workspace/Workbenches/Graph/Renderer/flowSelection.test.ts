import { describe, expect, it } from 'vitest';
import type { RenderLink } from './adapter';
import type { Position } from './flowLayout';
import { chooseFlowLinks, indexFlowLinks } from './flowSelection';

const edge = (
  id: string,
  source: string,
  target: string,
  flowSide: 'incoming' | 'outgoing',
): RenderLink => ({
  id,
  source,
  target,
  flowSide,
  directed: true,
  color: '#88aacc',
  width: 1,
  arrowLength: 4,
});
const bridge = (id: string, source: string, target: string) => [
  edge(`${id}:create`, source, id, 'outgoing'),
  edge(`${id}:spend`, id, target, 'incoming'),
];
const association = (id: string, address: string, output: string): RenderLink => ({
  id,
  source: address,
  target: output,
  traceAssociation: true,
  directed: false,
  color: '#88aacc',
  width: 0,
  arrowLength: 0,
});
const ids = (links: RenderLink[]) => new Set(links.map((link) => link.id));

describe('visible transaction flow structure', () => {
  it.each(['select', 'hover'] as const)(
    'keeps more than 50 expanded branches per direction with %s',
    (mode) => {
      const links: RenderLink[] = [];
      const required: RenderLink[] = [];
      for (let i = 0; i < 65; i++) {
        required.push(
          ...bridge(`in-${i}`, `parent-${i}`, 'root'),
          ...bridge(`out-${i}`, 'root', `child-${i}`),
        );
        links.push(
          edge(`leaf-in-${i}`, `input-${i}`, 'root', 'incoming'),
          edge(`leaf-out-${i}`, 'root', `output-${i}`, 'outgoing'),
        );
      }
      links.push(...required);
      const chosen = chooseFlowLinks(
        indexFlowLinks(links),
        mode === 'select' ? ['root'] : [],
        mode === 'hover' ? 'root' : undefined,
      );
      expect(ids(chosen)).toEqual(ids(required));
      expect(chosen).toHaveLength(260);
    },
  );

  it('uses a branch target, reserving six complete routes and filling 44 terminal slots', () => {
    const links: RenderLink[] = [];
    for (let i = 0; i < 6; i++) links.push(...bridge(`expanded-${i}`, 'root', `child-${i}`));
    for (let i = 0; i < 200; i++) links.push(edge(`leaf-${i}`, 'root', `output-${i}`, 'outgoing'));
    const chosen = chooseFlowLinks(indexFlowLinks(links), ['root']);
    expect(chosen.filter((link) => link.id.startsWith('expanded-'))).toHaveLength(12);
    expect(chosen.filter((link) => link.id.startsWith('leaf-'))).toHaveLength(44);
  });

  it('includes terminal outputs at every visible downstream transaction reached from an outpoint', () => {
    const links = [
      edge('creates-selected', 'creator', 'selected', 'outgoing'),
      edge('spends-selected', 'selected', 'spender', 'incoming'),
      edge('creates-a', 'spender', 'output-a', 'outgoing'),
      edge('creates-b', 'spender', 'output-b', 'outgoing'),
      edge('spends-a', 'output-a', 'next', 'incoming'),
      edge('creates-c', 'next', 'output-c', 'outgoing'),
    ];

    expect(ids(chooseFlowLinks(indexFlowLinks(links), ['selected']))).toEqual(
      new Set([
        'creates-selected',
        'spends-selected',
        'creates-a',
        'creates-b',
        'spends-a',
        'creates-c',
      ]),
    );
  });

  it('traces visible address outputs into their spending transactions and terminal outputs', () => {
    const links = [
      association('address-spent', 'address', 'spent-output'),
      association('address-utxo', 'address', 'utxo'),
      edge('spends-output', 'spent-output', 'spender', 'incoming'),
      edge('creates-next', 'spender', 'next-output', 'outgoing'),
    ];

    expect(ids(chooseFlowLinks(indexFlowLinks(links), ['address']))).toEqual(
      new Set(['address-spent', 'address-utxo', 'spends-output', 'creates-next']),
    );
  });

  it('traverses upstream and downstream without turning into unrelated sibling branches', () => {
    const required = [
      ...bridge('pa', 'parent', 'a'),
      ...bridge('ab', 'a', 'b'),
      ...bridge('bc', 'b', 'child'),
    ];
    const reachableTerminal = edge('leaf-at-child', 'child', 'terminal', 'outgoing');
    const unrelated = [
      ...bridge('sibling', 'parent', 'other-child'),
      ...bridge('coinput', 'other-parent', 'child'),
      reachableTerminal,
    ];
    expect(ids(chooseFlowLinks(indexFlowLinks([...required, ...unrelated]), ['a']))).toEqual(
      ids([...required, reachableTerminal]),
    );
  });

  it('deduplicates reconvergent paths, multiple active roots and cycles', () => {
    const links = [
      ...bridge('ab', 'a', 'b'),
      ...bridge('ac', 'a', 'c'),
      ...bridge('bd', 'b', 'd'),
      ...bridge('cd', 'c', 'd'),
      ...bridge('da', 'd', 'a'),
    ];
    const chosen = chooseFlowLinks(indexFlowLinks(links), ['a', 'd'], 'b');
    expect(ids(chosen)).toEqual(ids(links));
    expect(chosen.length).toBe(links.length);
  });

  it('uses the same focused trace for an outpoint or either hovered segment', () => {
    const links = [
      ...bridge('pa', 'parent', 'a'),
      ...bridge('ab', 'a', 'b'),
      ...bridge('bc', 'b', 'child'),
      ...bridge('sibling', 'a', 'other-child'),
    ];
    const expected = ids(links.filter((link) => !link.id.startsWith('sibling')));
    const index = indexFlowLinks(links);
    expect(ids(chooseFlowLinks(index, ['ab']))).toEqual(expected);
    expect(ids(chooseFlowLinks(index, [], 'ab'))).toEqual(expected);
    for (const segment of ['ab:create', 'ab:spend'])
      expect(ids(chooseFlowLinks(index, [], undefined, segment))).toEqual(expected);
  });

  it('does not cross hidden or missing positions or address associations', () => {
    const links = [...bridge('ab', 'a', 'b'), ...bridge('bc', 'b', 'c')];
    links.push({
      ...edge('address', 'ab', 'address-node', 'outgoing'),
      directed: false,
      flowSide: undefined,
    });
    const positions = new Map<string, Position>([
      ['a', { x: 0, y: 0, z: 0 }],
      ['ab', { x: 10, y: 0, z: 0 }],
      ['bc', { x: 20, y: 0, z: 0 }],
      ['c', { x: 30, y: 0, z: 0 }],
    ]);
    expect(
      ids(chooseFlowLinks(indexFlowLinks(links), ['a'], undefined, undefined, positions)),
    ).toEqual(new Set(['ab:create']));
  });

  it('spreads terminal choices across spatial sectors independently of list order', () => {
    const links: RenderLink[] = [];
    const positions = new Map<string, Position>([['root', { x: -30, y: 0, z: 0 }]]);
    for (let sector = 0; sector < 8; sector++)
      for (let i = 0; i < 60; i++) {
        const id = `leaf-${sector}-${i}`;
        const angle = ((sector + 0.5) / 8) * Math.PI * 2 - Math.PI;
        links.push(edge(id, 'root', id, 'outgoing'));
        positions.set(id, { x: Math.cos(angle) * 20, y: Math.sin(angle) * 20, z: 0 });
      }
    const chosen = chooseFlowLinks(
      indexFlowLinks(links),
      ['root'],
      undefined,
      undefined,
      positions,
      2,
    );
    expect(chosen).toHaveLength(50);
    for (let sector = 0; sector < 8; sector++)
      expect(
        chosen.filter((link) => link.id.startsWith(`leaf-${sector}-`)).length,
      ).toBeGreaterThanOrEqual(6);
    expect(
      chooseFlowLinks(
        indexFlowLinks([...links].reverse()),
        ['root'],
        undefined,
        undefined,
        positions,
        2,
      ),
    ).toEqual(chosen);
    const hover = 'leaf-7-59';
    const hovered = chooseFlowLinks(
      indexFlowLinks(links),
      ['root'],
      undefined,
      hover,
      positions,
      2,
    );
    expect(hovered).toHaveLength(50);
    expect(hovered[0].id).toBe(hover);
  });
});
