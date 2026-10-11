import { useId, useState } from 'react';
import { Eye, EyeOff, Pencil } from 'lucide-react';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { Network } from '../../../../Core/Bitcoin';
import { inspectExtendedPublicKey } from '../../../../Core/Workspace/Wallets/walletDerivation';
import { Modal } from '../../../Dialogs/Modal';
import { CopyButton } from '../../../Controls/CopyButton';

const scriptNames = {
  p2pkh: 'Legacy · P2PKH',
  'p2sh-p2wpkh': 'Nested SegWit · P2SH-P2WPKH',
  p2wpkh: 'Native SegWit · P2WPKH',
  p2tr: 'Taproot · P2TR',
};

/** Key encoding gives an account index, but cannot recover the full origin path. */
export function WalletDetailsDialog({
  wallet,
  network,
  onClose,
  onEditWallet,
}: {
  wallet: Wallet;
  network: Network;
  onClose: () => void;
  onEditWallet?: (walletId: string) => void;
}) {
  const [keyVisible, setKeyVisible] = useState(false);
  const keyId = useId();
  let account: ReturnType<typeof inspectExtendedPublicKey> | undefined;
  try {
    account = inspectExtendedPublicKey(wallet.key, network);
  } catch {
    // A preview without an account key still has a usable wallet details dialog.
  }
  return (
    <Modal title="Wallet details" onClose={onClose} className="wallet-details-dialog">
      <div className="stack">
        <dl className="wallet-details-facts">
          <dt>Name</dt>
          <dd>{wallet.name}</dd>
          <dt>Network</dt>
          <dd>{network === 'mainnet' ? 'Mainnet' : 'Testnet4'}</dd>
          <dt>Script type</dt>
          <dd>{scriptNames[wallet.scriptType]}</dd>
          <dt>Account</dt>
          <dd>
            {account ? `${account.account} · hardened child at depth 3` : 'Account key unavailable'}
          </dd>
          {account && (
            <>
              <dt>Key encoding</dt>
              <dd>{account.prefix}</dd>
            </>
          )}
          <dt>Derivation origin</dt>
          <dd>Full origin path unavailable from the account key</dd>
        </dl>
        {wallet.key && (
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
              <CopyButton value={wallet.key} label="Copy account key" />
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
        )}
        <div className="button-row">
          {onEditWallet && (
            <button
              onClick={() => {
                onClose();
                onEditWallet(wallet.id);
              }}
            >
              <Pencil size={14} /> Rename wallet
            </button>
          )}
          <button className="primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
