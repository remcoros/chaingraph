import type { Network } from '../../Domain/Chain/network';
import { CURRENT_WORKSPACE_VERSION, type Workspace } from './workspace';

/** Creates a new live workspace. Persistence only encodes it after the user edits or saves it. */
export function createWorkspace(name: string, network: Network): Workspace {
  return {
    version: CURRENT_WORKSPACE_VERSION,
    id: crypto.randomUUID(),
    name,
    network,
    createdAt: new Date().toISOString(),
    wallets: [],
    transactions: {},
    annotations: {},
    findings: [],
    watchedAddresses: [],
    demo: false,
    view: { dimensions: 3, sizeBy: 'uniform', glow: true, showAddresses: false, graphNodeIds: [] },
  };
}
