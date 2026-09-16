import { useId, useRef, useState } from 'react';
import type { Workspace } from '../workspace';
import { decryptWorkspaceOffThread, WorkspaceOperationError } from '../Persistence/Encryption';
import { Modal } from '../../Dialogs/Modal';
import { focusDialogField, PasswordControls, PasswordField } from './PasswordControls';
import { useWorkspaceRead } from './useWorkspaceRead';

export function ImportWorkspaceDialog({
  file,
  onImport,
  onClose,
}: {
  file: File;
  onImport: (w: Workspace, password: string) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const passwordInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const read = useWorkspaceRead(onClose);
  return (
    <Modal title="Open encrypted workspace" onClose={read.close}>
      <p className="muted wrap">{file.name}</p>
      <PasswordControls
        label="Open encrypted workspace"
        disabled={busy}
        action={busy ? 'Decrypting…' : 'Open workspace'}
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
            const data = await decryptWorkspaceOffThread(file, password, signal);
            signal.throwIfAborted();
            onImport(data, password);
            onClose();
          } catch (error) {
            if (signal.aborted) return;
            setError(
              error instanceof WorkspaceOperationError
                ? error.message
                : 'Could not open this workspace. Check the password and file format.',
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
          <p id={errorId} role="alert" className="error-text">
            {error}
          </p>
        )}
      </PasswordControls>
    </Modal>
  );
}
