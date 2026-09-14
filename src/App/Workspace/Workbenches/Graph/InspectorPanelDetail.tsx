import { SelectedTags } from '../../Tags/TagsPanel';
import { ChevronRight, Eye } from 'lucide-react';
import { NodeInspector, WalletInspector } from '../../Inspector/Inspector';
import { pruneWalletReviews } from '../../../../Domain/Wallet/walletReview';
import type { WorkspaceController } from '../../useWorkspace';

export function InspectorPanelDetail({ workspace }: { workspace: WorkspaceController }) {
  const {
    w,
    switchWorkbench,
    walletUtxoObservation,
    setNotice,
    setNoticeSequence,
    operationRef,
    setRightTab,
    setMobilePanel,
    annotations,
    setLeftTab,
    tx,
    operation,
    canTrace,
    queryDisabledReason,
    entityRemoval,
    change,
    wallet,
    canQuery,
    walletDiscovery,
    dialogs,
    tourStep,
    shownRightTab,
  } = workspace;
  const {
    invalidate: invalidateSelection,
    setSelectedWallet,
    setSelectedId,
    select,
  } = workspace.selection;
  const { selected, walletMatches, graph } = workspace.graphProjection;
  const { addressBalance, expand, getTransaction, mergeTransactions, run, refreshAddressBalance } =
    workspace.evidence;
  const { revealGraphNodes, centerNode, setEntityHidden, updateFilters } = workspace.graphActions;
  const { showWalletActivity } = workspace.walletActions;

  if (!w) return null;
  return shownRightTab === 'scan' ||
    shownRightTab === 'addresses' ||
    shownRightTab === 'transactions' ||
    shownRightTab === 'utxos' ? null : wallet &&
    !selected &&
    tourStep?.view?.rightTab !== 'inspect' ? (
    <WalletInspector
      key={`wallet-inspector:${w.id}:${wallet.id}`}
      wallet={wallet}
      workspace={w}
      busy={!!operation}
      canQuery={canQuery}
      onScan={() => void walletDiscovery.run(wallet)}
      onShowActivity={() => showWalletActivity(wallet)}
      onEdit={() => dialogs.openWalletRename(w.id, wallet.id)}
      onShowWallet={() => {
        updateFilters({ walletId: wallet.id, preserveContext: true });
        setMobilePanel('graph');
      }}
      onRemove={() => {
        change((c) =>
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
        operationRef.current?.abort();
        setSelectedWallet(id);
        setSelectedId(undefined);
        setRightTab('inspect');
        setMobilePanel('right');
      }}
      tagsPanel={
        <SelectedTags
          key={selected.id}
          workspace={w}
          selected={selected}
          openToken={annotations.edit.target === 'tags' ? annotations.edit.token : 0}
          onOpenHandled={annotations.edit.acknowledge}
          onChange={annotations.changeTags}
          onManage={() => {
            setLeftTab('tags');
            setMobilePanel('left');
          }}
        />
      }
      w={w}
      selected={selected}
      tx={tx}
      graph={graph}
      busy={!!operation}
      canQuery={canTrace}
      queryDisabledReason={queryDisabledReason}
      editToken={annotations.edit.target === 'tags' ? undefined : annotations.edit.token}
      editTarget={annotations.edit.target === 'icon' ? 'icon' : 'label'}
      onEditHandled={annotations.edit.acknowledge}
      onSelectNode={(id) => {
        if (id.startsWith('addr:')) revealGraphNodes([id]);
        select(id);
      }}
      onCenter={() => centerNode()}
      onShowAndCenter={() => centerNode(selected.id, undefined, true)}
      hiddenNodeIds={w.view.hiddenNodeIds}
      graphNodeIds={w.view.graphNodeIds}
      onSetHidden={setEntityHidden}
      annotationKey={`${w.id}:${selected.id}`}
      onExpand={(direction) => void expand(direction)}
      onRefresh={() =>
        void run(async (signal) => {
          const transaction = await getTransaction(selected.txid!, signal);
          signal.throwIfAborted();
          mergeTransactions(w.id, [transaction]);
        })
      }
      onRefreshAddressBalance={refreshAddressBalance}
      canRemove={!!entityRemoval.selectedPlan}
      onRemove={() => entityRemoval.request()}
      onSave={(annotation, group) => {
        const previous = w.annotations[selected.id] ?? {
          label: '',
          note: '',
          icon: '',
          bookmarked: false,
        };
        const field =
          (Object.keys(annotation) as (keyof typeof annotation)[]).find(
            (key) => annotation[key] !== previous?.[key],
          ) ?? 'label';
        change(
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
      {w.description && <p className="workspace-description">{w.description}</p>}
      <p>
        Select a node in the graph or an item in Entities to inspect it, add labels and notes, and
        follow its paths.
      </p>
      <button className="text-button" onClick={() => switchWorkbench('analysis')}>
        Scan loaded data <ChevronRight size={15} />
      </button>
    </div>
  );
}
