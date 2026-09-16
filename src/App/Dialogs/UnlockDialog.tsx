import { useId, useRef, useState } from 'react';
import { formatLocalTimestamp } from '../../Domain/Chain/transactionTime';
import { WorkspaceOperationError } from '../../Infra/Storage/workspaceOperationError';
import type { SavedWorkspace } from '../Workspace/useWorkspaces';
import { Modal } from './Modal';
import { focusDialogField, PasswordControls, PasswordField } from './PasswordControls';
import { useWorkspaceRead } from './useWorkspaceRead';

export function UnlockDialog({
  entry,
  onUnlock,
  onClose,
}: {
  entry: SavedWorkspace;
  onUnlock: (e: SavedWorkspace, p: string, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const passwordInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const read = useWorkspaceRead(onClose);
  return (
    <Modal title="Unlock workspace" onClose={read.close}>
      <p className="muted">Last saved: {formatLocalTimestamp(entry.savedAt) ?? 'Unknown'}</p>
      <PasswordControls
        label="Unlock workspace encryption"
        disabled={busy}
        action={busy ? 'Decrypting…' : 'Unlock workspace'}
        onConfirm={async () => {
          if (busy) return;
          if (!password) {
            setError('Enter your workspace password.');
            focusDialogField(passwordInput.current);
            return;
          }
          setError('');
          setBusy(true);
          const signal = read.start();
          try {
            await onUnlock(entry, password, signal);
            signal.throwIfAborted();
            onClose();
          } catch (error) {
            if (signal.aborted) return;
            setError(
              error instanceof WorkspaceOperationError
                ? error.message
                : 'Could not unlock. Check your password. If browser data was cleared or is unavailable, restore an exported workspace backup.',
            );
          }
          if (!signal.aborted) setBusy(false);
        }}
      >
        <PasswordField
          value={password}
          onChange={(value) => {
            setPassword(value);
            setError('');
          }}
          disabled={busy}
          autofocus
          inputRef={passwordInput}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
        />
        <p className="small muted">
          Workspaces lock on reload. Chaingraph never stores your password.
        </p>
        {error && (
          <p id={errorId} className="error-text" role="alert">
            {error}
          </p>
        )}
      </PasswordControls>
    </Modal>
  );
}
