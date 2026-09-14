import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
} from '../src/Domain/ConnectionScan/connectionScan';

const tx = (n: number) => `tx:${n.toString(16).padStart(64, '0')}`;
const out = (n: number, vout = 0) => `out:${n.toString(16).padStart(64, '0')}:${vout}`;
type Edge = [string, string];

describe('rejected targets inside a shared relation', () => {
  it('continues the target leg beyond a known sibling to reveal a farther reconnection', async () => {
    // The source spends one output of tx1. Its sibling is a frozen target whose
    // shared creator is already known, so that sibling alone is not a finding.
    const knownLinks: Edge[] = [
      [tx(1), out(1)],
      [tx(1), out(1, 1)],
      [out(1), tx(10)],
      [tx(10), out(10)],
      [out(10), tx(20)],
      [out(3), tx(20)],
    ];
    // That sibling funds two transactions before rejoining the loaded route at
    // out3. No output is spent twice; tx20 joins the two transaction branches.
    const edges: Edge[] = [
      ...knownLinks,
      [out(1, 1), tx(2)],
      [tx(2), out(2)],
      [out(2), tx(3)],
      [tx(3), out(3)],
    ];
    const run = await runConnectionScan({
      id: 'rejected-sibling-target',
      source: tx(10),
      targetIds: [out(1, 1), out(3)],
      displayedNodeIds: [tx(10)],
      knownNodeIds: [...new Set(knownLinks.flat())],
      knownLinks,
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'upstream' },
      resolveNeighbors: async (id, direction) => ({
        nodeIds: edges
          .filter((edge) => edge[direction === 'downstream' ? 0 : 1] === id)
          .map((edge) => edge[direction === 'downstream' ? 1 : 0]),
      }),
    });
    expect(run.results.filter((result) => result.kind === 'connection')).toMatchObject([
      {
        relationship: 'shared-ancestor',
        endpoint: out(3),
        meetingNode: tx(1),
        path: [tx(10), out(1), tx(1), out(1, 1), tx(2), out(2), tx(3), out(3)],
        context: {
          path: [tx(10), out(10), tx(20), out(3)],
          directions: ['downstream', 'downstream', 'upstream'],
        },
      },
    ]);
  });
});
