import { Amount } from '../../../Controls/Display/Amount';
import {
  ArrowRight,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  ScanSearch,
  Wallet as WalletIcon,
} from 'lucide-react';
import { walletCheckAge } from '../../../../Core/Workspace/Wallets/walletActivity';
import { formatLocalTimestamp } from '../../../Controls/Display/transactionTime';
import type { WalletReviewCoverage } from '../../../../Core/Workspace/Wallets/walletReview';
import type { WalletUtxoCheck } from '../../../../Core/Workspace/Wallets/WalletUtxos/walletUtxoCheck';
import type { WalletWorkbenchContext } from './walletWorkbenchContext';
import { WalletHelp } from '../../../Controls/Display/WalletHelp';
import { walletDiscoveryStatus } from './walletDiscoveryStatus';

export function WalletOverview({
  workspace,
  tourPreview,
  wallet,
  coverage,
  utxos,
  utxoLoading,
  canLoadChainData,
  busy,
  chainDataDisabledReason,
  onSelectWallet,
  onEditWallet,
  onAddWallet,
  onRefresh,
  onCheck,
  active,
  onAnalyze,
  analyzing,
  analysisStatus,
  analysisIssues,
}: Pick<
  WalletWorkbenchContext,
  | 'workspace'
  | 'tourPreview'
  | 'canLoadChainData'
  | 'busy'
  | 'chainDataDisabledReason'
  | 'onSelectWallet'
  | 'onEditWallet'
  | 'onAddWallet'
  | 'onRefresh'
> & {
  wallet: NonNullable<WalletWorkbenchContext['wallet']>;
  coverage: WalletReviewCoverage;
  utxos?: WalletUtxoCheck;
  utxoLoading: boolean;
  onCheck: (cursor?: number) => void;
  active: boolean;
  onAnalyze: () => void;
  analyzing: boolean;
  analysisStatus: string;
  analysisIssues?: string;
}) {
  const discovery = walletDiscoveryStatus(wallet);
  const missingHistory = Math.max(0, coverage.knownTransactions - coverage.loadedTransactions);
  return (
    <>
      <header className="wallet-review-header" data-tour="wallet-overview">
        <div className="wallet-identity">
          <div className="wallet-picker-row">
            <label className="wallet-picker">
              <WalletIcon size={19} style={{ color: wallet.color }} aria-hidden="true" />
              <select
                aria-label="Selected wallet"
                value={wallet.id}
                onChange={(event) => onSelectWallet(event.target.value)}
              >
                {workspace.wallets.definitions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {onEditWallet && (
              <button
                className="icon-button"
                aria-label="Edit wallet name"
                title="Edit wallet name"
                onClick={() => onEditWallet(wallet.id)}
              >
                <Pencil size={14} />
              </button>
            )}
            <button className="text-button" onClick={onAddWallet} disabled={workspace.demo}>
              <Plus size={14} /> Add wallet
            </button>
          </div>
        </div>
        <div className="wallet-review-controls">
          <button
            className="primary"
            disabled={!active || busy || analyzing}
            title="Scan this wallet's loaded transactions for supported observations and hypotheses. No network requests"
            onClick={onAnalyze}
          >
            <ScanSearch size={14} /> {analyzing ? 'Analyzing…' : 'Analyze'}
          </button>
          <button
            aria-label="Refresh wallet"
            disabled={!canLoadChainData || busy}
            title={chainDataDisabledReason ?? 'Check wallet history for new transactions'}
            onClick={onRefresh}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            aria-label="Check current UTXOs"
            disabled={!canLoadChainData || utxoLoading}
            title="Check unspent outputs at the discovered wallet addresses"
            onClick={() => onCheck()}
          >
            <RefreshCw size={13} /> {utxoLoading ? 'Checking...' : 'Check UTXOs'}
          </button>
        </div>
      </header>
      <dl className="wallet-coverage" aria-label="Wallet coverage">
        <div>
          <dt>UTXOs at last check</dt>
          <dd>
            {coverage.utxoCount === undefined ? (
              tourPreview ? (
                'Not checked in preview'
              ) : canLoadChainData ? (
                'Not checked yet'
              ) : (
                'Backend unavailable'
              )
            ) : (
              <>
                {coverage.utxoCount}{' '}
                {coverage.utxoLoadedSpenders ? 'remaining candidates' : 'observed unspent'} ·{' '}
                <Amount value={coverage.utxoBalanceSats} />
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Wallet refreshed</dt>
          <dd title={wallet.scannedAt ? formatLocalTimestamp(wallet.scannedAt) : undefined}>
            {walletCheckAge(wallet.scannedAt)}
          </dd>
        </div>
        <div>
          <dt>Addresses</dt>
          <dd>
            {coverage.usedAddresses} used of {coverage.discoveredAddresses} discovered
          </dd>
        </div>
        <div>
          <dt>History</dt>
          <dd>
            {coverage.loadedTransactions}/{coverage.knownTransactions} transactions loaded
          </dd>
        </div>
      </dl>
      <div className="wallet-coverage-actions">
        <span className="wallet-scan-status" role="status">
          {analysisStatus}
        </span>
        {analysisIssues && (
          <WalletHelp title="Scan errors" active={active}>
            {analysisIssues}
          </WalletHelp>
        )}
        {discovery && (
          <span className="wallet-discovery-status">
            {discovery.text}
            {discovery.hint && (
              <WalletHelp title="Address search limit" active={active}>
                {discovery.hint}
              </WalletHelp>
            )}
          </span>
        )}
        {(missingHistory > 0 || coverage.pendingTransactions > 0) && (
          <span className="compact-controls">
            <button disabled={!canLoadChainData || busy} onClick={onRefresh}>
              {missingHistory ? <Download size={13} /> : <RefreshCw size={13} />}
              {missingHistory
                ? `Load history (${missingHistory})`
                : `Continue refresh (${coverage.pendingTransactions})`}
            </button>
          </span>
        )}
        {utxos?.nextCursor !== undefined && (
          <span className="compact-controls">
            <button
              disabled={!canLoadChainData || utxoLoading}
              onClick={() => onCheck(utxos.nextCursor)}
            >
              <ArrowRight size={13} /> Check next addresses
            </button>
          </span>
        )}
        {utxos && (
          <span className="small muted" title={formatLocalTimestamp(utxos.checkedAt)}>
            UTXOs checked · {utxos.checkedAddresses} / {utxos.totalAddresses} addresses ·{' '}
            {formatLocalTimestamp(utxos.checkedAt) ?? 'Unknown time'}
            {utxos.failed ? ` · ${utxos.failed} failed` : ''}
          </span>
        )}
        {!!coverage.utxoLoadedSpenders && (
          <span className="small warning" role="status">
            {coverage.utxoLoadedSpenders} saved UTXO{' '}
            {coverage.utxoLoadedSpenders === 1
              ? 'has a loaded spender'
              : 'checks have loaded spenders'}
            . Historical checks retained; use Check UTXOs to resolve current status.
          </span>
        )}
        {!!utxos?.failed && (
          <span className="compact-controls">
            <button disabled={!canLoadChainData || utxoLoading} onClick={() => onCheck()}>
              <RefreshCw size={13} /> Retry address checks ({utxos.failed})
            </button>
          </span>
        )}
        {!canLoadChainData && <span className="small muted">{chainDataDisabledReason}</span>}
      </div>
    </>
  );
}
