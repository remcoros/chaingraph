import { useState } from 'react';
import {
  ArrowUpRight,
  ChevronRight,
  FolderOpen,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Upload,
  Trash2,
} from 'lucide-react';
import type { SavedWorkspace, Session } from '../lib/useWorkspaces';
interface Props {
  saved: SavedWorkspace[];
  sessions: Session[];
  onCreate: () => void;
  onDemo: () => void;
  onOpenFile: () => void;
  onActivate: (id: string) => void;
  onUnlock: (entry: SavedWorkspace) => void;
  onDelete?: (entry: SavedWorkspace) => void;
}
export function WorkspaceHome({
  saved,
  sessions,
  onCreate,
  onDemo,
  onOpenFile,
  onActivate,
  onUnlock,
  onDelete,
}: Props) {
  const [filter, setFilter] = useState('');
  const shown = saved.filter((entry) =>
    (
      sessions.find((session) => session.data.id === entry.id)?.data.name ??
      entry.publicName ??
      'Encrypted workspace'
    )
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <main id="main-workspace" tabIndex={-1} className="welcome">
      <div className="welcome-copy">
        <span className="eyebrow">YOUR COINS. YOUR CONTEXT.</span>
        <h1>
          Follow the coins.
          <br />
          <span>Keep the context.</span>
        </h1>
        <p>
          A workspace for tracing Bitcoin activity, understanding your wallets, and making your own
          connections.
        </p>
        <div className="welcome-actions">
          <button className="primary" onClick={onCreate}>
            <Plus size={17} />
            New workspace
          </button>
          <button onClick={onOpenFile}>
            <Upload size={16} />
            Open file
          </button>
        </div>
        <button className="demo-link" onClick={onDemo}>
          Explore the CoinJoin laboratory <ArrowUpRight size={17} />
        </button>
        <p className="small muted">
          A synthetic graph with three 150-input / 150-output transactions.
        </p>
        <div className="welcome-trust">
          <LockKeyhole size={15} />
          <span>Encrypted workspaces</span>
          <span className="divider-dot">·</span>
          <span>Fully self-hosted</span>
        </div>
      </div>
      <div className="welcome-side">
        <div className="section-title">
          <h2>Saved in this browser</h2>
          <span>{saved.length}</span>
        </div>
        {saved.length > 1 && (
          <input
            className="saved-search"
            aria-label="Find saved workspace"
            placeholder="Find a workspace…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        )}
        {saved.length === 0 ? (
          <div className="saved-empty">
            <FolderOpen size={32} />
            <h3>Your next investigation starts here.</h3>
            <p>
              Wallets, graph paths, and annotations live together in a password-protected workspace.
            </p>
          </div>
        ) : (
          <div className="saved-list">
            {shown.map((entry, i) => (
              <div className="saved-entry" key={entry.id}>
                <button
                  className="saved-row"
                  onClick={() => {
                    const open = sessions.find((s) => s.data.id === entry.id);
                    if (open) onActivate(entry.id);
                    else onUnlock(entry);
                  }}
                >
                  <LockKeyhole size={19} />
                  <span>
                    <strong>
                      {sessions.find((s) => s.data.id === entry.id)?.data.name ??
                        entry.publicName ??
                        `Encrypted workspace ${saved.length - i}`}
                    </strong>
                    <small>{new Date(entry.savedAt).toLocaleString()}</small>
                    {sessions.find((session) => session.data.id === entry.id)?.data.description && (
                      <small className="workspace-description">
                        {sessions.find((session) => session.data.id === entry.id)?.data.description}
                      </small>
                    )}
                    {!entry.publicName &&
                      !sessions.some((session) => session.data.id === entry.id) && (
                        <small>Unlock once to reveal and save its public name.</small>
                      )}
                  </span>
                  <ChevronRight size={17} />
                </button>
                {onDelete && (
                  <button
                    className="icon-button saved-delete"
                    aria-label={`Delete saved workspace ${entry.publicName ?? saved.length - i}`}
                    title={
                      sessions.some((session) => session.data.id === entry.id)
                        ? 'Lock the workspace before deleting its saved copy'
                        : 'Delete saved browser copy'
                    }
                    disabled={sessions.some((session) => session.data.id === entry.id)}
                    onClick={() => onDelete(entry)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            {!shown.length && <p className="small muted">No saved workspaces match this name.</p>}
          </div>
        )}
        <div className="welcome-note">
          <ShieldCheck size={20} />
          <p>
            Connect to your own Bitcoin and Fulcrum nodes. Wallet discovery happens in your browser;
            your backend is a read-only bridge.
          </p>
        </div>
      </div>
    </main>
  );
}
