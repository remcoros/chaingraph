// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';
import { transactionReference } from '../../../../Core/Workspace/entityReferences';
import { useEntitySelection } from '../../Selection/useEntitySelection';
import { presentGraph, type GraphPalette } from './Renderer/presentation';
import { useGraphProjection } from './useGraphProjection';

afterEach(cleanup);

it('preserves Value-sized bodies for batch/scan selections and restores enlargement in other modes', () => {
  const workspace = createWorkspace('Synthetic sizing', 'testnet4');
  const txid = 'a'.repeat(64);
  const id = transactionReference(txid);
  workspace.view.graphNodeIds = [id];
  workspace.chainData.transactions[txid] = {
    txid,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1.38, scriptPubKey: {} }],
  };
  const palette: GraphPalette = {
    transaction: '#aaaaaa',
    output: '#bbbbbb',
    address: '#cccccc',
    accent: '#ff8800',
    muted: '#777777',
    background: '#111111',
  };
  const { result, rerender } = renderHook(
    ({ sizeBy, picking }: { sizeBy: 'value' | 'uniform' | 'degree'; picking: boolean }) => {
      const selection = useEntitySelection(workspace.id);
      const projection = useGraphProjection({
        activeWorkspace: { ...workspace, view: { ...workspace.view, sizeBy, glow: false } },
        graphFilters: {},
        fitToken: 0,
        selectedId: undefined,
        selection,
        scanTargetDraft: { workspaceId: workspace.id, source: 'synthetic', ids: [id] },
        pickingScanTargets: picking,
        entityPanelFilters: {},
        entityFiltersLinked: true,
      });
      return { projection, selection };
    },
    { initialProps: { sizeBy: 'value', picking: false } },
  );
  const render = (selection: boolean) => {
    const p = result.current.projection;
    return presentGraph(
      {
        ...p.visibleGraph,
        dimensions: 3,
        sizeBy: p.appliedGraphRequest.sizeBy,
        glow: false,
        nodePresentation: selection ? p.batchPresentation : undefined,
        batchSelectedIds: selection ? p.highlightedSelection : [],
      },
      palette,
    ).nodes.find((node) => node.id === id)!;
  };
  const baseline = render(false).radius;
  act(() => result.current.selection.replace([id]));
  expect(render(true)).toMatchObject({
    radius: baseline,
    selected: false,
    selectionRing: true,
    color: palette.accent,
  });
  act(() => result.current.selection.clear());
  rerender({ sizeBy: 'value', picking: true });
  expect(render(true)).toMatchObject({
    radius: baseline,
    selected: false,
    selectionRing: true,
    color: palette.accent,
  });
  for (const sizeBy of ['uniform', 'degree'] as const) {
    rerender({ sizeBy, picking: true });
    expect(render(true).radius).toBeCloseTo(render(false).radius * 1.35);
  }
});
