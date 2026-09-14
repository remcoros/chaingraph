import './component-styles';
import { TransactionFetchShell } from './Workspace/useTransactionFetch';
import { ExamplesDialog } from './Examples/ExamplesDialog';
import { CopyButton } from '../Shared/Controls/CopyButton';
import { FolderOpen, Network as NetworkIcon, Plus, X } from 'lucide-react';
import {
  CreateDialog,
  ImportDialog,
  UnlockDialog,
  WalletDialog,
  WalletNameDialog,
  WorkspaceDetailsDialog,
  Modal,
} from './Dialogs';
import { emptyAnnotation } from './Workspace/Inspector/Inspector';
import { HelpMenu } from './Help/HelpMenu';
import { AboutDialog } from './Help/AboutDialog';
import { WorkspaceHome } from './FrontPage/WorkspaceHome';
import { GuidedTour } from './Help/GuidedTour';

import { WORKBENCH_TOUR } from './Help/steps';
import { WORKSPACE_TEMPLATES } from '../Domain/Workspace/workspaceTemplates';
import { MAX_ENCRYPTED_FILE_BYTES } from '../Infra/Storage/crypto';
import { importLabels } from '../Domain/Metadata/labels';

import { ADDRESS_DISPLAY_NOTICE } from './Workspace/workspaceNotices';
import { Workspace } from './Workspace/Workspace';
import { useAppState } from './useAppState';
import { useWorkspace } from './Workspace/useWorkspace';

export default function App() {
  const app = useAppState();
  const workspace = useWorkspace(app);
  const {
    workbench,
    w,
    activateWorkspace,
    pendingGraphWorkspace,
    ws,
    setCreate,
    workspaceTabs,
    status,
    connected,
    displayNetwork,
    setAboutOpen,
    statusError,
    setTour,
    discoveryError,
    networks,
    setExamplesOpen,
    fileInput,
    setUnlock,
    setDeleteEntry,
    settingsOpen,
    setSettingsOpen,
    change,
    examplesOpen,
    aboutOpen,
    statuses,
    setConnectionCheck,
    deleteEntry,
    setError,
    setNotice,
    error,
    notice,
    canQuery,
    queryDisabledReason,
    unsupportedNetwork,
    setFileDialog,
    labelsInput,
    entityRemoval,
    removalPlan,
    setEntityRemoval,
    applyEntityRemoval,
    create,
    openWorkspace,
    unlock,
    saveBeforeLeaving,
    editingWallet,
    lockingWorkspace,
    walletNameDialog,
    setWalletNameDialog,
    walletDialog,
    setSelectedWallet,
    setSelectedId,
    setRightTab,
    setMobilePanel,
    switchWorkbench,
    setWalletDialog,
    fileDialog,
    tour,
    tourSteps,
    needsTourExample,
    walletTourExample,
    fetchScope,
  } = workspace;
  return (
    <TransactionFetchShell scope={fetchScope}>
      <a
        className="skip-link"
        href={workbench === 'graph' || !w ? '#main-workspace' : `#${workbench}-workspace`}
      >
        Skip to workspace
      </a>
      <header className="topbar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (w) activateWorkspace(undefined);
          }}
          aria-label="Chaingraph home"
        >
          <NetworkIcon size={23} />
          <span>
            chaingraph<span className="wordmark-dot">.</span>
          </span>
        </a>
        <nav
          ref={workspaceTabs}
          className="workspace-tabs"
          data-tour="workspace-tabs"
          aria-label="Open workspaces"
        >
          <button
            aria-label="Workspaces"
            className={!w ? 'home-tab active' : 'home-tab'}
            onClick={() => activateWorkspace(undefined)}
          >
            <FolderOpen size={15} />
            <span>Workspaces</span>
          </button>
          {ws.sessions.map((s) => (
            <button
              className={`workspace-tab ${s.data.id === w?.id ? 'active' : ''}`}
              key={s.data.id}
              title={s.data.name}
              aria-current={s.data.id === w?.id ? 'page' : undefined}
              onClick={() => activateWorkspace(s.data.id)}
            >
              <span className="tab-network">{s.data.network === 'mainnet' ? 'M' : 'T'}</span>
              <span>{s.data.name}</span>
              {(s.revision !== s.savedRevision || pendingGraphWorkspace === s.data.id) && (
                <span aria-label="Unsaved changes" className="dirty-dot">
                  ●
                </span>
              )}
            </button>
          ))}
          <button
            className="icon-button"
            data-testid="new-workspace-button"
            aria-label="New workspace"
            title="New workspace"
            onClick={() => setCreate('empty')}
          >
            <Plus size={16} />
          </button>
        </nav>
        <button
          onClick={() => setAboutOpen('connection')}
          aria-label="Connection details"
          className={`connection connection-action ${connected ? 'online' : ''}`}
          title={status?.error || statusError || 'Your self-hosted backend'}
        >
          <span className="status-dot" />
          <span className="connection-text">
            {connected
              ? `${status?.network} · ${status?.height?.toLocaleString() ?? 'connected'}`
              : 'Offline'}
          </span>
          <span className="connection-network">{displayNetwork ?? 'Offline'}</span>
        </button>
        <HelpMenu
          actions={[
            {
              label: w ? 'Show guided tour' : 'Getting started',
              onSelect: () => (w ? setTour(WORKBENCH_TOUR[0].id) : setAboutOpen('guide')),
            },
            {
              label: 'Example workspaces',
              disabled: !!discoveryError || !networks?.length,
              onSelect: () => setExamplesOpen(true),
            },
            { label: 'About Chaingraph', onSelect: () => setAboutOpen('about') },
          ]}
        />
      </header>

      {!w ? (
        <WorkspaceHome
          saved={ws.saved}
          sessions={ws.sessions}
          onCreate={() => setCreate('empty')}
          networks={discoveryError ? undefined : networks}
          onTemplate={setCreate}
          onExamples={() => setExamplesOpen(true)}
          onOpenFile={() => fileInput.current?.click()}
          onActivate={activateWorkspace}
          onUnlock={setUnlock}
          onDelete={setDeleteEntry}
        />
      ) : (
        <Workspace workspace={workspace} />
      )}
      {w && settingsOpen && (
        <WorkspaceDetailsDialog
          key={w.id}
          workspace={w}
          onClose={() => setSettingsOpen(false)}
          onSave={(name, description) =>
            change(
              (c) =>
                c.name === name && c.description === description ? c : { ...c, name, description },
              true,
              'workspace-details',
            )
          }
        />
      )}
      {examplesOpen && (
        <ExamplesDialog
          networks={discoveryError ? undefined : networks}
          onClose={() => setExamplesOpen(false)}
          onTemplate={(id) => {
            setExamplesOpen(false);
            setCreate(id);
          }}
        />
      )}
      {aboutOpen && (
        <AboutDialog
          initialTab={aboutOpen}
          onClose={() => setAboutOpen(false)}
          onTour={w ? () => setTour(WORKBENCH_TOUR[0].id) : undefined}
          status={status}
          networks={networks}
          statuses={statuses}
          statusError={statusError}
          onReconnect={() => setConnectionCheck((value) => value + 1)}
        />
      )}
      {deleteEntry && (
        <Modal title="Delete saved workspace?" onClose={() => setDeleteEntry(undefined)}>
          <p>
            Delete <strong>{deleteEntry.publicName ?? 'this encrypted workspace'}</strong> from this
            browser? Keep an encrypted export if you may need it again. This deletion cannot be
            undone.
          </p>
          <div className="button-row">
            <button onClick={() => setDeleteEntry(undefined)}>Keep workspace</button>
            <button
              className="danger"
              onClick={() =>
                void ws
                  .removeSaved(deleteEntry.id)
                  .then(() => {
                    setDeleteEntry(undefined);
                    setNotice('Saved workspace deleted from this browser.');
                  })
                  .catch((error) => setError(error.message))
              }
            >
              Delete from this browser
            </button>
          </div>
        </Modal>
      )}
      {(error || ws.storageError || notice) && (
        <div
          className={`toast ${error || ws.storageError ? 'error' : ''}`}
          role={error || ws.storageError ? 'alert' : 'status'}
        >
          <span>{error || ws.storageError || notice}</span>
          {!error &&
            !ws.storageError &&
            notice === ADDRESS_DISPLAY_NOTICE &&
            w &&
            !w.view.showAddresses && (
              <button
                onClick={() => {
                  change((current) => ({
                    ...current,
                    view: { ...current.view, showAddresses: true },
                  }));
                  setNotice('');
                }}
              >
                Enable address display
              </button>
            )}
          {!ws.storageError && (
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => {
                setError('');
                setNotice('');
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {w && !w.demo && !canQuery && (
        <div
          className="connection-banner"
          role={unsupportedNetwork || discoveryError || (status && !connected) ? 'alert' : 'status'}
        >
          {queryDisabledReason} Saved data remains available for offline analysis.
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".chaingraph,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (file.size > MAX_ENCRYPTED_FILE_BYTES) setError('Workspace file is too large.');
            else setFileDialog(file);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={labelsInput}
        type="file"
        accept=".jsonl,.json,.txt"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !w) return;
          try {
            if (file.size > 5_000_000) throw new Error('Label file exceeds 5 MB.');
            const result = importLabels(await file.text());
            change((c) => {
              const annotations = { ...c.annotations };
              for (const [id, a] of Object.entries(result.annotations))
                annotations[id] = {
                  ...(annotations[id] ?? emptyAnnotation),
                  label: a.label,
                };
              return {
                ...c,
                annotations,
                wallets: c.wallets.map((wallet) => ({
                  ...wallet,
                  name: result.annotations[`xpub:${wallet.key}`]?.label.trim() || wallet.name,
                })),
              };
            });
            setNotice(
              `Imported ${Object.keys(result.annotations).length} labels. ${result.skipped} records skipped (unsupported type or no label).`,
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Label import failed.');
          }
        }}
      />
      {entityRemoval && removalPlan && (
        <Modal
          title={
            removalPlan.kind === 'transaction' ? 'Remove transaction?' : 'Stop watching address?'
          }
          onClose={() => setEntityRemoval(undefined)}
        >
          <p>{removalPlan.title}</p>
          <div className="selection-facts">
            <span>{removalPlan.kind === 'transaction' ? 'Transaction ID' : 'Address'}</span>
            <code className="mono wrap" style={{ userSelect: 'all', display: 'block' }}>
              {removalPlan.nodeId.slice(removalPlan.kind === 'transaction' ? 3 : 5)}
            </code>
            <CopyButton
              value={removalPlan.nodeId.slice(removalPlan.kind === 'transaction' ? 3 : 5)}
              label={
                removalPlan.kind === 'transaction'
                  ? 'Copy transaction ID to remove'
                  : 'Copy address to stop watching'
              }
            />
          </div>
          <p>
            {removalPlan.kind === 'transaction'
              ? 'Remove the cached transaction and its transaction/output annotations and tag memberships from this workspace. Unused input context is removed too; shared, independently added or annotated context is retained. Outputs referenced by retained transactions may remain as placeholders.'
              : 'Stop watching this address and clear its annotation and tag memberships. Loaded transaction data remains in the workspace.'}
          </p>
          <p>
            This removes {removalPlan.annotationCount} annotated{' '}
            {removalPlan.annotationCount === 1 ? 'entity' : 'entities'} and{' '}
            {removalPlan.tagMembershipCount} tag{' '}
            {removalPlan.tagMembershipCount === 1 ? 'membership' : 'memberships'}. Tag definitions
            remain. Undo can restore this change during the current session.
          </p>
          <div className="button-row">
            <button onClick={() => setEntityRemoval(undefined)}>Keep in workspace</button>
            <button
              className="danger"
              onClick={() => applyEntityRemoval(entityRemoval.workspaceId, entityRemoval.nodeId)}
            >
              {removalPlan.kind === 'transaction' ? 'Remove transaction' : 'Stop watching address'}
            </button>
          </div>
        </Modal>
      )}
      {create && (
        <CreateDialog
          networks={discoveryError ? undefined : networks}
          key={create}
          template={WORKSPACE_TEMPLATES.find((template) => template.id === create)}
          onCreate={openWorkspace}
          onClose={() => setCreate(undefined)}
        />
      )}
      {unlock && (
        <UnlockDialog
          entry={unlock}
          onUnlock={async (entry, password, signal) => {
            await saveBeforeLeaving();
            signal.throwIfAborted();
            const current = ws.getSaved(entry.id);
            if (!current) throw new Error('Saved workspace changed; reload before unlocking.');
            return ws.unlock(current, password, signal);
          }}
          onClose={() => setUnlock(undefined)}
        />
      )}
      {w && editingWallet && !lockingWorkspace && (
        <WalletNameDialog
          key={`${w.id}:${editingWallet.id}`}
          wallet={editingWallet}
          onChange={(name) =>
            change(
              (current) => {
                const target = current.wallets.find((item) => item.id === editingWallet.id);
                if (current.id !== walletNameDialog?.workspaceId || !target || target.name === name)
                  return current;
                return {
                  ...current,
                  wallets: current.wallets.map((item) =>
                    item.id === target.id ? { ...item, name } : item,
                  ),
                };
              },
              true,
              `wallet-name:${editingWallet.id}`,
            )
          }
          onClose={() => setWalletNameDialog(undefined)}
        />
      )}
      {walletDialog && w && (
        <WalletDialog
          network={w.network}
          onAdd={(newWallet) => {
            if (
              w.wallets.some(
                (x) => x.key === newWallet.key && x.scriptType === newWallet.scriptType,
              )
            ) {
              setError('That wallet is already in this workspace.');
              return;
            }
            change((c) => ({ ...c, wallets: [...c.wallets, newWallet] }));
            setSelectedWallet(newWallet.id);
            setSelectedId(undefined);
            setRightTab('inspect');
            setMobilePanel('right');
            switchWorkbench('wallet', true);
          }}
          onClose={() => setWalletDialog(false)}
        />
      )}
      {fileDialog && (
        <ImportDialog
          file={fileDialog}
          onImport={(data, password) => {
            const existing =
              ws.sessions.find((s) => s.data.id === data.id) ||
              ws.saved.find((s) => s.id === data.id);
            if (existing)
              data = {
                ...data,
                id: crypto.randomUUID(),
                name: `${data.name.slice(0, 93)} (copy)`,
              };
            openWorkspace(data, password);
          }}
          onClose={() => setFileDialog(undefined)}
        />
      )}
      {tour !== undefined && !!w && (
        <GuidedTour
          steps={tourSteps}
          activeId={tour}
          onStepChange={setTour}
          previewLabel={needsTourExample ? 'Public example · preview only (mainnet)' : undefined}
          previewStatus={
            needsTourExample
              ? {
                  loading: walletTourExample.loading,
                  error: walletTourExample.error,
                  onRetry: walletTourExample.retry,
                }
              : undefined
          }
        />
      )}
    </TransactionFetchShell>
  );
}
