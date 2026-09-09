import { useEffect, useId, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X, LockKeyhole, ArrowRight, Eye, EyeOff } from 'lucide-react';
import type { Network, ScriptType, Wallet, Workspace } from '../domain/types';
import { newWorkspace, parseWorkspace } from '../domain/workspace';
import type { WorkspaceTemplate } from '../domain/workspaceTemplates';
import { loadTemplateWorkspace } from '../lib/templateWorkspace';
import { inspectExtendedPublicKey, deriveAddresses } from '../lib/wallet';
import { decryptWorkspace } from '../lib/crypto';
import type { SavedWorkspace } from '../lib/useWorkspaces';
import './dialogs.css';
export function useDialogFocus(
  onClose: () => void,
  fallbackFocusSelector?: string,
  trapFocus = true,
) {
  const ref = useRef<HTMLDivElement>(null);
  // Capture the invoker before children mount and React applies autoFocus.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el?.contains(document.activeElement))
      (
        el?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
        el?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)')
      )?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab' && trapFocus) {
        const items = [
          ...el!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex]:not([tabindex="-1"])',
          ),
        ].filter((x) => x.offsetParent !== null && x.tabIndex >= 0);
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || !el?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !el?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const focusOutside = (event: FocusEvent) => {
      if (
        !trapFocus &&
        event.target instanceof Node &&
        !el?.contains(event.target) &&
        !previous?.contains(event.target)
      )
        closeRef.current();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('focusin', focusOutside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('focusin', focusOutside);
      // Nonmodal quick editors allow focus to move to another app control.
      // Escape/Done still return focus when it remained inside the editor.
      if (
        !trapFocus &&
        document.activeElement !== document.body &&
        !el?.contains(document.activeElement)
      )
        return;
      const target = previous?.isConnected
        ? previous
        : fallbackFocusSelector
          ? document.querySelector<HTMLElement>(fallbackFocusSelector)
          : null;
      target?.focus({ preventScroll: true });
    };
  }, [previous, fallbackFocusSelector, trapFocus]);
  return ref;
}
export function Modal({
  title,
  children,
  onClose,
  className,
  fallbackFocusSelector,
}: {
  fallbackFocusSelector?: string;
  className?: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose, fallbackFocusSelector);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function focusDialogField(input: HTMLInputElement | null) {
  if (!input) return;
  input.focus({ preventScroll: true });
  const modal = input.closest<HTMLElement>('.modal');
  if (!modal) return;
  const fieldBounds = input.getBoundingClientRect();
  const modalBounds = modal.getBoundingClientRect();
  if (fieldBounds.top < modalBounds.top + 16)
    modal.scrollTop += fieldBounds.top - modalBounds.top - 16;
  else if (fieldBounds.bottom > modalBounds.bottom - 16)
    modal.scrollTop += fieldBounds.bottom - modalBounds.bottom + 16;
}

function PasswordField({
  label = 'Password',
  value,
  onChange,
  disabled,
  creating,
  autofocus,
  describedBy,
  invalid,
  inputRef,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  creating?: boolean;
  autofocus?: boolean;
  describedBy?: string;
  invalid?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          autoComplete={creating ? 'new-password' : 'current-password'}
          data-autofocus={autofocus || undefined}
          required
          maxLength={1024}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label === 'Confirm password' ? 'confirmation' : 'password'}`}
          aria-pressed={visible}
          tabIndex={-1}
          title={`${visible ? 'Hide' : 'Show'} ${label === 'Confirm password' ? 'confirmation' : 'password'}`}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

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
  useEffect(() => {
    if (!template && (!net || !networks?.includes(net))) setNet(networks?.[0]);
  }, [networks, net, template]);
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
  supported.current = networks;
  const close = () => {
    pending.current?.abort();
    onClose();
  };
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(e: FormEvent) {
    e.preventDefault();
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
    if (!net || !networks?.includes(net)) {
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
        : { ...newWorkspace(name.trim(), net), description: description.trim() };
      controller.signal.throwIfAborted();
      if (!supported.current?.includes(w.network))
        throw new Error(`Backend does not support ${w.network}. Check the backend connection.`);
      onCreate(w, password);
      onClose();
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not create the workspace. Please try again.',
        );
    } finally {
      if (!controller.signal.aborted) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  }
  return (
    <Modal title="Create a workspace" onClose={close} fallbackFocusSelector=".help-menu > button">
      <p className="muted">
        {template
          ? 'Start with real transactions, labels and tags. This is your own editable copy, saved like any other workspace.'
          : 'A private space for your wallets, transactions, labels, and investigations.'}
      </p>
      <form onSubmit={submit} className="stack" noValidate>
        <label>
          Name (public)
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
        <p className="small muted">
          The name stays visible when locked. Keep private details in the encrypted description.
        </p>
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
            <input disabled={busy} readOnly value={template?.network ?? networks?.[0]} />
          ) : networks?.length ? (
            <select
              disabled={busy}
              value={net ?? ''}
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
          creating
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
          creating
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
        <button
          className="primary"
          type="submit"
          disabled={busy || !net || !networks?.includes(net)}
        >
          {busy ? 'Preparing workspace…' : 'Create workspace'} <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}
export function UnlockDialog({
  entry,
  onUnlock,
  onClose,
}: {
  entry: SavedWorkspace;
  onUnlock: (e: SavedWorkspace, p: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const passwordInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Unlock workspace" onClose={onClose}>
      <p className="muted">
        Saved {new Date(entry.savedAt).toLocaleString()}. Workspace names are public. Descriptions,
        wallet names and contents stay encrypted until unlocked.
      </p>
      <form
        className="stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!password) {
            setError('Enter your workspace password.');
            focusDialogField(passwordInput.current);
            return;
          }
          setError('');
          setBusy(true);
          try {
            await onUnlock(entry, password);
            onClose();
          } catch {
            setError(
              'Could not unlock. Check your password. If browser data was cleared or is unavailable, restore an exported workspace backup.',
            );
          } finally {
            setBusy(false);
          }
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
        <button className="primary" disabled={busy}>
          {busy ? 'Decrypting…' : 'Unlock workspace'}
        </button>
      </form>
    </Modal>
  );
}
export function WalletDialog({
  network,
  onAdd,
  onClose,
}: {
  network: Network;
  onAdd: (w: Wallet) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('Personal wallet');
  const [key, setKey] = useState('');
  const [script, setScript] = useState<ScriptType>('p2wpkh');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  function inspect() {
    try {
      const info = inspectExtendedPublicKey(key.trim(), network);
      const type = info.suggestedScriptType ?? script;
      setScript(type);
      setPreview(deriveAddresses(key.trim(), network, type, 0, 0, 1)[0].address);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid extended public key.');
      setPreview('');
    }
  }
  return (
    <Modal title="Add a wallet" onClose={onClose}>
      <p className="muted">
        Import an account-level extended public key. Receive and change addresses are derived in
        your browser.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!name.trim()) throw new Error('Enter a wallet name.');
            deriveAddresses(key.trim(), network, script, 0, 0, 1);
            onAdd({
              id: crypto.randomUUID(),
              name: name.trim(),
              key: key.trim(),
              scriptType: script,
              color: '#b5e879',
              addresses: [],
            });
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not import wallet.');
          }
        }}
      >
        <label>
          Wallet name
          <input
            required
            data-autofocus
            maxLength={100}
            value={name}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Extended public key
          <textarea
            className="mono"
            rows={3}
            spellCheck={false}
            required
            placeholder={network === 'mainnet' ? 'xpub / ypub / zpub' : 'tpub / upub / vpub'}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setPreview('');
              try {
                const info = inspectExtendedPublicKey(e.target.value.trim(), network);
                if (info.suggestedScriptType) setScript(info.suggestedScriptType);
              } catch {
                /* Partial input is validated on preview or submission. */
              }
            }}
          />
        </label>
        <label>
          Address type
          <select
            value={script}
            onChange={(e) => {
              setScript(e.target.value as ScriptType);
              setPreview('');
            }}
          >
            <option value="p2wpkh">Native SegWit · P2WPKH</option>
            <option value="p2sh-p2wpkh">Nested SegWit · P2SH-P2WPKH</option>
            <option value="p2pkh">Legacy · P2PKH</option>
            <option value="p2tr">Taproot · BIP86</option>
          </select>
        </label>
        <button type="button" onClick={inspect}>
          Preview first receive address
        </button>
        {preview && <p className="mono wrap preview-address">{preview}</p>}
        <p className="muted small">
          Single-key account public keys only. Confirm the preview against your wallet. Descriptors
          and multisig are not supported yet.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" className="primary">
          Add wallet
        </button>
      </form>
    </Modal>
  );
}

export function WalletNameDialog({
  wallet,
  onChange,
  onClose,
}: {
  wallet: Wallet;
  onChange: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(wallet.name);
  const [keyVisible, setKeyVisible] = useState(false);
  const keyId = useId();
  return (
    <Modal title="Edit wallet name" onClose={onClose}>
      <div className="stack">
        <label>
          Wallet name
          <input
            data-autofocus
            required
            maxLength={100}
            value={name}
            aria-invalid={!name.trim()}
            onChange={(event) => {
              setName(event.target.value);
              if (event.target.value.trim()) onChange(event.target.value.trim());
            }}
          />
        </label>
        <p className="small muted">Changes save automatically inside your encrypted workspace.</p>
        {!name.trim() && (
          <p role="alert">A name is required. The previous name is kept until you enter one.</p>
        )}
        <div className="wallet-name-key">
          <div className="wallet-name-key-heading">
            <label htmlFor={keyId}>Extended public key (read-only)</label>
            <button
              type="button"
              aria-label={`${keyVisible ? 'Hide' : 'Show'} extended public key`}
              aria-pressed={keyVisible}
              aria-controls={keyId}
              onClick={() => setKeyVisible((current) => !current)}
            >
              {keyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
              {keyVisible ? 'Hide' : 'Show'}
            </button>
          </div>
          <textarea
            id={keyId}
            className="mono"
            rows={3}
            readOnly
            spellCheck={false}
            value={keyVisible ? wallet.key : '••••••••••••••••••••••••'}
          />
        </div>
        <button className="primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function ImportDialog({
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
  return (
    <Modal title="Open encrypted workspace" onClose={onClose}>
      <p className="muted wrap">{file.name}</p>
      <form
        className="stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!password) {
            setError('Enter your workspace password.');
            focusDialogField(passwordInput.current);
            return;
          }
          setError('');
          setBusy(true);
          try {
            const data = parseWorkspace(
              await decryptWorkspace(JSON.parse(await file.text()), password),
            );
            onImport(data, password);
            onClose();
          } catch {
            setError('Could not open this workspace. Check the password and file format.');
          } finally {
            setBusy(false);
          }
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
        <button className="primary" disabled={busy}>
          {busy ? 'Decrypting…' : 'Open workspace'}
        </button>
      </form>
    </Modal>
  );
}

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
