import { indexPreviousOutputs } from '../../../Core/ChainData';
import { outputAddress, sats } from '../../../Core/Bitcoin';
import {
  addressReference,
  outpointReference,
  transactionReference,
} from '../../../Core/Workspace/entityReferences';
import type { Workspace } from '../../../Core/Workspace/workspace';

import { short } from '../../../Core/Formatting';
import type { GraphData, GraphNode } from './types';

/**
 * The evidence a graph is drawn from, and how a transaction's inputs count as
 * context rather than evidence in their own right.
 *
 * Kept below the workspace module so that anything building or validating a
 * graph can reach it without depending on the whole saved workspace.
 */
export type GraphEvidenceWorkspace = Pick<
  Workspace,
  'network' | 'chainData' | 'analysis' | 'annotations'
> & {
  view: Pick<Workspace['view'], 'showAddresses' | 'inputContext'>;
};

export function buildGraph(workspace: GraphEvidenceWorkspace): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphData['links'][number]>();
  const addressBalanceValue = (address: string) => {
    const observation = workspace.chainData.addressBalances?.[address];
    if (!observation || observation.network !== workspace.network) return undefined;
    const total = observation.confirmedSats + observation.unconfirmedSats;
    return Number.isSafeInteger(total) && total >= 0 ? total : undefined;
  };
  const previousOutputs = indexPreviousOutputs({
    network: workspace.network,
    transactions: workspace.chainData.transactions,
  });
  const contextOutputs = new Map(
    Object.entries(workspace.view.inputContext ?? {}).map(([id, indexes]) => [
      id,
      new Set(indexes),
    ]),
  );
  // Every input of a fully displayed transaction stays visible with loaded metadata,
  // including when several displayed transactions share the same funding parent.
  for (const tx of Object.values(workspace.chainData.transactions)) {
    if (contextOutputs.has(tx.txid)) continue;
    for (const input of tx.vin)
      if (input.txid && input.vout !== undefined) contextOutputs.get(input.txid)?.add(input.vout);
  }
  const clusters = new Map<string, string>();
  for (const finding of workspace.analysis.findings)
    if (!finding.excluded && !finding.stale)
      for (const id of finding.nodeIds) clusters.set(id, finding.id);
  const add = (node: GraphNode) => {
    const old = nodes.get(node.id);
    const annotation = workspace.annotations.entities[node.id];
    const label = annotation?.label || node.label;
    nodes.set(node.id, {
      ...old,
      ...node,
      label: annotation?.icon ? `${annotation.icon} ${label}` : label,
      cluster: clusters.get(node.id),
    });
  };
  const link = (source: string, target: string, kind: GraphData['links'][number]['kind']) => {
    const id = `${source}>${target}`;
    links.set(id, { id, source, target, kind });
  };
  for (const tx of Object.values(workspace.chainData.transactions)) {
    add({
      id: transactionReference(tx.txid),
      kind: 'transaction',
      txid: tx.txid,
      label: short(tx.txid),
      value: tx.vout.reduce((s, o) => s + sats(o.value), 0),
    });
    for (const output of tx.vout) {
      const scope = contextOutputs.get(tx.txid);
      if (scope && !scope.has(output.n)) continue;
      const id = outpointReference(tx.txid, output.n);
      const address = outputAddress(output);
      add({
        id,
        kind: 'output',
        txid: tx.txid,
        vout: output.n,
        label: `${short(tx.txid)}:${output.n}`,
        value: sats(output.value),
        address,
      });
      link(transactionReference(tx.txid), id, 'creates');
      if (address && workspace.view.showAddresses) {
        const aid = addressReference(address);
        add({
          id: aid,
          kind: 'address',
          label: short(address),
          address,
          value: addressBalanceValue(address),
        });
        link(id, aid, 'address');
      }
    }
  }
  for (const tx of Object.values(workspace.chainData.transactions)) {
    if (contextOutputs.has(tx.txid)) continue;
    for (const input of tx.vin) {
      if (!input.txid || input.vout === undefined) continue;
      const id = outpointReference(input.txid, input.vout);
      if (!nodes.has(id)) {
        const resolution = previousOutputs.get(`${input.txid}:${input.vout}`);
        const output =
          resolution?.status === 'loaded' || resolution?.status === 'attached'
            ? resolution.output
            : undefined;
        const address = output ? outputAddress(output) : undefined;
        add({
          id,
          kind: 'output',
          txid: input.txid,
          vout: input.vout,
          label: `${short(input.txid)}:${input.vout}`,
          value: output ? sats(output.value) : undefined,
          address,
        });
        if (address && workspace.view.showAddresses) {
          const aid = addressReference(address);
          add({
            id: aid,
            kind: 'address',
            label: short(address),
            address,
            value: addressBalanceValue(address),
          });
          link(id, aid, 'address');
        }
      }
      link(id, transactionReference(tx.txid), 'spends');
    }
  }
  if (workspace.view.showAddresses) {
    for (const address of workspace.chainData.watchedAddresses) {
      const id = addressReference(address);
      if (!nodes.has(id))
        add({
          id,
          kind: 'address',
          label: short(address),
          address,
          value: addressBalanceValue(address),
        });
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}
