import { ScanTargetToolbar } from './Workbenches/Graph/ConnectionScan/ScanTargetToolbar';
import { GitBranch, List, LoaderCircle, LockKeyhole, Wallet as WalletIcon } from 'lucide-react';
import { SelectionToolbar } from './Selection/SelectionToolbar';

import type { WorkspaceController } from './useWorkspace';
import { GraphWorkbench } from './Workbenches/GraphWorkbench';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { WalletWorkbench } from './Workbenches/WalletWorkbench';
import { AnalysisWorkbench } from './Workbenches/AnalysisWorkbench';

export function Workspace({ workspace }: { workspace: WorkspaceController }) {
  const {
    queryError,
    shownMobilePanel,
    setMobilePanel,
    shownRightTab,
    shownWorkbench,
    workbench,
    tourStep,
    pickingScanTargets,
    w,
    selection,
    selectionOnCanvas,
    matchingScope,
    graphFiltering,
    applyBatch,
    undoToken,
    undoDescription,
    setNotice,
    ws,
    scanTargetDraft,
    toggleScanTarget,
    finishScanTargetPicking,
    scanTargetPreview,
    visibleGraph,
    backgroundAddressHistoryLoad,
    operation,
    operationRef,
    pendingGraphWorkspace,
  } = workspace;
  const { setEntityHidden, prepareIsolation, updateFilters } = workspace.graphActions;

  if (!w) return null;
  return (
    <>
      <WorkspaceToolbar workspace={workspace} />
      {queryError && (
        <div className="lookup-error" id="lookup-error" role="alert">
          {queryError}
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
        active={workbench === 'graph' && !tourStep && !pickingScanTargets}
        workspace={w}
        selection={selection}
        visibleSelectedCount={selectionOnCanvas}
        hiddenSelectedCount={selection.count - selectionOnCanvas}
        matching={matchingScope}
        matchingPending={graphFiltering}
        onApply={applyBatch}
        undoToken={undoToken}
        undoDescription={undoDescription}
        onSetHidden={setEntityHidden}
        onIsolate={(ids) => {
          prepareIsolation(ids);
          updateFilters({ includeIds: ids, preserveContext: true });
          setMobilePanel('graph');
          setNotice(
            `Isolated ${ids.length.toLocaleString()} selected entities. The isolation chip restores the full canvas.`,
          );
        }}
        onUndo={() => ws.undo(w.id)}
      />
      {pickingScanTargets && scanTargetDraft && (
        <ScanTargetToolbar
          ids={scanTargetDraft.ids}
          onRemove={toggleScanTarget}
          onDone={() => finishScanTargetPicking(true)}
          onCancel={() => finishScanTargetPicking(false)}
          {...scanTargetPreview}
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
              {Object.keys(w.transactions).length.toLocaleString()}{' '}
              {Object.keys(w.transactions).length === 1 ? 'transaction' : 'transactions'}
            </>
          )}
        </span>
        <span className="save-status">
          <LockKeyhole size={12} />
          {ws.storageError
            ? 'Save failed'
            : pendingGraphWorkspace === w.id
              ? 'View pending'
              : ws.saving
                ? 'Encrypting…'
                : ws.active?.revision === ws.active?.savedRevision
                  ? 'Encrypted · saved'
                  : 'Unsaved changes'}
        </span>
      </footer>
    </>
  );
}
