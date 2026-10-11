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
import type { WalletUtxoCheck } from '../../../../Core/Workspace/Wallets/WalletUtxos/walletUtxoCheck';
import type { WalletWorkbenchContext } from './walletWorkbenchContext';
import { WalletDetailsDialog } from './WalletDetailsDialog';
import { walletDiscoveryStatus } from './walletDiscoveryStatus';

export function WalletOverview({
  workspace,
  wallet,
  coverage,
  utxos,
  canLoadChainData,
  busy,
  chainDataDisabledReason,
  onSelectWallet,
  onEditWallet,
  onExchangeLabels,
  onAddWallet,
  onRefresh,
  active,
  analysisStatus,
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
  utxos?: WalletUtxoCheck;
  active: boolean;
  analysisStatus: string;
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
      ? (scanStatus?.text ?? 'History incomplete')
      : coverage.utxoPartial
        ? 'Coin checks incomplete'
        : '';
  const issue =
    refreshIssue ||
    coverageIssue ||
    analysisIssues ||
    (!canLoadChainData ? chainDataDisabledReason : '');
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
              <>
                <Amount as="strong" value={coverage.utxoBalanceSats} />
                <span className={partial ? 'warning' : 'muted'}>
                  {partial ? 'Partial balance' : null}
                </span>
              </>
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
      </header>
      <details className="wallet-coverage-disclosure">
        <summary>
          Coverage{' '}
          <TriangleAlert
            size={13}
            className={issue ? 'warning' : 'wallet-status-placeholder'}
            aria-label={issue ? 'Needs attention' : undefined}
            aria-hidden={!issue}
          />
        </summary>
        <div className="wallet-coverage-actions" role="status">
          {loading && <span>{refresh.message}</span>}
          {issue && (
            <>
              <span className="warning">{issue}</span>
              <button disabled={!canLoadChainData || busy || !!loading} onClick={onRefresh}>
                Retry refresh
              </button>
            </>
          )}
        </div>
        <dl className="wallet-coverage" aria-label="Wallet coverage">
          <div>
            <dt>Coins at last check</dt>
            <dd>
              {coverage.utxoCount === undefined
                ? 'Not checked'
                : `${coverage.utxoCount} ${coverage.utxoLoadedSpenders ? 'remaining candidates' : 'observed unspent'}`}
            </dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>
              {coverage.loadedTransactions}/{coverage.knownTransactions} transactions loaded
              {coverage.pendingTransactions ? ` · ${coverage.pendingTransactions} pending` : ''}
            </dd>
          </div>
          <div>
            <dt>Addresses</dt>
            <dd>
              {coverage.usedAddresses} used of {coverage.discoveredAddresses} discovered
            </dd>
          </div>
          <div>
            <dt>Coin coverage</dt>
            <dd>
              {utxos
                ? `${utxos.checkedAddresses}/${utxos.totalAddresses} addresses · ${formatLocalTimestamp(utxos.checkedAt)}`
                : 'Not checked'}
            </dd>
          </div>
        </dl>
        {analysisStatus && <p>{analysisStatus}</p>}
        {analysisIssues && analysisIssues !== issue && <p className="warning">{analysisIssues}</p>}
      </details>
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
