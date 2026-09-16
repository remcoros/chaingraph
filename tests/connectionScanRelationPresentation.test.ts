import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  type ScanResult,
  type ScanRun,
} from '../src/Domain/ConnectionScan/connectionScan';
import {
  presentScanRun,
  scanRelationPresentation,
} from '../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanPresentation';

const tx = (n: number) => `tx:${n.toString(16).padStart(64, '0')}`;
const out = (n: number, vout = 0) => `out:${n.toString(16).padStart(64, '0')}:${vout}`;
const reconnection: ScanResult = {
  id: 'input-reconnection',
  kind: 'connection',
  relationship: 'shared-ancestor',
  endpoint: out(3, 1),
  path: [tx(1), out(2), tx(2), out(3), tx(3), out(3, 1)],
  directions: ['upstream', 'upstream', 'upstream', 'upstream', 'downstream'],
  context: { path: [tx(1), out(3, 1)], directions: ['upstream'] },
  scanDirection: 'upstream',
  meetingNode: tx(3),
  hops: 2,
};
const run: ScanRun = {
  id: 'relation-run',
  source: tx(1),
  targetIds: [out(3, 1)],
  settings: { ...DEFAULT_SCAN_SETTINGS },
  startedAt: '2026-09-11T12:00:00.000Z',
  status: 'complete',
  examined: 10,
  stopReasons: [],
  results: [],
};

describe('connection relation presentation', () => {
  it('identifies the two input branches and their meeting before path details', () => {
    expect(scanRelationPresentation(reconnection)).toEqual({
      title: 'Input reconnection',
      description: 'These input branches reconnect.',
      branches: [out(2), out(3, 1)],
      branchLabel: 'input',
      meeting: tx(3),
    });
  });

  it('distinguishes output reconnections from funding-side relations', () => {
    const result: ScanResult = {
      ...reconnection,
      relationship: 'shared-descendant',
      path: [tx(1), out(1), tx(4), out(2)],
      directions: ['downstream', 'downstream', 'upstream'],
      context: {
        path: [tx(1), out(1, 1), tx(2), out(2)],
        directions: ['downstream', 'downstream', 'downstream'],
      },
      endpoint: out(2),
      meetingNode: tx(4),
      scanDirection: 'downstream',
    };
    expect(scanRelationPresentation(result)).toMatchObject({
      title: 'Output reconnection',
      branches: [out(1), out(1, 1)],
      branchLabel: 'output',
    });
  });

  it('does not call a later divergence two distinct input branches', () => {
    expect(
      scanRelationPresentation({
        ...reconnection,
        context: {
          path: [tx(1), out(2), tx(2), out(3, 1)],
          directions: ['upstream', 'upstream', 'upstream'],
        },
      }),
    ).toMatchObject({ title: 'Reconnection' });
  });

  it('does not call an input-to-output loop an input reconnection', () => {
    const relation = scanRelationPresentation({
      ...reconnection,
      context: {
        path: [tx(1), out(1), tx(3), out(3, 1)],
        directions: ['downstream', 'downstream', 'downstream'],
      },
    });
    expect(relation?.title).toBe('Reconnection');
    expect(relation?.branches).toBeUndefined();
  });

  it('identifies reunion after divergence instead of calling the common prefix a meeting', () => {
    const relation = scanRelationPresentation({
      ...reconnection,
      relationship: 'direct',
      meetingNode: undefined,
      context: {
        path: [tx(1), out(2), tx(2), out(4), tx(4), out(3, 1)],
        directions: ['upstream', 'upstream', 'upstream', 'upstream', 'upstream'],
      },
    });
    expect(relation?.title).toBe('Reconnection');
    expect(relation?.meeting).toBe(out(3, 1));
  });

  it.each([
    ['upstream', 'Funding path', 'The target is upstream of the source.'],
    ['downstream', 'Spending path', 'The target is downstream of the source.'],
  ] as const)(
    'names a direct %s bridge without claiming a loop',
    (direction, title, description) => {
      expect(
        scanRelationPresentation({
          ...reconnection,
          relationship: 'direct',
          context: undefined,
          scanDirection: direction,
          bridge: true,
        }),
      ).toEqual({ title, description });
    },
  );

  it.each(['shared-ancestor', 'shared-descendant'] as const)(
    'preserves %s between independent anchors',
    (relationship) => {
      const relation = scanRelationPresentation({
        ...reconnection,
        relationship,
        context: undefined,
      });
      expect(relation?.title).toBe(
        relationship === 'shared-ancestor' ? 'Shared ancestor' : 'Shared descendant',
      );
      expect(relation?.meeting).toBe(tx(3));
      expect(relation?.branches).toBeUndefined();
    },
  );

  it('hides retained automatic ancestry-only cards, preserving verified bridges and reconnections', () => {
    const legacy = {
      ...reconnection,
      id: 'legacy',
      relationship: 'direct' as const,
      context: undefined,
    };
    const bridge = { ...legacy, id: 'bridge', bridge: true as const };
    const shown = presentScanRun(
      { ...run, results: [legacy, bridge, reconnection] },
      new Set([reconnection.id]),
    );
    expect(shown.results.map((result) => result.id)).toEqual(['bridge', reconnection.id]);
    expect(shown.results[1].dismissed).toBe(true);
    expect(run.results).toEqual([]);
  });

  it('preserves a picked-target funding path without requiring a return route', () => {
    const direct = { ...reconnection, relationship: 'direct' as const, context: undefined };
    expect(
      presentScanRun(
        { ...run, settings: { ...run.settings, targetScope: 'custom' }, results: [direct] },
        new Set(),
      ).results,
    ).toEqual([direct]);
  });
});
