import { graphNavigationTransactionIds } from '../graphHandoffNavigation';
import {
  verifiedWalletAddresses,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from '../../../../Core/Workspace/Wallets/walletRecords';
import { listWalletRelationships } from '../../../../Core/Workspace/Wallets/walletRelationships';
import { addGraphNodes } from '../../GraphState/graphMembership';
import type { GraphFilters, GraphRightTab } from '../../../../Core/Workspace/view';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../Core/Workspace/workspace';

import type { Dispatch, SetStateAction } from 'react';

import type { WorkbenchMode, WorkbenchSwitchOptions } from '../../workbenchTypes';

import type { WorkspaceCore } from '../../workspaceCore';
import type { WorkspaceSelection } from '../../Selection/useWorkspaceSelection';

import type { GraphHandoff } from '../workbenchHandoff';
import type { ChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import type { WorkspaceOperation } from '../../useWorkspaceOperation';

interface WalletActionRuntime {
  /** Captures the current selection generation and verifies it after asynchronous work. */
  captureCurrent: (workspaceId: string) => () => boolean;
  switchWorkbench: (next: WorkbenchMode, options?: WorkbenchSwitchOptions) => void;
}

interface Inputs {
  activeWorkspace: Workspace | undefined;
  workspaces: WorkspaceCore['workspaces'];
  setNotice: WorkspaceCore['setNotice'];
  select: WorkspaceSelection['select'];
  setSelectedId: WorkspaceSelection['setSelectedId'];
  replaceSelection: WorkspaceSelection['batch']['replace'];
  setSelectionMode: WorkspaceSelection['batch']['setMode'];
  /** Everything this workbench needs to hand a record over to Graph. */
  handoff: GraphHandoff;
  transactions: ChainDataAcquisition;
  operation: WorkspaceOperation;
  wallet: Wallet | undefined;
  shownRightTab: GraphRightTab;
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
}
export function createWalletActions({
  activeWorkspace,
  workspaces,
  setNotice,
  select,
  setSelectedId,
  replaceSelection,
  setSelectionMode,
  handoff,
  transactions,
  operation,
  wallet,
  shownRightTab,
  setGraphFilters,
}: Inputs) {
  const { showOnGraph, showRecordTab, showPanel, loadGraphTransactions, recoveryGraph } = handoff;
  const { transactions: recordTransactions } = transactions.observe;
  const { run } = operation;

  function selectWalletRecord(
    runtime: WalletActionRuntime,
    nodeId: string,
    utxo?: WalletUtxoRecord,
    options: {
      tab?: GraphRightTab;
      center?: boolean;
      isolate?: boolean;
      selectionIds?: readonly string[];
    } = {},
  ) {
    if (!activeWorkspace || !wallet) return false;
    const ownerId = activeWorkspace.id;
    const walletId = wallet.id;
    const tab = options.tab ?? shownRightTab;
    const center = options.center ?? true;
    const ids = [...new Set(options.selectionIds ?? [nodeId])];
    const idSet = new Set(ids);
    const addresses = ids.filter((id) => id.startsWith('addr:')).map((id) => id.slice(5));
    if (addresses.length) {
      const relationships = listWalletRelationships(activeWorkspace, wallet);
      const known = new Set([
        ...verifiedWalletAddresses(wallet, activeWorkspace.network).map((entry) => entry.address),
        ...relationships.sources.flatMap((entry) => (entry.address ? [entry.address] : [])),
        ...relationships.destinations.flatMap((entry) => (entry.address ? [entry.address] : [])),
      ]);
      if (addresses.some((address) => !known.has(address))) {
        setNotice('An address is no longer in this wallet view.');
        return false;
      }
    }
    const reveal = (current: Workspace): Workspace => {
      const admitted = addGraphNodes(current, ids);
      return {
        ...admitted,
        view: {
          ...admitted.view,
          hiddenNodeIds: current.view.hiddenNodeIds?.filter((id) => !idSet.has(id)),
          showAddresses: addresses.length > 0 || current.view.showAddresses,
          smallAmountThreshold: center ? undefined : current.view.smallAmountThreshold,
        },
        chainData: {
          ...admitted.chainData,
          watchedAddresses: addresses.length
            ? [...new Set([...current.chainData.watchedAddresses, ...addresses])]
            : current.chainData.watchedAddresses,
        },
      };
    };
    const finish = () => {
      if (center) showOnGraph(ids, { isolate: options.isolate, selectedId: nodeId });
      else {
        select(nodeId);
        setGraphFilters({});
      }
      showRecordTab(tab);
      if (options.selectionIds) {
        replaceSelection(ids.length > 1 ? ids : []);
        setSelectionMode(ids.length > 1);
      }
    };
    const transactionIds = graphNavigationTransactionIds(ids);
    if (!transactionIds.length) {
      if (!center) workspaces.getUnlocked(ownerId)?.edit(reveal, false);
      finish();
      return true;
    }
    const transactionId = nodeId.split(':')[1];
    const isCurrent = runtime.captureCurrent(ownerId);
    void run(async (signal) => {
      const loaded = await loadGraphTransactions(ids, signal);
      signal.throwIfAborted();
      if (!isCurrent()) return;
      const current = workspaces.getUnlocked(ownerId)?.data;
      if (!current || !current.wallets.definitions.some((item) => item.id === walletId)) return;
      const transaction =
        current.chainData.transactions[transactionId] ??
        loaded.find((tx) => tx.txid === transactionId);
      if (utxo && (!transaction || !verifyWalletUtxo(utxo, transaction, activeWorkspace.network)))
        throw new Error(
          'The UTXO response does not match its transaction. Refresh the wallet UTXOs and retry.',
        );
      // Cached navigation promotes graph context without replacing chain evidence.
      // A new transaction still takes the normal history/findings invalidation path.
      recordTransactions(ownerId, loaded, { promotionIds: transactionIds });
      if (!center) workspaces.getUnlocked(ownerId)?.edit(reveal, false);
      finish();
    });
    return true;
  }
  /** Wallet review keeps its context: Graph and Analysis both offer a way back. */
  function openWalletRecord(
    runtime: WalletActionRuntime,
    nodeId: string,
    utxo?: WalletUtxoRecord,
    presentation: 'show' | 'inspect' | 'isolate' = 'show',
    selectionIds?: readonly string[],
  ) {
    if (
      selectWalletRecord(runtime, nodeId, utxo, {
        tab: 'inspect',
        center: presentation !== 'inspect',
        isolate: presentation === 'isolate',
        selectionIds: selectionIds ?? [nodeId],
      })
    ) {
      showPanel(presentation === 'inspect' ? 'right' : 'graph');
      runtime.switchWorkbench('graph', {
        interaction: 'handoff',
        focus: presentation === 'inspect' ? 'inspector' : 'stage',
      });
    }
  }
  function analyzeFromWallet(runtime: WalletActionRuntime, nodeId?: string) {
    const node = nodeId ? recoveryGraph.nodes.find((item) => item.id === nodeId) : undefined;
    if (node) select(node.id);
    else {
      setSelectedId(undefined);
      if (nodeId)
        setNotice(
          'This record is not loaded yet, so the scan uses the selected wallet. Open it in Graph to scan it directly.',
        );
    }
    runtime.switchWorkbench('analysis', { interaction: 'handoff', focus: 'workbench' });
  }
  return { selectWalletRecord, openWalletRecord, analyzeFromWallet };
}
