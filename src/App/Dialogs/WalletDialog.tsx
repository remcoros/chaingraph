import { useState } from 'react';
import type { Network, ScriptType, Wallet } from '../../Domain/types';
import { deriveAddresses, inspectExtendedPublicKey } from '../../Domain/Wallet/wallet';
import { Modal } from './Modal';

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
              color: '#f7931a',
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
