import { Amount } from './Amount';
import { listWalletAddresses } from '../domain/walletRecords';
import {
  matchingWalletUtxoObservation,
  type WalletUtxoObservation,
} from '../domain/walletUtxoObservation';
import { useUtxoStatus } from '../lib/useUtxoStatus';
import './utxo-status.css';
import { TransactionBlockTime } from './TransactionBlockTime';
import { transactionStatus } from '../domain/transactionStatus';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Crosshair,
  EyeOff,
  Eye,
  Pencil,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import {
  short,
  txNodeId,
  addressNodeId,
  type Annotation,
  type Wallet,
  type Workspace,
  type Transaction,
  type GraphNode,
  type GraphData,
} from '../domain/types';
import { equalOutputCount } from '../domain/analysis';
import { outputAddress } from '../domain/workspace';
import { walletCheckAge } from '../domain/walletActivity';
import { CopyButton } from './CopyButton';
import { VisibilityActions, type VisibilityProps } from './VisibilityActions';
import { ScriptInspector } from './ScriptInspector';
import { IconPicker } from './IconPicker';
import { OpReturnData } from './OpReturnData';
import { decodeOpReturn } from '../domain/opReturn';
import { indexLoadedSpends } from '../domain/transactionFlow';
import type { WalletMatch } from '../domain/tags';
import { WalletHelp } from './WalletHelp';

export function AnnotationEditor({
  annotation,
  onSave,
  editToken,
  editTarget,
  onEditHandled,
  children,
}: {
  annotation: Annotation;
  editToken?: number;
  editTarget?: 'label' | 'icon';
  onEditHandled?: () => void;
  onSave: (a: Annotation, group?: string) => void;
  children?: ReactNode;
}) {
  const editGroup = useRef('');
  const labelRef = useRef<HTMLInputElement>(null);
  const previousEditToken = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (editTarget !== 'icon' && editToken && editToken !== previousEditToken.current) {
      labelRef.current?.focus();
      onEditHandled?.();
    }
    previousEditToken.current = editToken;
  }, [editToken]);
  return (
    <section
      className="panel-section annotation-editor"
      data-tour="annotation-editor"
      aria-label="Annotations"
      onFocusCapture={() => {
        editGroup.current = crypto.randomUUID();
      }}
    >
      <div className="annotation-heading">
        <h3>Annotations</h3>
        <div className="annotation-utilities">
          <IconPicker
            compact
            value={annotation.icon}
            openToken={editTarget === 'icon' ? editToken : undefined}
            onOpenHandled={onEditHandled}
            onChange={(icon) => {
              onSave({ ...annotation, icon }, editGroup.current);
            }}
          />
          <label className="annotation-bookmark">
            <input
              type="checkbox"
              checked={annotation.bookmarked}
              onChange={(e) => {
                onSave({ ...annotation, bookmarked: e.target.checked }, editGroup.current);
              }}
            />
            Bookmark
          </label>
        </div>
      </div>
      <label>
        Label
        <input
          ref={labelRef}
          aria-label="Node label"
          maxLength={200}
          placeholder="Add a label"
          value={annotation.label}
          onChange={(e) => {
            onSave({ ...annotation, label: e.target.value }, editGroup.current);
          }}
        />
      </label>
      <label>
        Notes
        <textarea
          aria-label="Node notes"
          rows={3}
          maxLength={10000}
          placeholder="Add notes"
          value={annotation.note}
          onChange={(e) => {
            onSave({ ...annotation, note: e.target.value }, editGroup.current);
          }}
        />
      </label>
      {children}
    </section>
  );
}
export function WalletInspector({
  wallet,
  workspace,
  busy,
  canQuery,
  onScan,
  onShowActivity,
  onShowWallet,
  onEdit,
  onRemove,
}: {
  wallet: Wallet;
  workspace: Workspace;
  busy: boolean;
  canQuery: boolean;
  onScan: () => void;
  onShowActivity: () => void;
  onShowWallet?: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirmRemove) keepButton.current?.focus();
    else if (wasConfirming.current) removeButton.current?.focus();
    wasConfirming.current = confirmRemove;
  }, [confirmRemove]);
  const receivedOutputCount = listWalletAddresses(workspace, wallet).reduce(
    (total, address) => total + address.loadedOutputCount,
    0,
  );
  const histories = new Set(
    wallet.addresses.flatMap((a) => a.history?.map((h) => h.tx_hash) ?? []),
  );
  const knownHistory = wallet.addresses.some((address) => address.history !== undefined);
  const pendingCount = wallet.pendingTransactionIds?.length ?? 0;
  const coverage =
    wallet.scanComplete === true
      ? 'Gap limit reached on both branches.'
      : wallet.scanComplete === false
        ? 'Partial scan. Refresh or increase Discovery limits.'
        : 'Scan coverage not recorded.';
  return (
    <div className="wallet-inspector">
      <section className="panel-section">
        <div className="wallet-inspector-heading compact-controls">
          <h2>{wallet.name}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit wallet name: ${wallet.name}`}
            title="Edit wallet name"
            onClick={onEdit}
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
        </div>
        <p className="wallet-inspector-kind">Watch-only · {wallet.scriptType.toUpperCase()}</p>
        <div className="wallet-refresh-summary compact-controls">
          <button className="primary" disabled={busy || !canQuery} onClick={onScan}>
            <RefreshCw size={13} aria-hidden="true" />
            {wallet.scannedAt ? 'Refresh wallet' : 'Scan wallet'}
          </button>
          <p
            className="wallet-inspector-check-age"
            title={wallet.scannedAt ? new Date(wallet.scannedAt).toLocaleString() : undefined}
          >
            {walletCheckAge(wallet.scannedAt)}
          </p>
          {!!wallet.unreviewedTransactionIds?.length && (
            <button onClick={onShowActivity} title="Transactions loaded since your last review">
              <Eye size={13} aria-hidden="true" /> Show new activity (
              {wallet.unreviewedTransactionIds.length})
            </button>
          )}
          {wallet.activityOverflow && (
            <p className="wallet-inspector-notice">
              Showing the latest 10,000 unreviewed transactions. Earlier records remain in the
              graph.
            </p>
          )}
          {!!wallet.lastActivity?.missingTransactionCount && (
            <p className="wallet-inspector-notice">
              {wallet.lastActivity.missingTransactionCount} previously recorded transactions were
              absent from the latest histories. Saved transactions and annotations are retained.
            </p>
          )}
        </div>
      </section>
      <section className="panel-section" aria-label="Discovery">
        <h3>Discovery</h3>
        {wallet.scannedAt && (
          <p
            className={
              wallet.scanComplete === false
                ? 'wallet-inspector-notice'
                : 'wallet-inspector-coverage'
            }
          >
            {coverage}
          </p>
        )}
        {pendingCount > 0 && (
          <p className="wallet-inspector-notice" role="status">
            {pendingCount} {pendingCount === 1 ? 'transaction waiting' : 'transactions waiting'} to
            load. Refresh to continue.
          </p>
        )}
        <dl className="details">
          <div>
            <dt>Discovered addresses</dt>
            <dd>{wallet.addresses.length}</dd>
          </div>
          <div>
            <dt>Known transactions</dt>
            <dd>
              {knownHistory ? histories.size : wallet.scannedAt ? 'Not recorded' : 'Not checked'}
            </dd>
          </div>
          <div>
            <dt>
              Loaded received outputs{' '}
              <WalletHelp title="About received outputs">
                <p>
                  Loaded outputs matching this wallet, including spent outputs. This count is not an
                  unspent balance.
                </p>
              </WalletHelp>
            </dt>
            <dd>{receivedOutputCount}</dd>
          </div>
        </dl>
        {onShowWallet && (
          <button className="text-button wallet-inspector-show" onClick={onShowWallet}>
            Show wallet matches
          </button>
        )}
      </section>
      {(wallet.scannedAt || wallet.lastActivity) && (
        <section className="panel-section wallet-inspector-last-check" aria-label="Last check">
          <h3>Last check</h3>
          {wallet.scannedAt && (
            <p className="wallet-inspector-timestamp">
              Last checked{' '}
              <time dateTime={wallet.scannedAt}>{new Date(wallet.scannedAt).toLocaleString()}</time>
            </p>
          )}
          <dl className="details">
            {wallet.lastActivity && (
              <>
                <div>
                  <dt>New to workspace</dt>
                  <dd>{wallet.lastActivity.newTransactionIds.length}</dd>
                </div>
                <div>
                  <dt>Transactions refreshed</dt>
                  <dd>{wallet.lastActivity.refreshedTransactionCount}</dd>
                </div>
              </>
            )}
            {wallet.scanGap !== undefined && (
              <div>
                <dt>Gap limit</dt>
                <dd>{wallet.scanGap}</dd>
              </div>
            )}
            {wallet.scanLimit !== undefined && (
              <div>
                <dt>Addresses / branch</dt>
                <dd>{wallet.scanLimit} max</dd>
              </div>
            )}
          </dl>
        </section>
      )}
      <details className="panel-section selection-evidence wallet-inspector-key">
        <summary>
          <span>Extended public key</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="evidence-body">
          <p className="mono wrap">{wallet.key}</p>
        </div>
      </details>
      <div
        className="panel-section wallet-inspector-removal compact-controls"
        onKeyDown={(event) => {
          if (confirmRemove && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setConfirmRemove(false);
          }
        }}
      >
        {confirmRemove ? (
          <>
            <p className="small">
              Remove {wallet.name}? Loaded transactions and annotations stay in the workspace.
            </p>
            <div className="wallet-inspector-remove-actions">
              <button ref={keepButton} onClick={() => setConfirmRemove(false)}>
                Keep wallet
              </button>
              <button className="danger" disabled={busy} onClick={onRemove}>
                Remove wallet
              </button>
            </div>
          </>
        ) : (
          <button
            ref={removeButton}
            className="text-button danger"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            Remove wallet
          </button>
        )}
      </div>
    </div>
  );
}

export const emptyAnnotation: Annotation = {
  label: '',
  note: '',
  icon: '',
  bookmarked: false,
};
interface NodeInspectorProps extends VisibilityProps {
  tagsPanel?: ReactNode;
  walletMatch?: WalletMatch;
  onSelectWallet: (id: string) => void;
  onNotify: (message: string) => void;
  walletUtxoObservation?: WalletUtxoObservation;
  w: Workspace;
  selected: GraphNode;
  tx?: Transaction;
  graph: GraphData;
  busy: boolean;
  canQuery: boolean;
  annotationKey: string;
  queryDisabledReason?: string;
  editToken?: number;
  editTarget?: 'label' | 'icon';
  onEditHandled?: () => void;
  onExpand: (direction: 'funding' | 'spending') => void;
  onSelectNode?: (id: string) => void;
  onCenter?: () => void;
  onShowAndCenter?: () => void;
  canRemove?: boolean;
  onRefresh: () => void;
  onRemove: () => void;
  onSave: (annotation: Annotation, group?: string) => void;
}
export function NodeInspector({
  tagsPanel,
  walletMatch,
  onSelectWallet,
  onNotify,
  walletUtxoObservation,
  w,
  selected,
  tx,
  graph,
  busy,
  canQuery,
  annotationKey,
  queryDisabledReason,
  editToken,
  editTarget,
  onEditHandled,
  onExpand,
  onSelectNode,
  onCenter,
  onShowAndCenter,
  canRemove,
  graphNodeIds,
  hiddenNodeIds = [],
  onSetHidden,
  onRefresh,
  onRemove,
  onSave,
}: NodeInspectorProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const loadedSpends = useMemo(() => indexLoadedSpends(w.transactions), [w.transactions]);
  const spendingByNode = useMemo(() => {
    const creatingNodes = new Map(
      graph.nodes
        .filter((node) => node.kind === 'output' && node.txid)
        .map((node) => [node.id, txNodeId(node.txid!)]),
    );
    const index = new Map<string, Set<string>>();
    // Retain the graph's exact scope and link order for transaction-level navigation.
    for (const link of graph.links) {
      if (link.kind !== 'spends') continue;
      for (const id of [link.source, creatingNodes.get(link.source)]) {
        if (!id) continue;
        const targets = index.get(id) ?? new Set<string>();
        targets.add(link.target);
        index.set(id, targets);
      }
    }
    return index;
  }, [graph]);
  const spendingNodes = useMemo(
    () =>
      [...(spendingByNode.get(selected.id) ?? [])].filter(
        (id) => id.startsWith('tx:') && !!w.transactions[id.slice(3)],
      ),
    [spendingByNode, selected.id, w.transactions],
  );
  const selectedHidden = hiddenNodeIds.includes(selected.id);
  const selectedNotOnGraph = graphNodeIds !== undefined && !graphNodeIds.includes(selected.id);
  const unavailable = busy
    ? 'Wait for the current operation to finish.'
    : queryDisabledReason ||
      (!canQuery
        ? w.demo
          ? 'Live lookups are disabled for this legacy synthetic workspace.'
          : 'Connect to a node on this workspace network to expand its paths.'
        : undefined);
  const hasPrevious = !tx || tx.vin.some((input) => !!input.txid);
  const previousReason =
    (selected.kind === 'output' && tx && !busy ? undefined : unavailable) ||
    (selected.kind === 'address' || !selected.txid
      ? 'Select a transaction or output to load its previous transactions.'
      : !hasPrevious && selected.kind !== 'output'
        ? 'Coinbase transactions do not have previous transactions.'
        : undefined);
  const selectedOutput =
    selected.kind === 'output' ? tx?.vout.find((output) => output.n === selected.vout) : undefined;
  const address = selected.address ?? (selectedOutput ? outputAddress(selectedOutput) : undefined);
  const utxo = useUtxoStatus(
    w.id,
    w.network,
    selected.kind === 'output' ? selected.txid : undefined,
    selected.kind === 'output' ? selected.vout : undefined,
    selectedOutput,
  );
  const walletObservation =
    selected.kind === 'output'
      ? matchingWalletUtxoObservation(walletUtxoObservation, w, selected.txid, selected.vout)
      : undefined;
  const showWalletObservation =
    !!walletObservation &&
    (!utxo.observation ||
      Date.parse(walletObservation.checkedAt) > Date.parse(utxo.observation.checkedAt));
  const opReturn = decodeOpReturn(selectedOutput?.scriptPubKey.hex);
  const spendingReason =
    unavailable ||
    (opReturn ? 'OP_RETURN outputs are unspendable.' : undefined) ||
    (selected.kind === 'address'
      ? 'Select a transaction or output to find spending transactions.'
      : !tx
        ? 'Load the transaction that created this output before finding its spends.'
        : undefined);
  const spendingCount = spendingNodes.length;
  const identifier = selected.id.replace(/^(tx|out|addr):/, '');
  const previousHint = !tx
    ? 'Load the transaction that created this output.'
    : selected.kind === 'output'
      ? 'Open only the transaction that created this output.'
      : "Load the source transactions of this transaction's inputs.";
  const spendingHint =
    selected.kind === 'output'
      ? 'Find transactions that spend this specific output.'
      : 'Find transactions that spend any output of this transaction.';
  const traceReasons = [...new Set([previousReason, spendingReason].filter(Boolean) as string[])];
  const cautions: string[] = [];
  if (tx) {
    if ((tx.confirmations ?? 0) < 0) cautions.push('Conflicted at fetch');
    const equal = equalOutputCount(tx);
    if (equal >= 3) cautions.push(`${equal} equal outputs, inspect carefully`);
  }
  const relatedNav = !!onSelectNode && spendingCount > 0;
  const hasEvidence = selected.kind === 'output' || !!tx || !!selected.address;
  const showRefresh = !!selected.txid && !!tx && !w.demo;
  const showRemove =
    selected.kind === 'transaction'
      ? !!tx && canRemove !== false
      : selected.kind === 'address' && canRemove === true;
  return (
    <>
      <div className="panel-section selection-heading">
        <div className="selection-top">
          <span className="eyebrow">
            {selected.kind === 'output' ? 'TRANSACTION OUTPUT' : selected.kind.toUpperCase()}
          </span>
          <div className="selection-node-actions">
            {selected.kind === 'output' && selected.txid && selected.vout !== undefined && (
              <button
                type="button"
                className="icon-button"
                aria-label="Check current UTXO status"
                aria-busy={!!utxo.loading}
                disabled={!!unavailable || utxo.loading}
                title={
                  unavailable ||
                  (utxo.loading
                    ? 'Checking UTXO status…'
                    : 'Check current UTXO status, including mempool spends')
                }
                onClick={async () => {
                  const result = await utxo.check();
                  if (!result) return;
                  const outpoint = `${short(selected.txid!)}:${selected.vout}`;
                  if (result.error) {
                    onNotify(`${outpoint}: UTXO status check failed. Try again.`);
                  } else if (result.observation) {
                    const observation = result.observation;
                    const status =
                      observation.status === 'unspent'
                        ? 'Unspent at check'
                        : 'Not in current UTXO set';
                    const detail =
                      observation.status === 'unspent'
                        ? 'Status can change.'
                        : 'May be spent or absent from this node’s chain and mempool. This does not identify a spending transaction.';
                    onNotify(
                      `${outpoint}: ${status} (${new Date(observation.checkedAt).toLocaleTimeString()}). Mempool included. ${detail}`,
                    );
                  }
                }}
              >
                <RefreshCw size={15} className={utxo.loading ? 'spin' : undefined} />
              </button>
            )}
            <VisibilityActions
              nodeId={selected.id}
              transaction={selected.kind === 'transaction' ? tx : undefined}
              graphNodeIds={graphNodeIds}
              hiddenNodeIds={hiddenNodeIds}
              onSetHidden={onSetHidden}
            />
            {onCenter && (
              <button
                type="button"
                className="icon-button"
                title="Center this node in graph"
                aria-label="Center this node in graph"
                onClick={onCenter}
                disabled={selectedHidden || selectedNotOnGraph}
              >
                <Crosshair size={15} />
              </button>
            )}
          </div>
        </div>
        {(selectedHidden || selectedNotOnGraph) && (
          <div className="selection-hidden-state">
            <span className="entity-hidden-badge">
              <EyeOff size={12} /> {selectedNotOnGraph ? 'Not on graph' : 'Hidden from graph'}
            </span>
            {onShowAndCenter && (
              <button type="button" className="text-button" onClick={onShowAndCenter}>
                {selectedNotOnGraph ? 'Add and center' : 'Show and center'}
              </button>
            )}
          </div>
        )}
        {w.annotations[selected.id]?.label && <h2>{w.annotations[selected.id].label}</h2>}
        <dl className="selection-facts">
          <div>
            <dt>
              {selected.kind === 'output'
                ? 'Outpoint'
                : selected.kind === 'address'
                  ? 'Address'
                  : 'Transaction'}
            </dt>
            <dd>
              <code
                title={identifier}
                className={selected.kind === 'output' ? 'outpoint-identity' : undefined}
              >
                {selected.kind === 'output' ? (
                  <>
                    <span>{short(selected.txid ?? '')}</span>
                    <span>:{selected.vout}</span>
                  </>
                ) : (
                  short(identifier)
                )}
              </code>
              <CopyButton
                value={identifier}
                label={
                  selected.kind === 'output'
                    ? 'Copy outpoint'
                    : selected.kind === 'address'
                      ? 'Copy address'
                      : 'Copy transaction ID'
                }
              />
            </dd>
          </div>
          {selected.kind === 'output' && selected.txid && (
            <div>
              <dt>Transaction</dt>
              <dd>
                <button
                  type="button"
                  className="text-button"
                  disabled={!!previousReason}
                  title={previousReason || `Open creating transaction: ${selected.txid}`}
                  aria-label={`Open creating transaction: ${selected.txid}`}
                  onClick={() => {
                    if (tx && onSelectNode) onSelectNode(txNodeId(tx.txid));
                    else onExpand('funding');
                  }}
                >
                  <code>{short(selected.txid)}</code>
                </button>
                <CopyButton value={selected.txid} label="Copy transaction ID" />
              </dd>
            </div>
          )}
          {selected.kind !== 'address' && (selected.kind === 'output' || address) && (
            <div>
              <dt>Address</dt>
              <dd>
                {address ? (
                  <>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!onSelectNode}
                      title={`Add and select address: ${address}`}
                      aria-label={`Add and select address: ${address}`}
                      onClick={() => onSelectNode?.(addressNodeId(address))}
                    >
                      <code>{short(address)}</code>
                    </button>
                    <CopyButton value={address} label="Copy address" />
                  </>
                ) : (
                  <span className="muted">{selectedOutput ? 'None' : 'Unknown'}</span>
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>Value</dt>
            <Amount as="dd" value={selected.value} />
          </div>
          {(tx || selected.kind === 'output') && (
            <div>
              <dt>Block</dt>
              <dd>
                <TransactionBlockTime transaction={tx} />
              </dd>
            </div>
          )}
        </dl>
        {selectedOutput && <OpReturnData hex={selectedOutput.scriptPubKey.hex} />}
        {cautions.length > 0 && (
          <p className="selection-caution">
            <TriangleAlert size={13} />
            {cautions.join(' · ')}
          </p>
        )}
        <div className="selection-trace">
          <button
            disabled={!!previousReason}
            title={previousReason || previousHint}
            onClick={() => onExpand('funding')}
          >
            <ArrowDownLeft size={13} />
            {selected.kind === 'output' ? 'Open creating tx' : 'Load previous txs'}
          </button>
          <button
            disabled={!!spendingReason}
            title={spendingReason || spendingHint}
            onClick={() => onExpand('spending')}
          >
            <ArrowUpRight size={13} />
            Find spending txs
          </button>
        </div>
        {traceReasons.map((reason) => (
          <p key={reason} className="small muted trace-reason">
            {reason}
          </p>
        ))}
        {relatedNav && (
          <div className="related-transactions">
            {spendingNodes.slice(0, 5).map((id) => (
              <button
                key={id}
                type="button"
                className="text-button"
                title={id.slice(3)}
                onClick={() => onSelectNode?.(id)}
              >
                <span>Spending tx:</span> <code>{short(id.slice(3))}</code>
              </button>
            ))}
            {spendingCount > 5 && (
              <small className="muted">
                Showing 5 of {spendingCount} loaded spending transactions.
              </small>
            )}
          </div>
        )}
      </div>
      <AnnotationEditor
        key={annotationKey}
        annotation={w.annotations[selected.id] ?? emptyAnnotation}
        editToken={editToken}
        editTarget={editTarget}
        onEditHandled={onEditHandled}
        onSave={onSave}
      >
        {tagsPanel}
      </AnnotationEditor>
      {walletMatch && (
        <section className="panel-section selection-wallet" aria-label="Wallet">
          <div className="section-title">
            <h3>Wallet</h3>
            <WalletHelp title="About wallet association">
              {walletMatch.kind === 'transaction'
                ? 'A loaded input or output matches a derived address in a listed watch-only wallet. This does not assign the whole transaction to that wallet.'
                : 'This address or output script matches a derived address in a listed watch-only wallet. This is a local script match, independent of labels and tags.'}
            </WalletHelp>
          </div>
          <span className="small muted">
            {walletMatch.kind === 'transaction'
              ? 'Matching input or output'
              : 'Address/script match'}
          </span>
          {w.wallets
            .filter((wallet) => walletMatch.walletIds.includes(wallet.id))
            .map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                className="text-button selection-wallet-link"
                onClick={() => onSelectWallet(wallet.id)}
              >
                <span className="tag-dot" style={{ backgroundColor: wallet.color }} />
                <span>{wallet.name}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            ))}
        </section>
      )}
      {hasEvidence && (
        <details
          className="panel-section selection-evidence"
          open={evidenceOpen}
          onToggle={(event) => setEvidenceOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <span>More details</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="evidence-body">
            {(walletObservation || utxo.observation) && (
              <section className="utxo-status" aria-label="Current UTXO status">
                {showWalletObservation && walletObservation ? (
                  <div>
                    <strong>Unspent at wallet check</strong>
                    <small>
                      <time dateTime={walletObservation.checkedAt}>
                        {new Date(walletObservation.checkedAt).toLocaleString()}
                      </time>
                      {' · Status can change'}
                    </small>
                  </div>
                ) : (
                  utxo.observation && (
                    <div>
                      <strong>
                        {utxo.observation.status === 'unspent'
                          ? 'Unspent at check'
                          : 'Not in current UTXO set'}
                      </strong>
                      <small>
                        Checked{' '}
                        <time dateTime={utxo.observation.checkedAt}>
                          {new Date(utxo.observation.checkedAt).toLocaleString()}
                        </time>
                        {' · Mempool included'}
                      </small>
                      <small>
                        {utxo.observation.status === 'unspent'
                          ? 'Snapshot from your node; status can change.'
                          : 'May be spent or absent from this node’s chain and mempool. This does not identify a spending transaction.'}
                      </small>
                    </div>
                  )
                )}
              </section>
            )}
            {selected.kind === 'output' && (
              <dl className="details">
                <div>
                  <dt>Output index</dt>
                  <dd>{selected.vout ?? 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Script type</dt>
                  <dd>{selectedOutput?.scriptPubKey.type ?? 'Unknown'}</dd>
                </div>
              </dl>
            )}
            {tx && (
              <dl className="details">
                <div>
                  <dt>Inputs / outputs</dt>
                  <dd>
                    {tx.vin.length} / {tx.vout.length}
                  </dd>
                </div>
                <div>
                  <dt>State at fetch</dt>
                  <dd title={transactionStatus(tx).title}>
                    {tx.confirmations && tx.confirmations > 0
                      ? `${tx.confirmations} confirmations`
                      : transactionStatus(tx).label}
                  </dd>
                </div>
                {tx.vsize && (
                  <div>
                    <dt>Virtual size</dt>
                    <dd>{tx.vsize.toLocaleString()} vB</dd>
                  </div>
                )}
                {equalOutputCount(tx) >= 3 && (
                  <div>
                    <dt>Equal outputs</dt>
                    <dd>{equalOutputCount(tx)} · inspect carefully</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </details>
      )}
      <ScriptInspector
        key={`scripts:${w.id}`}
        workspace={w}
        selected={selected}
        loadedSpends={loadedSpends}
        canQuery={canQuery && !busy}
      />
      {(showRefresh || showRemove) && (
        <div className="panel-section selection-footer">
          {showRefresh && (
            <button
              className="text-button"
              disabled={!!unavailable}
              title={unavailable}
              onClick={onRefresh}
            >
              <RefreshCw size={13} />
              Refresh transaction
            </button>
          )}
          {showRemove && (
            <button className="text-button danger" disabled={busy} onClick={onRemove}>
              {selected.kind === 'address'
                ? 'Stop watching address'
                : 'Remove transaction from workspace'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
