import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X, LockKeyhole, ArrowRight } from 'lucide-react';
import type { Network, ScriptType, Wallet, Workspace } from '../domain/types';
import { newWorkspace, parseWorkspace } from '../domain/workspace';
import { demoWorkspace } from '../domain/demo';
import { inspectExtendedPublicKey, deriveAddresses } from '../lib/wallet';
import { decryptWorkspace } from '../lib/crypto';
import type { SavedWorkspace } from '../lib/useWorkspaces';
export function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // Capture the invoker before children mount and React applies autoFocus.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el?.contains(document.activeElement))
      el?.querySelector<HTMLElement>('input,button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const items = [
          ...el!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a[href]',
          ),
        ].filter((x) => x.offsetParent !== null);
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
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (previous?.isConnected) previous.focus();
    };
  }, [previous]);
  return ref;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}>
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
export function CreateDialog({
  network,
  demo,
  onCreate,
  onClose,
}: {
  network: Network;
  demo: boolean;
  onCreate: (w: Workspace, p: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(demo ? 'CoinJoin laboratory' : 'My investigation');
  const [description, setDescription] = useState('');
  const [net, setNet] = useState(network);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a workspace name.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters. A long, unique passphrase is better.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!crypto.subtle) {
      setError('Encryption needs a secure browser context. Use localhost or HTTPS.');
      return;
    }
    const w = demo ? demoWorkspace(false) : newWorkspace(name.trim(), net);
    w.name = name.trim();
    w.description = description.trim();
    onCreate(w, password);
    onClose();
  }
  return (
    <Modal title={demo ? 'Open the CoinJoin laboratory' : 'Create a workspace'} onClose={onClose}>
      <p className="muted">
        {demo
          ? 'Explore three synthetic 150-input / 150-output transactions and their paths. No chain connection needed.'
          : 'A private space for your wallets, transactions, labels, and investigations.'}
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          Name (public)
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="small muted">
          The name stays visible when locked. Keep private details in the encrypted description.
        </p>
        <label>
          Description (encrypted, optional)
          <textarea
            aria-label="Workspace description"
            maxLength={10000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {!demo && (
          <label>
            Bitcoin network
            <select value={net} onChange={(e) => setNet(e.target.value as Network)}>
              <option value="testnet4">Testnet4</option>
              <option value="mainnet">Mainnet</option>
            </select>
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={1024}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="security-note">
          <LockKeyhole size={16} /> Contents are encrypted; the name is public. Your password cannot
          be recovered.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="primary" type="submit">
          Create workspace <ArrowRight size={16} />
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
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onUnlock(entry, password);
            onClose();
          } catch {
            setError(
              'Could not unlock. Check your password and that the file is a valid Chaingraph workspace.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
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
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Open encrypted workspace" onClose={onClose}>
      <p className="muted wrap">{file.name}</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
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
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
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
  const [description, setDescription] = useState(workspace.description ?? '');
  return (
    <Modal title="Workspace details" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onSave(name.trim(), description.trim());
          onClose();
        }}
      >
        <label>
          Name (public)
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="small muted">
          Visible in this browser even while locked, and used in exported filenames.
        </p>
        <label>
          Description (encrypted, optional)
          <textarea
            aria-label="Workspace description"
            maxLength={10000}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={!name.trim()}>
          Save workspace details
        </button>
      </form>
    </Modal>
  );
}
