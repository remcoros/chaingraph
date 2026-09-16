import { graphNavigationTransactionIds } from '../../../../Domain/Graph/graphHandoff';
import {
  verifiedWalletAddresses,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from '../../../../Domain/Wallet/walletRecords';
import { listWalletRelationships } from '../../../../Domain/Wallet/walletRelationships';
import { addGraphNodes } from '../../../../Domain/Graph/graphMembership';
import {
  type GraphFilters,
  type GraphRightTab,
  type Wallet,
  type Workspace,
} from '../../../../Domain/types';
import type { Dispatch, SetStateAction } from 'react';

import type { WorkbenchMode, WorkbenchSwitchOptions } from '../../workbenchTypes';
import type { WorkspaceCore } from '../../workspaceCore';
import type { WorkspaceSelection } from '../../Selection/useWorkspaceSelection';

import type { GraphHandoff } from '../workbenchHandoff';
import type { ChainFetch } from '../../ChainData/useChainFetch';

interface WalletActionRuntime {
  /** Captures the current selection generation and verifies it after asynchronous work. */
  captureCurrent: (workspaceId: string) => () => boolean;
  switchWorkbench: (next: WorkbenchMode, options?: WorkbenchSwitchOptions) => void;
}

interface Inputs {
  activeWorkspace: Workspace | undefined;
  workspaces: WorkspaceCore['workspaces'];
  edit: WorkspaceCore['edit'];
  setNotice: WorkspaceCore['setNotice'];
  select: WorkspaceSelection['select'];
  setSelectedId: WorkspaceSelection['setSelectedId'];
  replaceSelection: WorkspaceSelection['batch']['replace'];
  setSelectionMode: WorkspaceSelection['batch']['setMode'];
  /** Everything this workbench needs to hand a record over to Graph. */
  handoff: GraphHandoff;
  fetch: ChainFetch;
  wallet: Wallet | undefined;
  shownRightTab: GraphRightTab;
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
}
export function createWalletActions({
  activeWorkspace,
  workspaces,
  edit,
  setNotice,
  select,
  setSelectedId,
  replaceSelection,
  setSelectionMode,
  handoff,
  fetch,
  wallet,
  shownRightTab,
  setGraphFilters,
}: Inputs) {
  const {
    showOnGraph,
    showRecordTab,
    showPanel,
    revealEntities,
    revealGraphNodes,
    updateFilters,
    loadGraphTransactions,
    graph,
    recoveryGraph,
  } = handoff;
  const { mergeTransactions, run } = fetch;

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
        watchedAddresses: addresses.length
          ? [...new Set([...current.watchedAddresses, ...addresses])]
          : current.watchedAddresses,
        view: {
          ...admitted.view,
          hiddenNodeIds: current.view.hiddenNodeIds?.filter((id) => !idSet.has(id)),
          showAddresses: addresses.length > 0 || current.view.showAddresses,
          smallAmountThreshold: center ? undefined : current.view.smallAmountThreshold,
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
      if (!current || !current.wallets.some((item) => item.id === walletId)) return;
      const transaction =
        current.transactions[transactionId] ?? loaded.find((tx) => tx.txid === transactionId);
      if (utxo && (!transaction || !verifyWalletUtxo(utxo, transaction, activeWorkspace.network)))
        throw new Error(
          'The UTXO response does not match its transaction. Refresh the wallet UTXOs and retry.',
        );
      // Cached navigation promotes graph context without replacing chain evidence.
      // A new transaction still takes the normal history/findings invalidation path.
      mergeTransactions(ownerId, loaded, transactionIds);
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
  function showWalletActivity(target: Wallet) {
    const ids = new Set(target.unreviewedTransactionIds ?? []);
    const activityNodes = graph.nodes
      .filter((node) => node.kind === 'transaction' && node.txid && ids.has(node.txid))
      .map((node) => node.id);
    revealGraphNodes(activityNodes);
    updateFilters({
      includeIds: activityNodes,
      preserveContext: true,
    });
    revealEntities();
    showPanel('graph');
    edit(
      (current) => ({
        ...current,
        wallets: current.wallets.map((wallet) =>
          wallet.id === target.id
            ? { ...wallet, unreviewedTransactionIds: [], activityOverflow: false }
            : wallet,
        ),
      }),
      false,
    );
  }
  return { selectWalletRecord, openWalletRecord, analyzeFromWallet, showWalletActivity };
}
