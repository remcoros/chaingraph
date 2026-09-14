import { ConnectionScanTargetToolbar } from './Selection/ConnectionScanTargetToolbar';
import { GitBranch, List, LoaderCircle, LockKeyhole, Wallet as WalletIcon } from 'lucide-react';
import { SelectionToolbar } from './Selection/SelectionToolbar';

import type { WorkspaceController } from './useWorkspace';
import { GraphWorkbench } from './Workbenches/Graph/GraphWorkbench';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { WalletWorkbench } from './Workbenches/Wallet/WalletWorkbench';
import { AnalysisWorkbench } from './Workbenches/Analysis/AnalysisWorkbench';

export function Workspace({ workspace }: { workspace: WorkspaceController }) {
  const {
    lookup,
    shownMobilePanel,
    setMobilePanel,
    shownRightTab,
    shownWorkbench,
    workbench,
    tourStep,
    activeWorkspace,
    history,
    annotations,
    setNotice,
    workspaces,
    connectionScanTargets,
    operationStatus: operation,
    operationRef,
  } = workspace;
  const { pendingWorkspaceId: pendingGraphWorkspace } = workspace.graphCanvas;
  const { batch: selection } = workspace.selection;
  const { selectionOnCanvas, matchingScope, graphFiltering, visibleGraph } =
    workspace.graphProjection;
  const { backgroundAddressHistoryLoad } = workspace.evidence;
  const { setEntityHidden, prepareIsolation, updateFilters } = workspace.graphActions;

  if (!activeWorkspace) return null;
  return (
    <>
      <WorkspaceToolbar workspace={workspace} />
      {lookup.error && (
        <div className="lookup-error" id="lookup-error" role="alert">
          {lookup.error}
        </div>
      )}
      <div className="mobile-switch" hidden={shownWorkbench !== 'graph'}>
        <button
          className={shownMobilePanel === 'left' ? 'active' : ''}
          onClick={() => setMobilePanel('left')}
        >
          <WalletIcon size={15} />
          Browse
        </button>
        <button
          className={shownMobilePanel === 'graph' ? 'active' : ''}
          onClick={() => setMobilePanel('graph')}
        >
          <GitBranch size={15} />
          Graph
        </button>
        <button
          className={shownMobilePanel === 'right' ? 'active' : ''}
          onClick={() => setMobilePanel('right')}
        >
          <List size={15} />
          {shownRightTab === 'scan'
            ? 'Scan'
            : shownRightTab === 'analysis'
              ? 'Inspector'
              : shownRightTab === 'addresses'
                ? 'Addresses'
                : shownRightTab === 'transactions'
                  ? 'Transactions'
                  : shownRightTab === 'utxos'
                    ? 'UTXOs'
                    : 'Inspector'}
        </button>
      </div>
      <GraphWorkbench workspace={workspace} />
      <WalletWorkbench workspace={workspace} />
      <AnalysisWorkbench workspace={workspace} />
      <SelectionToolbar
        active={workbench === 'graph' && !tourStep && !connectionScanTargets.picking}
        workspace={activeWorkspace}
        selection={selection}
        visibleSelectedCount={selectionOnCanvas}
        hiddenSelectedCount={selection.count - selectionOnCanvas}
        matching={matchingScope}
        matchingPending={graphFiltering}
        onApply={annotations.applyBatch}
        undoToken={history.token}
        undoDescription={history.undoDescription}
        onSetHidden={setEntityHidden}
        onIsolate={(ids) => {
          prepareIsolation(ids);
          updateFilters({ includeIds: ids, preserveContext: true });
          setMobilePanel('graph');
          setNotice(
            `Isolated ${ids.length.toLocaleString()} selected entities. The isolation chip restores the full canvas.`,
          );
        }}
        onUndo={() => history.undo()}
      />
      {connectionScanTargets.picking && connectionScanTargets.draft && (
        <ConnectionScanTargetToolbar
          ids={connectionScanTargets.draft.ids}
          onRemove={connectionScanTargets.toggle}
          onDone={() => connectionScanTargets.finish(true)}
          onCancel={() => connectionScanTargets.finish(false)}
          {...connectionScanTargets.preview}
        />
      )}
      <footer className="statusbar">
        <span>
          {operation ? (
            <>
              <LoaderCircle className="spin" size={13} />
              {operation}
              <button onClick={() => operationRef.current?.abort()}>Cancel</button>
            </>
          ) : backgroundAddressHistoryLoad ? (
            <>
              <LoaderCircle className="spin" size={13} />
              {backgroundAddressHistoryLoad.phase === 'history'
                ? 'Checking address history…'
                : backgroundAddressHistoryLoad.phase === 'details'
                  ? `Loading address history ${backgroundAddressHistoryLoad.done}/${backgroundAddressHistoryLoad.total}`
                  : 'Checking address balance…'}
            </>
          ) : (
            <>
              <span className="status-dot" />
              <span data-testid="graph-node-count">
                {visibleGraph.nodes.length.toLocaleString()}{' '}
                {visibleGraph.nodes.length === 1 ? 'node' : 'nodes'}
              </span>
              <span className="status-separator">/</span>
              {visibleGraph.links.length.toLocaleString()} connections
              <span className="status-separator">/</span>
              {Object.keys(activeWorkspace.transactions).length.toLocaleString()}{' '}
              {Object.keys(activeWorkspace.transactions).length === 1
                ? 'transaction'
                : 'transactions'}
            </>
          )}
        </span>
        <span className="save-status">
          <LockKeyhole size={12} />
          {workspaces.storageError
            ? 'Save failed'
            : pendingGraphWorkspace === activeWorkspace.id
              ? 'View pending'
              : workspaces.saving
                ? 'Encrypting…'
                : workspaces.active?.revision === workspaces.active?.savedRevision
                  ? 'Encrypted · saved'
                  : 'Unsaved changes'}
        </span>
      </footer>
    </>
  );
}
