import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
  type ScanDirection,
  type ScanSettings,
} from '../src/Domain/ConnectionScan/connectionScan';

type Edge = readonly [string, string];
const tx = (n: number) => `tx:${n.toString(16).padStart(64, '0')}`;
const out = (n: number, index: number) => `out:${n.toString(16).padStart(64, '0')}:${index}`;

/** Each DAG edge gets a distinct outpoint, so no fixture double-spends an output. */
function transactionDag(
  mask: number,
  count = 4,
  relabel: (n: number) => number = (n) => n,
): Edge[] {
  const edges: Edge[] = [];
  let bit = 0;
  for (let parent = 1; parent <= count; parent++) {
    let output = 0;
    for (let child = parent + 1; child <= count; child++, bit++) {
      if (!(mask & (1 << bit))) continue;
      const id = out(relabel(parent), output++);
      edges.push([tx(relabel(parent)), id], [id, tx(relabel(child))]);
    }
  }
  return edges;
}

/**
 * Deliberately independent of traversal fronts and meeting reconstruction: enumerate
 * simple paths directly, with at most one direction change and a whole-path hop cap.
 * Only endpoint/relationship existence is compared; alternative-path count is not a contract.
 */
function referenceConnections(
  edges: readonly Edge[],
  source: string,
  targets: readonly string[],
  displayed: readonly string[],
  direction: ScanSettings['direction'],
  maxHops: number,
): string[] {
  const targetSet = new Set(targets);
  const shown = new Set(displayed);
  const found = new Set<string>();
  for (const initial of direction === 'both'
    ? (['upstream', 'downstream'] as const)
    : [direction]) {
    function walk(path: string[], directions: ScanDirection[], turned: boolean, hops: number) {
      const node = path.at(-1)!;
      const reachesTarget = path.length > 1 && targetSet.has(node);
      const hasNewNode = path.some((id) => !shown.has(id));
      let accepted = false;
      if (reachesTarget) {
        if (hasNewNode) {
          const relationship = turned
            ? initial === 'upstream'
              ? 'shared-ancestor'
              : 'shared-descendant'
            : 'direct';
          const turn = directions.findIndex((value, i) => i > 0 && value !== directions[i - 1]);
          const meeting = path[turn];
          const creatorOnly =
            relationship === 'shared-ancestor' &&
            meeting?.startsWith('tx:') &&
            [path[turn - 1], path[turn + 1]].every((id) =>
              id?.startsWith(`out:${meeting.slice(3)}:`),
            ) &&
            path.every((id) => id === meeting || shown.has(id));
          // Outpoint IDs already disclose this shared creator. A hidden spender
          // or an undisplayed branch node still establishes a new connection.
          if (!creatorOnly) {
            found.add(`${node}|${relationship}`);
            accepted = true;
          }
        }
        // Displayed paths are context, not discoveries: continue through them
        // to find a new route beyond the selected transaction's immediate I/O.
        // A newly discovered target can still be a direction-change point.
        if (turned && accepted) return;
      }
      const current = directions.at(-1) ?? initial;
      const nextDirections: ScanDirection[] = reachesTarget && accepted ? [] : [current];
      if (!turned && path.length > 1) {
        nextDirections.push(current === 'upstream' ? 'downstream' : 'upstream');
      }
      for (const nextDirection of nextDirections) {
        for (const [from, to] of edges) {
          if ((nextDirection === 'downstream' ? from : to) !== node) continue;
          const next = nextDirection === 'downstream' ? to : from;
          const nextHops = hops + (next.startsWith('tx:') ? 1 : 0);
          if (nextHops > maxHops || path.includes(next)) continue;
          walk(
            [...path, next],
            [...directions, nextDirection],
            turned || nextDirection !== initial,
            nextHops,
          );
        }
      }
    }
    walk([source], [], false, 0);
  }
  return [...found].sort();
}

async function scanConnections(
  edges: readonly Edge[],
  source: string,
  targets: string[],
  direction: ScanSettings['direction'],
  maxHops: number,
  displayed = [source, ...targets],
  targetScope: ScanSettings['targetScope'] = 'visible',
) {
  const run = await runConnectionScan({
    id: 'oracle',
    source,
    targetIds: targets,
    displayedNodeIds: displayed,
    settings: {
      ...DEFAULT_SCAN_SETTINGS,
      targetScope,
      direction,
      maxHops,
      maxTransactions: 1000,
      maxMilliseconds: 60_000,
      fanOut: 200,
    },
    resolveNeighbors: async (node, nextDirection) => ({
      nodeIds: edges
        .filter((edge) => edge[nextDirection === 'downstream' ? 0 : 1] === node)
        .map((edge) => edge[nextDirection === 'downstream' ? 1 : 0]),
    }),
  });
  expect(run.stopReasons.filter((reason) => reason !== 'depth')).toEqual([]);
  const observedEdges = new Set(edges.map(([from, to]) => `${from}|${to}`));
  for (const result of run.results.filter((item) => item.kind === 'connection')) {
    const transactionHops = result.path.slice(1).filter((node) => node.startsWith('tx:')).length;
    const validEdges =
      result.directions.length === result.path.length - 1 &&
      result.directions.every((edgeDirection, index) => {
        const pair =
          edgeDirection === 'downstream'
            ? [result.path[index], result.path[index + 1]]
            : [result.path[index + 1], result.path[index]];
        return observedEdges.has(pair.join('|'));
      });
    expect(
      {
        source: result.path[0],
        endpoint: result.path.at(-1),
        target: targets.includes(result.endpoint),
        simple: new Set(result.path).size === result.path.length,
        observedEdges: validEdges,
        hops: result.hops,
        withinHopLimit: transactionHops <= maxHops,
      },
      `invalid path ${JSON.stringify(result)}`,
    ).toEqual({
      source,
      endpoint: result.endpoint,
      target: true,
      simple: true,
      observedEdges: true,
      hops: transactionHops,
      withinHopLimit: true,
    });
  }
  return [
    ...new Set(
      run.results
        .filter((result) => result.kind === 'connection')
        .map((result) => `${result.endpoint}|${result.relationship}`),
    ),
  ].sort();
}

describe('connection search independent DAG oracle', () => {
  it.each([
    {
      direction: 'upstream' as const,
      mask: 59,
      source: out(2, 0),
      target: tx(4),
      hidden: tx(1),
      relationship: 'shared-ancestor',
      creatorOnly: true,
    },
    {
      direction: 'upstream' as const,
      mask: 47,
      source: tx(4),
      target: out(3, 0),
      hidden: tx(2),
      relationship: 'shared-ancestor',
      creatorOnly: false,
    },
    {
      direction: 'downstream' as const,
      mask: 61,
      source: tx(1),
      target: out(1, 0),
      hidden: tx(3),
      relationship: 'shared-descendant',
      creatorOnly: false,
    },
  ])(
    'distinguishes new $relationship evidence from creator-only context',
    async ({ direction, mask, source, target, hidden, relationship, creatorOnly }) => {
      const edges = transactionDag(mask);
      const displayed = [...new Set(edges.flat())].filter((node) => node !== hidden);
      const expected = creatorOnly ? [] : [`${target}|${relationship}`];
      expect(referenceConnections(edges, source, [target], displayed, direction, 4)).toEqual(
        expected,
      );
      expect(
        await scanConnections(edges, source, [target], direction, 4, displayed, 'custom'),
      ).toEqual(expected);
    },
  );

  it.each(['upstream', 'downstream', 'both'] as const)(
    'matches custom targets among displayed non-target context for %s searches',
    async (direction) => {
      for (let mask = 0; mask < 64; mask++) {
        const edges = transactionDag(mask);
        const nodes = [...new Set([tx(1), tx(2), tx(3), tx(4), ...edges.flat()])];
        for (const source of nodes) {
          for (const target of nodes) {
            if (source === target) continue;
            const targets = [target];
            for (const hidden of nodes) {
              if (hidden === source || hidden === target) continue;
              // Custom scope decouples target membership from displayed context.
              // A useful path can differ from a visible route by just one node.
              const displayed = nodes.filter((node) => node !== hidden);
              const expected = referenceConnections(
                edges,
                source,
                targets,
                displayed,
                direction,
                4,
              );
              const actual = await scanConnections(
                edges,
                source,
                targets,
                direction,
                4,
                displayed,
                'custom',
              );
              expect(
                actual,
                `custom DAG mask ${mask}, source ${source}, target ${target}, hidden ${hidden}`,
              ).toEqual(expected);
            }
          }
        }
      }
    },
  );

  it.each(['upstream', 'downstream', 'both'] as const)(
    'matches selected transactions with their whole immediate input/output neighborhood for %s searches',
    async (direction) => {
      for (let mask = 0; mask < 64; mask++) {
        const edges = transactionDag(mask);
        for (let sourceIndex = 1; sourceIndex <= 4; sourceIndex++) {
          const source = tx(sourceIndex);
          const targets = [
            ...new Set(
              edges.flatMap(([from, to]) => (from === source ? [to] : to === source ? [from] : [])),
            ),
          ];
          const displayed = [source, ...targets];
          const expected = referenceConnections(edges, source, targets, displayed, direction, 4);
          const actual = await scanConnections(edges, source, targets, direction, 4, displayed);
          expect(actual, `neighborhood DAG mask ${mask}, source ${source}`).toEqual(expected);
        }
      }
    },
  );

  it.each(['upstream', 'downstream', 'both'] as const)(
    'matches seeded seven-transaction DAGs with hidden targets and renamed IDs for %s searches',
    async (direction) => {
      let random = 0x5eed;
      for (let fixture = 0; fixture < 32; fixture++) {
        let mask = 0;
        for (let bit = 0; bit < 21; bit++) {
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          if (random >>> 30 === 0) mask |= 1 << bit;
        }
        for (const reversed of [false, true]) {
          const edges = transactionDag(mask, 7, reversed ? (n) => 8 - n : (n) => n);
          if (reversed) edges.reverse();
          const nodes = [...new Set(edges.flat())];
          for (let index = 0; index < nodes.length; index++) {
            const source = nodes[index]!;
            const targets = [
              nodes[(index + 1) % nodes.length]!,
              nodes[(index + 3) % nodes.length]!,
            ].filter((node) => node !== source);
            // All-added scope can include a hidden target. Every displayed
            // eligible node remains a target, as in the real panel.
            const displayed = reversed ? [source, targets[0]!] : [source, ...targets];
            for (const maxHops of [2, 6]) {
              const expected = referenceConnections(
                edges,
                source,
                targets,
                displayed,
                direction,
                maxHops,
              );
              const actual = await scanConnections(
                edges,
                source,
                reversed ? [...targets].reverse() : targets,
                direction,
                maxHops,
                displayed,
              );
              expect(
                actual,
                `seeded fixture ${fixture}, reversed ${reversed}, source ${source}, targets ${targets.join(',')}, hops ${maxHops}`,
              ).toEqual(expected);
            }
          }
        }
      }
    },
  );

  it.each(['upstream', 'downstream', 'both'] as const)(
    'matches mixed transaction/output targets for %s searches',
    async (direction) => {
      for (let mask = 0; mask < 64; mask++) {
        const edges = transactionDag(mask);
        const nodes = [...new Set(edges.flat())];
        for (const source of nodes) {
          for (let first = 0; first < nodes.length; first++) {
            for (let second = first + 1; second < nodes.length; second++) {
              const targets = [nodes[first]!, nodes[second]!];
              if (targets.includes(source)) continue;
              const expected = referenceConnections(
                edges,
                source,
                targets,
                [source, ...targets],
                direction,
                4,
              );
              const actual = await scanConnections(edges, source, targets, direction, 4);
              expect(
                actual,
                `DAG mask ${mask}, source ${source}, targets ${targets.join(',')}`,
              ).toEqual(expected);
            }
          }
        }
      }
    },
  );
  it.each(['upstream', 'downstream', 'both'] as const)(
    'matches multiple graph targets for %s searches',
    async (direction) => {
      for (let mask = 0; mask < 64; mask++) {
        const edges = transactionDag(mask);
        for (let source = 1; source <= 4; source++) {
          const targets = [1, 2, 3, 4].filter((target) => target !== source).map(tx);
          const expected = referenceConnections(
            edges,
            tx(source),
            targets,
            [tx(source), ...targets],
            direction,
            4,
          );
          const actual = await scanConnections(edges, tx(source), targets, direction, 4);
          expect(actual, `DAG mask ${mask}, source ${source}`).toEqual(expected);
        }
      }
    },
  );

  it.each(['upstream', 'downstream', 'both'] as const)(
    'matches all four-transaction DAGs for %s searches',
    async (direction) => {
      for (let mask = 0; mask < 64; mask++) {
        const edges = transactionDag(mask);
        const nodes = [...new Set([tx(1), tx(2), tx(3), tx(4), ...edges.flat()])];
        for (const source of nodes) {
          for (const target of nodes) {
            if (source === target) continue;
            for (const maxHops of [1, 2, 4]) {
              const expected = referenceConnections(
                edges,
                source,
                [target],
                [source, target],
                direction,
                maxHops,
              );
              const actual = await scanConnections(edges, source, [target], direction, maxHops);
              expect(
                actual,
                `DAG mask ${mask}, source ${source}, target ${target}, hops ${maxHops}`,
              ).toEqual(expected);
            }
          }
        }
      }
    },
  );
});
