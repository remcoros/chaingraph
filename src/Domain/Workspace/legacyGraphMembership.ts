import { indexPreviousOutputs, outputAddress } from '../Chain/prevouts';
import { addressNodeId, outputNodeId, txNodeId } from '../Metadata/entityReferences';
import type { Workspace } from './workspaceTypes';

type LegacyGraphWorkspace = Pick<
  Workspace,
  'network' | 'transactions' | 'inputContext' | 'watchedAddresses'
> & {
  view: Pick<Workspace['view'], 'showAddresses'>;
};

/** Reconstruct pre-v2 canvas membership without depending on App presentation. */
export function legacyGraphNodeIds(workspace: LegacyGraphWorkspace): string[] {
  const ids = new Set<string>();
  const previousOutputs = indexPreviousOutputs(workspace);
  const contextOutputs = new Map(
    Object.entries(workspace.inputContext ?? {}).map(([id, indexes]) => [id, new Set(indexes)]),
  );
  for (const transaction of Object.values(workspace.transactions)) {
    if (contextOutputs.has(transaction.txid)) continue;
    for (const input of transaction.vin)
      if (input.txid && input.vout !== undefined) contextOutputs.get(input.txid)?.add(input.vout);
  }
  const addAddress = (address?: string) => {
    if (address && workspace.view.showAddresses) ids.add(addressNodeId(address));
  };
  for (const transaction of Object.values(workspace.transactions)) {
    ids.add(txNodeId(transaction.txid));
    const scope = contextOutputs.get(transaction.txid);
    for (const output of transaction.vout) {
      if (scope && !scope.has(output.n)) continue;
      ids.add(outputNodeId(transaction.txid, output.n));
      addAddress(outputAddress(output));
    }
  }
  for (const transaction of Object.values(workspace.transactions)) {
    if (contextOutputs.has(transaction.txid)) continue;
    for (const input of transaction.vin) {
      if (!input.txid || input.vout === undefined) continue;
      const id = outputNodeId(input.txid, input.vout);
      if (ids.has(id)) continue;
      ids.add(id);
      const resolution = previousOutputs.get(id);
      addAddress(
        resolution?.status === 'loaded' || resolution?.status === 'attached'
          ? outputAddress(resolution.output)
          : undefined,
      );
    }
  }
  if (workspace.view.showAddresses)
    for (const address of workspace.watchedAddresses) ids.add(addressNodeId(address));
  return [...ids];
}
