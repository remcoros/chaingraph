import { graphNavigationTransactionIds } from '../../../../Domain/Graph/graphHandoff';
import {
  verifiedWalletAddresses,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from '../../../../Domain/Wallet/walletRecords';
import { listWalletRelationships } from '../../../../Domain/Wallet/walletRelationships';
import { addGraphNodes } from '../../../../Domain/Graph/graphMembership';
import { useEntitySelection } from '../../Selection/useEntitySelection';
import { type GraphFilters, type Wallet, type Workspace } from '../../../../Domain/types';
import type { Dispatch, SetStateAction, RefObject } from 'react';

import type { WorkbenchMode } from '../../workbenchTypes';

import type { AppState } from '../../../useAppState';
import type { GraphHandoff } from '../workbenchHandoff';
import type { WorkspaceEvidence } from '../../ChainData/useWorkspaceEvidence';
interface Inputs {
  activeWorkspace: AppState['activeWorkspace'];
  wallet: Wallet | undefined;
  shownRightTab: NonNullable<Workspace['view']['rightTab']>;
  setNotice: AppState['setNotice'];
  select: (id: string, options?: { preserveCamera?: boolean; pickTarget?: boolean }) => void;
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  showOnGraph: GraphHandoff['showOnGraph'];
  setRightTab: Dispatch<SetStateAction<NonNullable<Workspace['view']['rightTab']>>>;
  selection: ReturnType<typeof useEntitySelection>;
  workspaces: AppState['workspaces'];
  selectionGeneration: RefObject<number>;
  loadGraphTransactions: GraphHandoff['loadGraphTransactions'];
  activeWorkspaceRef: AppState['activeWorkspaceRef'];
  mergeTransactions: WorkspaceEvidence['mergeTransactions'];
  run: WorkspaceEvidence['run'];
  recordHandoffInvoker: (origin: 'analysis' | 'wallet') => void;
  setReturnWorkbench: Dispatch<SetStateAction<WorkbenchMode | undefined>>;
  switchWorkbench: (next: WorkbenchMode, handoffFocus?: boolean, destination?: 'inspector') => void;
  setMobilePanel: Dispatch<SetStateAction<'graph' | 'left' | 'right'>>;
  recoveryGraph: GraphHandoff['recoveryGraph'];
  setSelectedId: Dispatch<SetStateAction<string | undefined>>;
  graph: GraphHandoff['graph'];
  revealGraphNodes: GraphHandoff['revealGraphNodes'];
  updateFilters: GraphHandoff['updateFilters'];
  setLeftTab: Dispatch<SetStateAction<'wallets' | 'entities' | 'bookmarks' | 'tags'>>;
  edit: (
    fn: (data: Workspace) => Workspace,
    undo?: boolean,
    group?: string,
    description?: string,
  ) => void;
}
export function createWalletActions({
  activeWorkspace,
  wallet,
  shownRightTab,
  setNotice,
  select,
  setGraphFilters,
  showOnGraph,
  setRightTab,
  selection,
  workspaces,
  selectionGeneration,
  loadGraphTransactions,
  activeWorkspaceRef,
  mergeTransactions,
  run,
  recordHandoffInvoker,
  setReturnWorkbench,
  switchWorkbench,
  setMobilePanel,
  recoveryGraph,
  setSelectedId,
  graph,
  revealGraphNodes,
  updateFilters,
  setLeftTab,
  edit,
}: Inputs) {
  function selectWalletRecord(
    nodeId: string,
    utxo?: WalletUtxoRecord,
    options: {
      tab?: NonNullable<Workspace['view']['rightTab']>;
      center?: boolean;
      isolate?: boolean;
      selectionIds?: readonly string[];
    } = {},
  ) {
    if (!activeWorkspace || !wallet) return;
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
        return;
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
      setRightTab(tab);
      if (options.selectionIds) {
        selection.replace(ids.length > 1 ? ids : []);
        selection.setMode(ids.length > 1);
      }
    };
    const transactionIds = graphNavigationTransactionIds(ids);
    if (!transactionIds.length) {
      if (!center) workspaces.update(ownerId, reveal, false);
      finish();
      return;
    }
    const transactionId = nodeId.split(':')[1];
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const loaded = await loadGraphTransactions(ids, signal);
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation) return;
      const current = workspaces.getUnlocked(ownerId)?.data;
      if (
        !current ||
        !current.wallets.some((item) => item.id === walletId) ||
        activeWorkspaceRef.current?.id !== ownerId
      )
        return;
      const transaction =
        current.transactions[transactionId] ?? loaded.find((tx) => tx.txid === transactionId);
      if (utxo && (!transaction || !verifyWalletUtxo(utxo, transaction, activeWorkspace.network)))
        throw new Error(
          'The UTXO response does not match its transaction. Refresh the wallet UTXOs and retry.',
        );
      // Cached navigation promotes graph context without replacing chain evidence.
      // A new transaction still takes the normal history/findings invalidation path.
      mergeTransactions(ownerId, loaded, transactionIds);
      if (!center) workspaces.update(ownerId, reveal, false);
      finish();
    });
  }
  /** Wallet review keeps its context: Graph and Analysis both offer a way back. */
  function openWalletRecord(
    nodeId: string,
    utxo?: WalletUtxoRecord,
    mode: 'graph' | 'inspect' | 'isolate' = 'graph',
    selectionIds?: readonly string[],
  ) {
    recordHandoffInvoker('wallet');
    setReturnWorkbench('wallet');
    switchWorkbench('graph', true, mode === 'inspect' ? 'inspector' : undefined);
    setMobilePanel(mode === 'inspect' ? 'right' : 'graph');
    selectWalletRecord(nodeId, utxo, {
      tab: 'inspect',
      center: mode !== 'inspect',
      isolate: mode === 'isolate',
      selectionIds: selectionIds ?? [nodeId],
    });
  }
  function analyzeFromWallet(nodeId?: string) {
    recordHandoffInvoker('wallet');
    setReturnWorkbench('wallet');
    const node = nodeId ? recoveryGraph.nodes.find((item) => item.id === nodeId) : undefined;
    if (node) select(node.id);
    else {
      setSelectedId(undefined);
      if (nodeId)
        setNotice(
          'This record is not loaded yet, so the scan uses the selected wallet. Open it in Graph to scan it directly.',
        );
    }
    switchWorkbench('analysis', true);
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
    setLeftTab('entities');
    setMobilePanel('graph');
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
