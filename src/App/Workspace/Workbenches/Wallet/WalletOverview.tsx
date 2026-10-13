import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  Download,
  Info,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  TriangleAlert,
  Upload,
  Wallet as WalletIcon,
} from 'lucide-react';
import { Amount } from '../../../Controls/Display/Amount';
import { Modal } from '../../../Dialogs/Modal';
import { formatLocalTimestamp } from '../../../Controls/Display/transactionTime';
import type { WalletReviewCoverage } from '../../../../Core/Workspace/Wallets/walletReview';
import type { WalletWorkbenchContext } from './walletWorkbenchContext';
import { WalletDetailsDialog } from './WalletDetailsDialog';
import { walletDiscoveryStatus } from './walletDiscoveryStatus';

export function WalletOverview({
  workspace,
  wallet,
  coverage,
  canLoadChainData,
  busy,
  chainDataDisabledReason,
  onSelectWallet,
  onEditWallet,
  onExchangeLabels,
  onAddWallet,
  onRefresh,
  active,
  coinIssues,
  analysisIssues,
  discovery,
  refresh,
}: Pick<
  WalletWorkbenchContext,
  | 'workspace'
  | 'canLoadChainData'
  | 'busy'
  | 'chainDataDisabledReason'
  | 'onSelectWallet'
  | 'onEditWallet'
  | 'onExchangeLabels'
  | 'onAddWallet'
  | 'onRefresh'
  | 'discovery'
  | 'refresh'
> & {
  wallet: NonNullable<WalletWorkbenchContext['wallet']>;
  coverage: WalletReviewCoverage;
  active: boolean;
  coinIssues?: string;
  analysisIssues?: string;
}) {
  const [menuFor, setMenuFor] = useState<string>();
  const menu = active && menuFor === wallet.id;
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const actionsId = useId();
  const loading = refresh?.loading && refresh.walletId === wallet.id;
  const partial = !coverage.scanComplete || coverage.utxoPartial || !!coverage.utxoLoadedSpenders;
  const scanStatus = walletDiscoveryStatus(wallet);
  const refreshIssue =
    refresh?.walletId === wallet.id && !loading
      ? refresh.error ||
        (refresh.message.startsWith('Refresh interrupted') ? 'Refresh interrupted' : '')
      : '';
  const coverageIssue = coverage.utxoLoadedSpenders
    ? 'Balance needs refresh'
    : !coverage.scanComplete
      ? (scanStatus?.text ??
        (coverage.pendingTransactions
          ? `${coverage.pendingTransactions} transactions still need loading`
          : wallet.scannedAt
            ? 'Address search incomplete'
            : ''))
      : coverage.utxoPartial
        ? 'Coin checks incomplete'
        : '';
  const addressLimit = scanStatus && scanStatus.recovery !== 'refresh';
  const issue =
    (addressLimit
      ? scanStatus.text
      : refreshIssue === 'Refresh interrupted'
        ? refreshIssue
        : coverageIssue) ||
    coinIssues ||
    (analysisIssues ? 'Wallet analysis incomplete' : refreshIssue);
  const recovery = addressLimit ? scanStatus.recovery : 'refresh';
  useEffect(() => {
    if (!menu) return;
    const items = () => [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('.dropdown button:not(:disabled)') ??
        []),
    ];
    items()[0]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuFor(undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuFor(undefined);
        triggerRef.current?.focus({ preventScroll: true });
      }
      const buttons = items();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  return (
    <>
      <header className="wallet-review-header" data-tour="wallet-overview">
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
          <div className="wallet-header-balance" aria-label="Wallet balance at last coin check">
            {coverage.utxoCount === undefined ? (
              <span className="muted">Balance not checked</span>
            ) : (
              <div className="wallet-header-amount">
                <Amount as="strong" value={coverage.utxoBalanceSats} />
                {partial && <span className="warning">Partial balance</span>}
              </div>
            )}
            <small className="muted">
              Last refresh:{' '}
              {wallet.refreshedAt ? (
                <time dateTime={wallet.refreshedAt}>
                  {formatLocalTimestamp(wallet.refreshedAt)}
                </time>
              ) : (
                'Never'
              )}
            </small>
          </div>
        </div>
        <div className="wallet-review-controls compact-controls">
          <button
            className="primary"
            aria-label="Refresh wallet"
            aria-busy={!!loading}
            disabled={!canLoadChainData || busy}
            title={chainDataDisabledReason ?? 'Update wallet history, coins and analysis'}
            onClick={onRefresh}
          >
            <RefreshCw size={14} className={loading ? 'spin' : undefined} /> Refresh
          </button>
          <div
            className="workspace-menu wallet-actions-menu"
            ref={menuRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMenuFor(undefined);
            }}
          >
            <button
              ref={triggerRef}
              aria-label="Wallet actions"
              aria-haspopup="menu"
              aria-controls={menu ? actionsId : undefined}
              aria-expanded={menu}
              onClick={() => setMenuFor(menu ? undefined : wallet.id)}
            >
              <MoreHorizontal size={16} />
            </button>
            {menu && (
              <div className="dropdown" id={actionsId} role="menu" aria-label="Wallet actions">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuFor(undefined);
                    setDetailsOpen(true);
                  }}
                >
                  <Info size={13} /> Wallet details…
                </button>
                <button
                  role="menuitem"
                  disabled={workspace.demo}
                  onClick={() => {
                    setMenuFor(undefined);
                    onAddWallet();
                  }}
                >
                  <Plus size={13} /> Add wallet…
                </button>
                {onExchangeLabels && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(undefined);
                        onExchangeLabels('import');
                      }}
                    >
                      <Upload size={13} /> Import wallet metadata
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(undefined);
                        onExchangeLabels('export');
                      }}
                    >
                      <Download size={13} /> Export wallet metadata
                    </button>
                  </>
                )}
                {discovery && (
                  <>
                    <hr />
                    <button
                      role="menuitemcheckbox"
                      aria-checked={discovery.monitorActivity}
                      onClick={() => {
                        discovery.setMonitorActivity(!discovery.monitorActivity);
                        setMenuFor(undefined);
                      }}
                    >
                      <Check
                        size={13}
                        style={{ visibility: discovery.monitorActivity ? 'visible' : 'hidden' }}
                      />{' '}
                      Automatic refresh
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(undefined);
                        setSettingsOpen(true);
                      }}
                    >
                      <Settings size={13} /> Refresh settings…
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {(!canLoadChainData || coinIssues || analysisIssues || (!loading && issue)) && (
          <div
            className="wallet-review-callout tone-attention wallet-refresh-notice compact-controls"
            role="status"
          >
            <TriangleAlert size={16} aria-hidden="true" />
            <div className="wallet-refresh-notice-content">
              {!loading && issue && <p>{issue}</p>}
              {!loading && refreshIssue && refreshIssue !== issue && <p>{refreshIssue}</p>}
              {coinIssues && (loading || coinIssues !== issue) && <p>{coinIssues}</p>}
              {analysisIssues && (loading || analysisIssues !== issue) && <p>{analysisIssues}</p>}
              {!loading && addressLimit && scanStatus.hint && <p>{scanStatus.hint}</p>}
              {!canLoadChainData && <p>{chainDataDisabledReason ?? 'Chain data unavailable'}</p>}
            </div>
            {!loading && recovery === 'settings' && discovery ? (
              <button onClick={() => setSettingsOpen(true)}>Refresh settings</button>
            ) : !loading && recovery === 'refresh' && canLoadChainData ? (
              <button disabled={busy} onClick={onRefresh}>
                Retry refresh
              </button>
            ) : null}
          </div>
        )}
      </header>
      {settingsOpen && active && discovery && (
        <WalletRefreshSettings discovery={discovery} onClose={() => setSettingsOpen(false)} />
      )}
      {detailsOpen && active && (
        <WalletDetailsDialog
          wallet={wallet}
          network={workspace.network}
          onEditWallet={onEditWallet}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </>
  );
}

function WalletRefreshSettings({
  discovery,
  onClose,
}: {
  discovery: NonNullable<WalletWorkbenchContext['discovery']>;
  onClose: () => void;
}) {
  const [interval, setInterval] = useState(String(discovery.refreshIntervalSeconds));
  const [gap, setGap] = useState(String(discovery.gapLimit));
  const [limit, setLimit] = useState(String(discovery.addressesPerBranch));
  const [error, setError] = useState('');
  return (
    <Modal
      title="Refresh settings"
      onClose={onClose}
      className="wallet-refresh-settings compact-controls"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const seconds = Number(interval),
            gapLimit = Number(gap),
            addresses = Number(limit);
          if (
            !Number.isInteger(seconds) ||
            seconds < 10 ||
            seconds > 86400 ||
            !Number.isInteger(gapLimit) ||
            gapLimit < 1 ||
            gapLimit > 100 ||
            !Number.isInteger(addresses) ||
            addresses < 1 ||
            addresses > 1000
          ) {
            setError('Check the refresh settings.');
            return;
          }
          discovery.setRefreshIntervalSeconds(seconds);
          discovery.setGapLimit(gapLimit);
          discovery.setAddressesPerBranch(addresses);
          onClose();
        }}
      >
        <div className="wallet-settings-fields">
          <label>
            Refresh interval (seconds)
            <input
              type="number"
              required
              min={10}
              max={86400}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
          </label>
          <label>
            Gap limit
            <input
              type="number"
              required
              min={1}
              max={100}
              value={gap}
              onChange={(event) => setGap(event.target.value)}
            />
          </label>
          <label>
            Addresses per branch
            <input
              type="number"
              required
              min={1}
              max={1000}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="warning" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
