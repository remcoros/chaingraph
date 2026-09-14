import { Wallet as WalletIcon } from 'lucide-react';
import type { Wallet } from '../../../../../Domain/types';

export interface FlowPanelWalletViewProps {
  selectedWallet?: Wallet;
}

/**
 * The wallet view's header, which it owns end to end.
 *
 * The view has no body yet, so selecting a wallet names it and leaves the panel
 * empty until there is something to show.
 */
export function WalletFlowHeader({ wallet }: { wallet: Wallet }) {
  return (
    <span className="flow-panel-header">
      <span className="flow-panel-title">
        <WalletIcon size={16} aria-hidden="true" />
        <span>Wallet</span>
        <code title={wallet.name}>{wallet.name}</code>
      </span>
    </span>
  );
}
