import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import { Modal } from '../../../Dialogs/Modal';

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
