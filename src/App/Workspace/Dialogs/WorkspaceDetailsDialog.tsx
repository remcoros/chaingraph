import { useState } from 'react';
import type { Workspace } from '../../../Core/Workspace/workspace';
import { Modal } from '../../Dialogs/Modal';

export function WorkspaceDetailsDialog({
  workspace,
  onSave,
  onClose,
}: {
  workspace: Workspace;
  onSave: (name: string, description: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  return (
    <Modal title="Workspace details" onClose={onClose}>
      <div className="stack">
        <label>
          Name (public)
          <input
            required
            maxLength={100}
            value={name}
            aria-invalid={!name.trim()}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) onSave(e.target.value.trim(), workspace.description ?? '');
            }}
          />
        </label>
        <p className="small muted">Visible even while locked. Changes save automatically.</p>
        {!name.trim() && (
          <p role="alert">A name is required. The previous name is kept until you enter one.</p>
        )}
        <label>
          Description (encrypted, optional)
          <textarea
            aria-label="Workspace description"
            maxLength={10000}
            rows={4}
            value={workspace.description ?? ''}
            onChange={(e) => onSave(workspace.name, e.target.value)}
          />
        </label>
        <button className="primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
