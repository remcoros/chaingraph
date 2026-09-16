import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import type { Network, Workspace } from '../../Domain/types';
import { newWorkspace } from '../../Domain/Workspace/workspace';
import type { WorkspaceTemplate } from '../../Domain/Workspace/workspaceTemplates';
import { loadTemplateWorkspace } from '../Examples/templateWorkspace';
import { Modal } from './Modal';
import { focusDialogField, PasswordControls, PasswordField } from './PasswordControls';

export function CreateDialog({
  networks,
  template,
  onCreate,
  onClose,
}: {
  networks?: Network[];
  template?: WorkspaceTemplate;
  onCreate: (w: Workspace, p: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template?.name ?? 'My investigation');
  const suggestedName = useRef(true);
  const [description, setDescription] = useState(template?.description ?? '');
  const [net, setNet] = useState<Network | undefined>(template?.network ?? networks?.[0]);
  const selectedNet = template?.network ?? (net && networks?.includes(net) ? net : networks?.[0]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<'name' | 'password' | 'confirm'>();
  const errorId = useId();
  const passwordHintId = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function clearFieldError(field: 'name' | 'password' | 'confirm') {
    if (invalidField === field || (field === 'password' && invalidField === 'confirm')) {
      setInvalidField(undefined);
      setError('');
    }
  }
  const pending = useRef<AbortController | undefined>(undefined);
  const supported = useRef(networks);
  useLayoutEffect(() => {
    supported.current = networks;
  }, [networks]);
  const close = () => {
    pending.current?.abort();
    onClose();
  };
  useEffect(() => () => pending.current?.abort(), []);
  async function submit() {
    if (pending.current) return;
    if (!name.trim()) {
      setInvalidField('name');
      focusDialogField(nameInput.current);
      setError('Enter a workspace name.');
      return;
    }
    if (password.length < 8) {
      setInvalidField('password');
      focusDialogField(passwordInput.current);
      setError('Use at least 8 characters. A long, unique passphrase is better.');
      return;
    }
    if (password !== confirm) {
      setInvalidField('confirm');
      focusDialogField(confirmInput.current);
      setError('Passwords do not match.');
      return;
    }
    setInvalidField(undefined);
    if (!crypto.subtle) {
      setError('Encryption needs a secure browser context. Use localhost or HTTPS.');
      return;
    }
    if (!selectedNet || !networks?.includes(selectedNet)) {
      setError('Cannot discover supported networks. Check the backend connection.');
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const w = template
        ? await loadTemplateWorkspace(
            template.id,
            name.trim(),
            description.trim(),
            controller.signal,
          )
        : { ...newWorkspace(name.trim(), selectedNet), description: description.trim() };
      controller.signal.throwIfAborted();
      if (!supported.current?.includes(w.network))
        setError(`Backend does not support ${w.network}. Check the backend connection.`);
      else {
        onCreate(w, password);
        onClose();
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not create the workspace. Please try again.',
        );
    }
    if (!controller.signal.aborted) {
      pending.current = undefined;
      setBusy(false);
    }
  }
  return (
    <Modal title="Create a workspace" onClose={close} fallbackFocusSelector=".help-menu > button">
      <p className="muted">
        {template
          ? 'Start with real transactions, labels and tags. This is your own editable copy, saved like any other workspace.'
          : 'A private space for your wallets, transactions, labels, and investigations.'}
      </p>
      <PasswordControls
        label="Create workspace encryption"
        onConfirm={submit}
        disabled={busy || !selectedNet || !networks?.includes(selectedNet)}
        action={
          <>
            {busy ? 'Preparing workspace…' : 'Create workspace'} <ArrowRight size={16} />
          </>
        }
      >
        <label>
          Name (public)
          <span className="small muted">
            Stays visible when locked. Keep private details in the description.
          </span>
          <input
            disabled={busy}
            ref={nameInput}
            aria-invalid={invalidField === 'name' || undefined}
            aria-describedby={invalidField === 'name' ? errorId : undefined}
            data-autofocus
            required
            maxLength={100}
            value={name}
            onFocus={(e) => {
              if (suggestedName.current) e.currentTarget.select();
            }}
            onMouseDown={(e) => {
              if (!suggestedName.current) return;
              // Preserve replacement when the suggested field is already focused.
              // Native pointer placement would otherwise collapse its selection.
              e.preventDefault();
              e.currentTarget.focus();
              e.currentTarget.select();
            }}
            onChange={(e) => {
              suggestedName.current = false;
              setName(e.target.value);
              clearFieldError('name');
            }}
          />
        </label>
        <label>
          Description (encrypted, optional)
          <textarea
            disabled={busy}
            aria-label="Workspace description"
            maxLength={10000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Bitcoin network
          {template || networks?.length === 1 ? (
            <input disabled={busy} readOnly value={template?.network ?? selectedNet} />
          ) : networks?.length ? (
            <select
              disabled={busy}
              value={selectedNet ?? ''}
              onChange={(e) => setNet(e.target.value as Network)}
            >
              {networks.map((network) => (
                <option key={network} value={network}>
                  {network === 'mainnet' ? 'Mainnet' : 'Testnet4'}
                </option>
              ))}
            </select>
          ) : (
            <input disabled={busy} readOnly value="Unavailable" />
          )}
        </label>
        {template && (
          <p className="small muted">
            The example uses {template.network}. Bundled chain data is a snapshot; refresh or trace
            further through your backend.
          </p>
        )}
        <PasswordField
          value={password}
          onChange={(value) => {
            setPassword(value);
            clearFieldError('password');
          }}
          disabled={busy}
          inputRef={passwordInput}
          invalid={invalidField === 'password'}
          describedBy={`${passwordHintId}${invalidField === 'password' ? ` ${errorId}` : ''}`}
        />
        <p id={passwordHintId} className="small muted">
          At least 8 characters. Use a long, unique passphrase.
        </p>
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChange={(value) => {
            setConfirm(value);
            clearFieldError('confirm');
          }}
          disabled={busy}
          inputRef={confirmInput}
          invalid={invalidField === 'confirm'}
          describedBy={invalidField === 'confirm' ? errorId : undefined}
        />
        <p className="security-note">
          <LockKeyhole size={16} /> Contents are encrypted; the name is public. Your password cannot
          be recovered. Workspaces lock on reload; Chaingraph never stores your password.
        </p>
        {error && (
          <p id={errorId} role="alert" className="error-text">
            {error}
          </p>
        )}
        {!networks?.length && (
          <p role="alert" className="error-text">
            Cannot discover supported networks. Check the backend connection.
          </p>
        )}
      </PasswordControls>
    </Modal>
  );
}
