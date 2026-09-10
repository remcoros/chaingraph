import { describe, expect, it } from 'vitest';
import { resolveGraphHandoff } from '../src/domain/graphHandoff';
import { buildGraph, newWorkspace } from '../src/domain/workspace';
import { outputNodeId, txNodeId } from '../src/domain/types';

const parent = '1'.repeat(64);
const child = '2'.repeat(64);
const missing = '9'.repeat(64);
function fixture() {
  const workspace = newWorkspace('Public handoff fixture', 'mainnet');
  workspace.transactions = {
    [parent]: {
      txid: parent,
      vin: [{ txid: missing, vout: 3 }],
      vout: [0, 1].map((n) => ({ n, value: 0.1, scriptPubKey: {} })),
    },
    [child]: {
      txid: child,
      vin: [{ txid: parent, vout: 0 }],
      vout: [{ n: 0, value: 0.09, scriptPubKey: {} }],
    },
  };
  workspace.inputContext = { [parent]: [0] };
  return workspace;
}

describe('finding navigation using loaded evidence', () => {
  it('opens the loaded supporting transaction while retaining its unknown input value', () => {
    const workspace = fixture();
    const requested = outputNodeId(missing, 3);
    expect(buildGraph(workspace).nodes.some((node) => node.id === requested)).toBe(false);
    const target = resolveGraphHandoff(workspace, [requested], [parent])!;
    expect(target.selectedId).toBe(txNodeId(parent));
    expect(target.usedSupportingTransaction).toBe(true);
    expect(
      buildGraph(target.workspace).nodes.find((node) => node.id === requested)?.value,
    ).toBeUndefined();
    expect(target.workspace.transactions).toBe(workspace.transactions);
    expect(workspace.inputContext).toEqual({ [parent]: [0] });
  });

  it('reveals an existing sibling without discarding unrelated compact context', () => {
    const workspace = fixture();
    workspace.inputContext![child] = [0];
    const target = resolveGraphHandoff(workspace, [outputNodeId(parent, 1)])!;
    expect(target.selectedId).toBe(outputNodeId(parent, 1));
    expect(target.workspace.inputContext).toEqual({ [child]: [0] });
  });

  it('retains missing input evidence in isolation while selecting a loaded entity', () => {
    const workspace = fixture();
    const unknownInput = outputNodeId(missing, 3);
    const loadedOutput = outputNodeId(parent, 0);
    const target = resolveGraphHandoff(workspace, [unknownInput, loadedOutput], [parent])!;
    expect(target.selectedId).toBe(loadedOutput);
    expect(target.ids).toEqual([unknownInput, loadedOutput]);
    expect(target.usedSupportingTransaction).toBe(false);
    const fallback = resolveGraphHandoff(workspace, [unknownInput], [parent])!;
    expect(fallback.ids).toEqual([unknownInput, txNodeId(parent)]);
  });

  it('falls back to a loaded supporting transaction or declines an impossible handoff', () => {
    const workspace = fixture();
    expect(resolveGraphHandoff(workspace, [outputNodeId(missing, 7)], [parent])?.selectedId).toBe(
      txNodeId(parent),
    );
    expect(resolveGraphHandoff(workspace, [outputNodeId(missing, 7)], [missing])).toBeUndefined();
    expect(resolveGraphHandoff(workspace, [], [child])?.selectedId).toBe(txNodeId(child));
  });

  it('prefers a visible requested target without mutating manual hiding', () => {
    const workspace = fixture();
    workspace.view.hiddenNodeIds = [outputNodeId(parent, 0)];
    const target = resolveGraphHandoff(workspace, [
      outputNodeId(parent, 0),
      outputNodeId(child, 0),
    ])!;
    expect(target.selectedId).toBe(outputNodeId(child, 0));
    expect(target.workspace.view.hiddenNodeIds).toEqual(workspace.view.hiddenNodeIds);
  });
});
