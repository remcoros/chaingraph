import { indexPreviousOutputs } from '../../../ChainData';
import { outputAddress } from '../../../Bitcoin';
import { addressReference, outpointReference, transactionReference } from '../../entityReferences';
import type { Workspace } from '../../workspace';

type LegacyGraphWorkspace = Pick<Workspace, 'network' | 'chainData'> & {
  view: Pick<Workspace['view'], 'showAddresses' | 'inputContext'>;
};

/** Reconstruct pre-v2 canvas membership without depending on App presentation. */
export function legacyGraphNodeIds(workspace: LegacyGraphWorkspace): string[] {
  const ids = new Set<string>();
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
  for (const transaction of Object.values(workspace.chainData.transactions)) {
    if (contextOutputs.has(transaction.txid)) continue;
    for (const input of transaction.vin)
      if (input.txid && input.vout !== undefined) contextOutputs.get(input.txid)?.add(input.vout);
  }
  const addAddress = (address?: string) => {
    if (address && workspace.view.showAddresses) ids.add(addressReference(address));
  };
  for (const transaction of Object.values(workspace.chainData.transactions)) {
    ids.add(transactionReference(transaction.txid));
    const scope = contextOutputs.get(transaction.txid);
    for (const output of transaction.vout) {
      if (scope && !scope.has(output.n)) continue;
      ids.add(outpointReference(transaction.txid, output.n));
      addAddress(outputAddress(output));
    }
  }
  for (const transaction of Object.values(workspace.chainData.transactions)) {
    if (contextOutputs.has(transaction.txid)) continue;
    for (const input of transaction.vin) {
      if (!input.txid || input.vout === undefined) continue;
      const id = outpointReference(input.txid, input.vout);
      if (ids.has(id)) continue;
      ids.add(id);
      const resolution = previousOutputs.get(`${input.txid}:${input.vout}`);
      addAddress(
        resolution?.status === 'loaded' || resolution?.status === 'attached'
          ? outputAddress(resolution.output)
          : undefined,
      );
    }
  }
  if (workspace.view.showAddresses)
    for (const address of workspace.chainData.watchedAddresses) ids.add(addressReference(address));
  return [...ids];
}
