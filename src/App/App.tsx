import './component-styles';
import { TransactionFetchShell } from './Workspace/ChainData/TransactionFetch';
import { ExamplesDialog } from './Examples/ExamplesDialog';
import { BookOpen, FolderOpen, Info, Library, Plus, X } from 'lucide-react';
import { CreateDialog, ImportDialog, UnlockDialog, Modal } from './Dialogs';
import { HelpMenu } from './Help/HelpMenu';
import { AboutDialog } from './Help/AboutDialog';
import { WorkspaceHome } from './FrontPage/WorkspaceHome';

import { WORKSPACE_TEMPLATES } from '../Domain/Workspace/workspaceTemplates';
import { MAX_ENCRYPTED_FILE_BYTES } from '../Infra/Storage/crypto';

import { ADDRESS_DISPLAY_NOTICE } from './Workspace/workspaceNotices';
import { Workspace } from './Workspace/Workspace';
import { useAppState } from './useAppState';
import { useWorkspace } from './Workspace/useWorkspace';
import {
  EntityRemovalDialog,
  WalletDialogs,
  WorkspaceLabelImport,
  WorkspaceSettingsDialog,
} from './Workspace/WorkspaceDialogs';
import { WorkspaceTour } from './Help/WorkspaceTour';

export default function App() {
  const app = useAppState();
  const workspace = useWorkspace(app);
  const { activeWorkspace, workspaces, fileInput, workspaceTabs } = app;
  return (
    <TransactionFetchShell scope={app.fetchScope}>
      <a
        className="skip-link"
        href={
          workspace.workbench === 'graph' || !activeWorkspace
            ? '#main-workspace'
            : `#${workspace.workbench}-workspace`
        }
      >
        Skip to workspace
      </a>
      <header className="topbar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (activeWorkspace) app.activateWorkspace(undefined);
          }}
          aria-label="Chaingraph home"
        >
          <img className="wordmark-icon" src="/favicon.svg" alt="" />
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
            className={!activeWorkspace ? 'home-tab active' : 'home-tab'}
            onClick={() => app.activateWorkspace(undefined)}
          >
            <FolderOpen size={15} />
            <span>Workspaces</span>
          </button>
          {workspaces.unlocked.map((s) => (
            <button
              className={`workspace-tab ${s.data.id === activeWorkspace?.id ? 'active' : ''}`}
              key={s.data.id}
              title={s.data.name}
              aria-current={s.data.id === activeWorkspace?.id ? 'page' : undefined}
              onClick={() => app.activateWorkspace(s.data.id)}
            >
              <span className="tab-network">{s.data.network === 'mainnet' ? 'M' : 'T'}</span>
              <span>{s.data.name}</span>
              {(s.revision !== s.savedRevision || app.pendingGraphWorkspace === s.data.id) && (
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
            onClick={() => app.setCreate('empty')}
          >
            <Plus size={16} />
          </button>
        </nav>
        <button
          onClick={() => app.setAboutOpen('connection')}
          aria-label="Connection details"
          className={`connection connection-action ${app.connected ? 'online' : ''}`}
          title={app.status?.error || app.statusError || 'Your self-hosted backend'}
        >
          <span className="status-dot" />
          <span className="connection-text">
            {app.connected
              ? `${app.status?.network} · ${app.status?.height?.toLocaleString() ?? 'connected'}`
              : 'Offline'}
          </span>
          <span className="connection-network">{app.displayNetwork ?? 'Offline'}</span>
        </button>
        <HelpMenu
          actions={[
            {
              label: activeWorkspace ? 'Show guided tour' : 'Getting started',
              icon: <BookOpen size={15} aria-hidden="true" />,
              onSelect: () =>
                activeWorkspace ? workspace.tour.start() : app.setAboutOpen('guide'),
            },
            {
              label: 'Example workspaces',
              icon: <Library size={15} aria-hidden="true" />,
              disabled: !!app.discoveryError || !app.networks?.length,
              onSelect: () => app.setExamplesOpen(true),
            },
            {
              label: 'About Chaingraph',
              icon: <Info size={15} aria-hidden="true" />,
              onSelect: () => app.setAboutOpen('about'),
            },
          ]}
        />
      </header>

      {!activeWorkspace ? (
        <WorkspaceHome
          saved={workspaces.saved}
          sessions={workspaces.unlocked}
          onCreate={() => app.setCreate('empty')}
          networks={app.discoveryError ? undefined : app.networks}
          onTemplate={app.setCreate}
          onExamples={() => app.setExamplesOpen(true)}
          onOpenFile={() => fileInput.current?.click()}
          onActivate={app.activateWorkspace}
          onUnlock={app.setUnlock}
          onDelete={app.setDeleteEntry}
        />
      ) : (
        <Workspace workspace={workspace} />
      )}
      <WorkspaceSettingsDialog workspace={workspace} />
      {app.examplesOpen && (
        <ExamplesDialog
          networks={app.discoveryError ? undefined : app.networks}
          onClose={() => app.setExamplesOpen(false)}
          onTemplate={(id) => {
            app.setExamplesOpen(false);
            app.setCreate(id);
          }}
        />
      )}
      {app.aboutOpen && (
        <AboutDialog
          initialTab={app.aboutOpen}
          onClose={() => app.setAboutOpen(false)}
          onTour={activeWorkspace ? () => workspace.tour.start() : undefined}
          status={app.status}
          networks={app.networks}
          statuses={app.statuses}
          statusError={app.statusError}
          onReconnect={() => app.setConnectionCheck((value) => value + 1)}
        />
      )}
      {app.deleteEntry && (
        <Modal title="Delete saved workspace?" onClose={() => app.setDeleteEntry(undefined)}>
          <p>
            Delete <strong>{app.deleteEntry.publicName ?? 'this encrypted workspace'}</strong> from
            this browser? Keep an encrypted export if you may need it again. This deletion cannot be
            undone.
          </p>
          <div className="button-row">
            <button onClick={() => app.setDeleteEntry(undefined)}>Keep workspace</button>
            <button
              className="danger"
              onClick={() =>
                void workspaces
                  .removeSaved(app.deleteEntry!.id)
                  .then(() => {
                    app.setDeleteEntry(undefined);
                    app.setNotice('Saved workspace deleted from this browser.');
                  })
                  .catch((error) => app.setError(error.message))
              }
            >
              Delete from this browser
            </button>
          </div>
        </Modal>
      )}
      {(app.error || workspaces.storageError || app.notice) && (
        <div
          className={`toast ${app.error || workspaces.storageError ? 'error' : ''}`}
          role={app.error || workspaces.storageError ? 'alert' : 'status'}
        >
          <span>{app.error || workspaces.storageError || app.notice}</span>
          {!app.error &&
            !workspaces.storageError &&
            app.notice === ADDRESS_DISPLAY_NOTICE &&
            activeWorkspace &&
            !activeWorkspace.view.showAddresses && (
              <button
                onClick={() => {
                  workspace.edit((current) => ({
                    ...current,
                    view: { ...current.view, showAddresses: true },
                  }));
                  app.setNotice('');
                }}
              >
                Enable address display
              </button>
            )}
          {!workspaces.storageError && (
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => {
                app.setError('');
                app.setNotice('');
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {activeWorkspace && !activeWorkspace.demo && !workspace.canLoadChainData && (
        <div
          className="connection-banner"
          role={
            app.unsupportedNetwork || app.discoveryError || (app.status && !app.connected)
              ? 'alert'
              : 'status'
          }
        >
          {workspace.chainDataDisabledReason} Saved data remains available for offline analysis.
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
            if (file.size > MAX_ENCRYPTED_FILE_BYTES) app.setError('Workspace file is too large.');
            else app.setFileDialog(file);
          }
          e.target.value = '';
        }}
      />
      <WorkspaceLabelImport workspace={workspace} />
      <EntityRemovalDialog workspace={workspace} />
      {app.create && (
        <CreateDialog
          networks={app.discoveryError ? undefined : app.networks}
          key={app.create}
          template={WORKSPACE_TEMPLATES.find((template) => template.id === app.create)}
          onCreate={app.openWorkspace}
          onClose={() => app.setCreate(undefined)}
        />
      )}
      {app.unlock && (
        <UnlockDialog
          entry={app.unlock}
          onUnlock={async (entry, password, signal) => {
            await app.saveBeforeLeaving();
            signal.throwIfAborted();
            const current = workspaces.getSaved(entry.id);
            if (!current) throw new Error('Saved workspace changed; reload before unlocking.');
            return workspaces.unlock(current, password, signal);
          }}
          onClose={() => app.setUnlock(undefined)}
        />
      )}
      <WalletDialogs workspace={workspace} />
      {app.fileDialog && (
        <ImportDialog
          file={app.fileDialog}
          onImport={(data, password) => {
            const existing =
              workspaces.unlocked.find((s) => s.data.id === data.id) ||
              workspaces.saved.find((s) => s.id === data.id);
            if (existing)
              data = {
                ...data,
                id: crypto.randomUUID(),
                name: `${data.name.slice(0, 93)} (copy)`,
              };
            app.openWorkspace(data, password);
          }}
          onClose={() => app.setFileDialog(undefined)}
        />
      )}
      <WorkspaceTour workspace={workspace} />
    </TransactionFetchShell>
  );
}
