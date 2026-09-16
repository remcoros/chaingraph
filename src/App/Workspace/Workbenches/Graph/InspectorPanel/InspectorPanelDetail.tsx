import { SelectedTags } from '../TagsPanel';
import { ChevronRight, Eye } from 'lucide-react';
import { NodeInspector, WalletInspector } from './Inspector';
import { pruneWalletReviews } from '../../../Wallet/walletReview';
import type { WorkspaceController } from '../../../useWorkspace';

export function InspectorPanelDetail({ workspace }: { workspace: WorkspaceController }) {
  const {
    activeWorkspace,
    switchWorkbench,
    setNotice,
    setNoticeSequence,
    operation: workspaceOperation,
    annotations,
    selectedTransaction: tx,
    canTraceAncestry,
    chainDataDisabledReason,
    entityRemoval,
    edit,
    canLoadChainData,
    dialogs,
    tour,
  } = workspace;
  const operation = workspaceOperation.status;
  const {
    setMobilePanel,
    setPanels,
    right: { tab: shownRightTab },
  } = workspace.graph.panels;
  const {
    utxoObservation: walletUtxoObservation,
    selected: wallet,
    discovery: walletDiscovery,
  } = workspace.wallet;
  const {
    invalidate: invalidateSelection,
    setSelectedWallet,
    setSelectedId,
    select,
  } = workspace.selection;
  const { selected, walletMatches, graph } = workspace.graph.projection;
  const { balance: addressBalance } = workspace.graph.address;
  const { refreshBalance: refreshAddressBalance } = workspace.graph.address.actions;
  const { expand } = workspace.graph.navigation;
  const { revealGraphNodes, centerNode, setEntityHidden, updateFilters, refreshTransaction } =
    workspace.graph.actions;
  const { showWalletActivity } = workspace.wallet.actions;

  if (!activeWorkspace) return null;
  return shownRightTab === 'scan' ||
    shownRightTab === 'addresses' ||
    shownRightTab === 'transactions' ||
    shownRightTab === 'utxos' ? null : wallet &&
    !selected &&
    tour.step?.view?.rightTab !== 'inspect' ? (
    <WalletInspector
      key={`wallet-inspector:${activeWorkspace.id}:${wallet.id}`}
      wallet={wallet}
      workspace={activeWorkspace}
      busy={!!operation}
      canLoadChainData={canLoadChainData}
      onScan={() => void walletDiscovery.run(wallet)}
      onShowActivity={() => showWalletActivity(wallet)}
      onEdit={() => dialogs.openWalletRename(activeWorkspace.id, wallet.id)}
      onShowWallet={() => {
        updateFilters({ walletId: wallet.id, preserveContext: true });
        setMobilePanel('graph');
      }}
      onRemove={() => {
        edit((c) =>
          pruneWalletReviews({
            ...c,
            wallets: c.wallets.filter((x) => x.id !== wallet.id),
          }),
        );
        setSelectedWallet(undefined);
      }}
    />
  ) : selected ? (
    <NodeInspector
      walletUtxoObservation={walletUtxoObservation}
      addressBalance={addressBalance}
      walletMatch={walletMatches.get(selected.id)}
      onNotify={(message) => {
        setNotice(message);
        setNoticeSequence((value) => value + 1);
      }}
      onSelectWallet={(id) => {
        invalidateSelection();
        workspaceOperation.cancel();
        setSelectedWallet(id);
        setSelectedId(undefined);
        setPanels((current) => ({
          ...current,
          right: { ...current.right, tab: 'inspect' },
          mobile: 'right',
        }));
      }}
      tagsPanel={
        <SelectedTags
          key={selected.id}
          workspace={activeWorkspace}
          selected={selected}
          openToken={annotations.edit.target === 'tags' ? annotations.edit.token : 0}
          onOpenHandled={annotations.edit.acknowledge}
          onChange={annotations.changeTags}
          onManage={() => {
            setPanels((current) => ({
              ...current,
              left: { ...current.left, tab: 'tags' },
              mobile: 'left',
            }));
          }}
        />
      }
      activeWorkspace={activeWorkspace}
      selected={selected}
      tx={tx}
      graph={graph}
      busy={!!operation}
      canLoadChainData={canTraceAncestry}
      chainDataDisabledReason={chainDataDisabledReason}
      editToken={annotations.edit.target === 'tags' ? undefined : annotations.edit.token}
      editTarget={annotations.edit.target === 'icon' ? 'icon' : 'label'}
      onEditHandled={annotations.edit.acknowledge}
      onSelectNode={(id) => {
        if (id.startsWith('addr:')) revealGraphNodes([id]);
        select(id);
      }}
      onCenter={() => centerNode()}
      onShowAndCenter={() => centerNode(selected.id, undefined, true)}
      hiddenNodeIds={activeWorkspace.view.hiddenNodeIds}
      graphNodeIds={activeWorkspace.view.graphNodeIds}
      onSetHidden={setEntityHidden}
      annotationKey={`${activeWorkspace.id}:${selected.id}`}
      onExpand={(direction) => void expand(direction)}
      onRefresh={() => refreshTransaction(selected.txid)}
      onRefreshAddressBalance={refreshAddressBalance}
      canRemove={!!entityRemoval.selectedPlan}
      onRemove={() => entityRemoval.request()}
      onSave={(annotation, group) => {
        const previous = activeWorkspace.annotations[selected.id] ?? {
          label: '',
          note: '',
          icon: '',
          bookmarked: false,
        };
        const field =
          (Object.keys(annotation) as (keyof typeof annotation)[]).find(
            (key) => annotation[key] !== previous?.[key],
          ) ?? 'label';
        edit(
          (current) => ({
            ...current,
            annotations: { ...current.annotations, [selected.id]: annotation },
          }),
          true,
          `annotation:${selected.id}:${field}:${group}`,
        );
      }}
    />
  ) : (
    <div className="inspector-empty">
      <Eye size={29} />
      <h3>A closer look</h3>
      {activeWorkspace.description && (
        <p className="workspace-description">{activeWorkspace.description}</p>
      )}
      <p>
        Select a node in the graph or an item in Entities to inspect it, add labels and notes, and
        follow its paths.
      </p>
      <button
        className="text-button"
        onClick={() => switchWorkbench('analysis', { interaction: 'handoff', focus: 'workbench' })}
      >
        Scan loaded data <ChevronRight size={15} />
      </button>
    </div>
  );
}
