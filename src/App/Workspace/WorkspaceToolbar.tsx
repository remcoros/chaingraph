import { LookupForm } from './Entities/LookupForm';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Ellipsis,
  GitBranch,
  LockKeyhole,
  Search,
  Upload,
  Wallet as WalletIcon,
  Undo2,
  Redo2,
} from 'lucide-react';
import { WORKBENCH_LABELS } from './workbenchTypes';
import type { WorkspaceController } from './useWorkspace';

export function WorkspaceToolbar({ workspace }: { workspace: WorkspaceController }) {
  const {
    shownWorkbench,
    switchWorkbench,
    tourStep,
    returnWorkbench,
    workbench,
    lookup,
    activeWorkspace,
    canLoadChainData,
    operationStatus: operation,
    prefetchDepth,
    setPrefetchDepth,
    history,
    workspaces,
    exportWorkspace,
    dialogs,
    annotations,
    operationRef,
    setLockingWorkspace,
    setError,
  } = workspace;
  const { flushActive: flushActiveGraph } = workspace.graphCanvas;
  const { addQuery } = workspace.evidence;
  const workspaceMenu = useRef<HTMLDivElement>(null);
  const workspaceMenuTrigger = useRef<HTMLButtonElement>(null);
  // Scoped to its workspace, so switching or locking one closes the menu.
  const [menuFor, setMenuFor] = useState<string>();
  const menu = !!activeWorkspace && menuFor === activeWorkspace.id;
  const workspaceIdForMenu = activeWorkspace?.id;
  const setMenu = useCallback(
    (next: boolean) => setMenuFor(next ? workspaceIdForMenu : undefined),
    [workspaceIdForMenu],
  );
  useEffect(() => {
    if (!menu) return;
    const items = () =>
      [
        ...(workspaceMenu.current?.querySelectorAll<HTMLButtonElement>(
          '.dropdown button:not(:disabled)',
        ) ?? []),
      ].filter((item) => item.offsetParent !== null);
    items()[0]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!workspaceMenu.current?.contains(event.target as Node)) setMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(false);
        workspaceMenuTrigger.current?.focus({ preventScroll: true });
      }
      const buttons = items();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % buttons.length
          : event.key === 'ArrowUp'
            ? (index - 1 + buttons.length) % buttons.length
            : undefined;
      if (next !== undefined) {
        event.preventDefault();
        buttons[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [menu, setMenu, workspaceMenu, workspaceMenuTrigger]);
  if (!activeWorkspace) return null;
  return (
    <div className={`workbench-toolbar mode-${shownWorkbench}`}>
      <nav className="workbench-nav" aria-label="Workbench">
        {(['wallet', 'graph', 'analysis'] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={shownWorkbench === mode}
            className={shownWorkbench === mode ? 'active' : ''}
            onClick={() => switchWorkbench(mode)}
          >
            {mode === 'wallet' ? (
              <WalletIcon size={15} />
            ) : mode === 'graph' ? (
              <GitBranch size={15} />
            ) : (
              <Search size={15} />
            )}
            {WORKBENCH_LABELS[mode]}
          </button>
        ))}
        {!tourStep && returnWorkbench && returnWorkbench !== workbench && (
          <button
            className="workbench-return"
            onClick={() => switchWorkbench(returnWorkbench, true)}
          >
            <ArrowLeft size={14} />
            Back to {WORKBENCH_LABELS[returnWorkbench]}
          </button>
        )}
      </nav>
      <div className="lookup-controls" data-tour="chain-lookup">
        <LookupForm
          inputRef={lookup.inputRef}
          network={activeWorkspace.network}
          canLoadChainData={canLoadChainData}
          busy={!!operation}
          resetToken={lookup.resetToken}
          queryError={lookup.error}
          onQueryError={lookup.setError}
          resolveLoaded={lookup.resolveLoaded}
          onSubmit={addQuery}
        />
        {!activeWorkspace.demo && (
          <label
            className="lookup-prefetch"
            title="Previous transaction levels for transaction/output lookups. Up to 500 downloads per action."
          >
            <span>Previous levels</span>
            <select
              aria-label="Prefetch previous levels"
              value={prefetchDepth}
              onChange={(e) => setPrefetchDepth(Number(e.target.value) as 0 | 1 | 2)}
            >
              <option value={0}>Previous: off</option>
              <option value={1}>Previous: 1</option>
              <option value={2}>Previous: 2</option>
            </select>
          </label>
        )}
      </div>
      <div className="workspace-actions" data-tour="workspace-actions">
        <button
          className="icon-button workspace-undo"
          aria-label={history.undoLabel}
          title={history.undoLabel}
          disabled={!history.canUndo || !!operation}
          onClick={history.undo}
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button workspace-redo"
          aria-label={history.redoLabel}
          title={history.redoLabel}
          disabled={!history.canRedo || !!operation}
          onClick={history.redo}
        >
          <Redo2 size={17} />
        </button>
        <button
          className="export-button"
          title="Export encrypted workspace backup"
          aria-label="Export encrypted workspace backup"
          onClick={() => void exportWorkspace()}
          disabled={!!operation}
        >
          <Download size={16} />
          <span>Export workspace</span>
        </button>
        <div
          className="workspace-menu"
          ref={workspaceMenu}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false);
          }}
        >
          <button
            ref={workspaceMenuTrigger}
            className="icon-button"
            aria-label="Workspace menu"
            aria-expanded={menu}
            aria-controls={menu ? 'workspace-menu-actions' : undefined}
            onClick={() => setMenu(!menu)}
          >
            <Ellipsis size={20} />
          </button>
          {menu && (
            <div
              className="dropdown"
              id="workspace-menu-actions"
              role="group"
              aria-label="Workspace actions"
            >
              <button
                className="mobile-workspace-undo"
                aria-label={history.undoLabel}
                title={history.undoLabel}
                disabled={!history.canUndo || !!operation}
                onClick={() => {
                  setMenu(false);
                  history.undo();
                }}
              >
                <Undo2 size={15} /> Undo
              </button>
              <button
                className="mobile-workspace-redo"
                aria-label={history.redoLabel}
                title={history.redoLabel}
                disabled={!history.canRedo || !!operation}
                onClick={() => {
                  setMenu(false);
                  history.redo();
                }}
              >
                <Redo2 size={15} /> Redo
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  dialogs.openSettings();
                }}
              >
                Workspace details
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  void exportWorkspace();
                }}
              >
                <Download size={15} />
                Export encrypted workspace
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  annotations.chooseLabelFile();
                }}
              >
                <Upload size={15} />
                Import BIP329 labels
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  annotations.exportLabels();
                }}
              >
                <Download size={15} />
                Export BIP329 labels · plaintext
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  operationRef.current?.abort();
                  flushActiveGraph();
                  setLockingWorkspace(true);
                  void workspaces.active
                    ?.lock()
                    .catch((e) => setError(e.message))
                    .finally(() => setLockingWorkspace(false));
                }}
              >
                <LockKeyhole size={15} />
                Lock workspace
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
