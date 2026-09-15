import { describe, expect, it } from 'vitest';
import {
  graphNavigationTransactionIds,
  prepareGraphNavigation,
  resolveGraphHandoff,
} from '../src/Domain/Graph/graphHandoff';
import { analysisTools } from '../src/Domain/Analysis/analysis';
import { filterGraph } from '../src/Domain/Graph/graphFilters';
import { projectGraphMembership } from '../src/Domain/Graph/graphMembership';
import { flowInputPlan, mergeFlowInputs } from '../src/Domain/Chain/flowInputs';
import { buildGraph, newWorkspace } from '../src/Domain/Workspace/workspace';
import { outputNodeId, txNodeId } from '../src/Domain/types';

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
  it('selects the exact input outpoint while retaining its unknown value', () => {
    const workspace = fixture();
    const requested = outputNodeId(missing, 3);
    expect(buildGraph(workspace).nodes.some((node) => node.id === requested)).toBe(false);
    const target = resolveGraphHandoff(workspace, [requested], [parent])!;
    expect(target.selectedId).toBe(requested);
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

  it('retains the requested input and output identities for isolation', () => {
    const workspace = fixture();
    const unknownInput = outputNodeId(missing, 3);
    const loadedOutput = outputNodeId(parent, 0);
    const target = resolveGraphHandoff(workspace, [unknownInput, loadedOutput], [parent])!;
    expect(target.selectedId).toBe(unknownInput);
    expect(target.ids).toEqual([unknownInput, loadedOutput]);
    expect(resolveGraphHandoff(workspace, [unknownInput], [parent])!.ids).toEqual([unknownInput]);
  });

  it('does not substitute a supporting transaction for an unavailable requested entity', () => {
    const workspace = fixture();
    expect(resolveGraphHandoff(workspace, [outputNodeId(missing, 7)], [parent])).toBeUndefined();
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

describe('shared Show and Isolate preparation', () => {
  it.each([false, true])('retains the clicked mixed-script input with isolate=%s', (isolate) => {
    const workspace = fixture();
    workspace.transactions[parent].vin[0].prevout = {
      value: 0.3,
      scriptPubKey: { type: 'witness_v0_keyhash' },
    };
    workspace.transactions[parent].vout[0].scriptPubKey.type = 'witness_v0_keyhash';
    workspace.transactions[parent].vout[1].scriptPubKey.type = 'witness_v1_taproot';
    workspace.view.panels = { flow: { height: 'collapsed' } };
    const tool = analysisTools.find((entry) => entry.id === 'script-types')!;
    const finding = tool.run(workspace, [parent])[0];
    expect(finding.title).toBe('Mixed output script types');
    const requested = outputNodeId(missing, 3);
    expect(finding.nodeIds).toContain(requested);
    const target = resolveGraphHandoff(workspace, [requested], finding.txids)!;
    const navigation = prepareGraphNavigation(target.workspace, target.ids, { isolate })!;
    const shown = filterGraph(
      projectGraphMembership(
        buildGraph(navigation.workspace),
        navigation.workspace.view.graphNodeIds,
      ),
      navigation.filters,
    );
    expect(navigation.selectedId).toBe(requested);
    expect(shown.nodes.map((node) => node.id)).toContain(requested);
    expect(navigation.workspace.view.panels?.flow?.height).toBe('collapsed');
    const selected = shown.nodes.find((node) => node.id === requested)!;
    const plan = flowInputPlan(navigation.workspace, selected);
    expect(plan).toEqual({ transactionId: parent, missing: [missing] });
    const hydrated = mergeFlowInputs(navigation.workspace, parent, selected, [
      {
        txid: missing,
        vin: [{ txid: '8'.repeat(64), vout: 0 }],
        vout: [{ n: 3, value: 0.3, scriptPubKey: { type: 'witness_v0_keyhash' } }],
      },
    ]);
    expect(flowInputPlan(hydrated, selected).missing).toEqual([]);
    expect(buildGraph(hydrated).nodes.some((node) => node.id === requested)).toBe(true);
    expect(hydrated.inputContext?.[missing]).toEqual([3]);
  });

  it.each([false, true])('reveals a hidden loaded wallet outpoint with isolate=%s', (isolate) => {
    const workspace = fixture();
    const requested = outputNodeId(parent, 1);
    workspace.view.hiddenNodeIds = [requested, txNodeId(child)];
    workspace.view.smallAmountThreshold = 100_000_000;
    const navigation = prepareGraphNavigation(workspace, [requested], { isolate })!;
    expect(navigation.selectedId).toBe(requested);
    expect(navigation.workspace.view.graphNodeIds).toContain(requested);
    expect(navigation.workspace.view.hiddenNodeIds).toEqual([txNodeId(child)]);
    expect(navigation.workspace.view.smallAmountThreshold).toBeUndefined();
    expect(navigation.workspace.transactions).toBe(workspace.transactions);
    expect(navigation.workspace.annotations).toBe(workspace.annotations);
    expect(navigation.workspace.wallets).toBe(workspace.wallets);
    const selected = buildGraph(navigation.workspace).nodes.find((node) => node.id === requested)!;
    expect(flowInputPlan(navigation.workspace, selected).missing).toEqual([]);
    expect(navigation.filters).toEqual(isolate ? { focus: { id: requested, hops: 1 } } : {});
    expect(workspace.view.hiddenNodeIds).toContain(requested);
  });

  it('isolates batches with a preferred member and deduplicated explicit scope', () => {
    const ids = [outputNodeId(parent, 0), outputNodeId(child, 0)];
    const result = prepareGraphNavigation(fixture(), [...ids, ids[0]], {
      isolate: true,
      selectedId: ids[1],
    })!;
    expect(result.ids).toEqual(ids);
    expect(result.selectedId).toBe(ids[1]);
    expect(result.filters).toEqual({ includeIds: ids, preserveContext: true });
    expect(prepareGraphNavigation(fixture(), [])).toBeUndefined();
  });

  it('admits and watches an address with address display previously disabled', () => {
    const workspace = fixture();
    const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
    const id = `addr:${address}`;
    const result = prepareGraphNavigation(workspace, [id])!;
    expect(result.workspace.watchedAddresses).toContain(address);
    expect(result.workspace.view.showAddresses).toBe(true);
    expect(buildGraph(result.workspace).nodes.some((node) => node.id === id)).toBe(true);
    expect(workspace.watchedAddresses).not.toContain(address);
  });

  it('keeps live tag/wallet filters while revealing their explicit current members', () => {
    const filters = { walletId: 'wallet-a', preserveContext: true };
    const result = prepareGraphNavigation(fixture(), [txNodeId(parent)], { filters })!;
    expect(result.filters).toBe(filters);
    expect(result.workspace.view.graphNodeIds).toContain(txNodeId(parent));
  });

  it('loads only distinct transactions referenced by a requested batch', () => {
    expect(
      graphNavigationTransactionIds([
        txNodeId(parent),
        outputNodeId(parent, 0),
        outputNodeId(child, 0),
        'addr:example',
        'not-an-entity',
      ]),
    ).toEqual([parent, child]);
  });
});
