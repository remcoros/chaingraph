import { transactionStatus } from '../domain/transactionStatus';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Crosshair,
  EyeOff,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import {
  formatSats,
  short,
  txNodeId,
  type Annotation,
  type Wallet,
  type Workspace,
  type Transaction,
  type GraphNode,
  type GraphData,
} from '../domain/types';
import { equalOutputCount } from '../domain/analysis';
import { outputAddress } from '../domain/workspace';
import { walletActivitySummary, walletCheckAge } from '../domain/walletActivity';
import { CopyButton } from './CopyButton';
import { VisibilityActions, type VisibilityProps } from './VisibilityActions';
import { ScriptInspector } from './ScriptInspector';
import { IconPicker } from './IconPicker';
import { OpReturnData } from './OpReturnData';
import { decodeOpReturn } from '../domain/opReturn';

export function AnnotationEditor({
  annotation,
  onSave,
  editToken,
  editTarget,
  onEditHandled,
}: {
  annotation: Annotation;
  editToken?: number;
  editTarget?: 'label' | 'icon';
  onEditHandled?: () => void;
  onSave: (a: Annotation, group?: string) => void;
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
      aria-label="Label and notes"
      onFocusCapture={() => {
        editGroup.current = crypto.randomUUID();
      }}
    >
      <div className="section-title">
        <h3>Label and notes</h3>
        <small className="muted">Saves automatically</small>
      </div>
      <label>
        Label
        <input
          ref={labelRef}
          aria-label="Node label"
          maxLength={200}
          placeholder="Give this a meaningful name"
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
          placeholder="What do you know about this?"
          value={annotation.note}
          onChange={(e) => {
            onSave({ ...annotation, note: e.target.value }, editGroup.current);
          }}
        />
      </label>
      <div className="annotation-actions">
        <IconPicker
          value={annotation.icon}
          openToken={editTarget === 'icon' ? editToken : undefined}
          onOpenHandled={onEditHandled}
          onChange={(icon) => {
            onSave({ ...annotation, icon }, editGroup.current);
          }}
        />
        <label className="switch-label">
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
  onRemove,
}: {
  wallet: Wallet;
  workspace: Workspace;
  busy: boolean;
  canQuery: boolean;
  onScan: () => void;
  onShowActivity: () => void;
  onShowWallet?: () => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const addresses = new Set(wallet.addresses.map((a) => a.address));
  const outputs = Object.values(workspace.transactions).flatMap((t) =>
    t.vout.filter((o) => addresses.has(outputAddress(o) ?? '')),
  );
  const histories = new Set(
    wallet.addresses.flatMap((a) => a.history?.map((h) => h.tx_hash) ?? []),
  );
  return (
    <div className="panel-section">
      <span className="eyebrow">WATCH-ONLY WALLET</span>
      <h2>{wallet.name}</h2>
      <div className="wallet-refresh-summary">
        <button className="primary" disabled={busy || !canQuery} onClick={onScan}>
          <RefreshCw size={15} />
          {wallet.scannedAt ? 'Refresh wallet' : 'Scan wallet'}
        </button>
        <p
          className="small muted"
          title={wallet.scannedAt ? new Date(wallet.scannedAt).toLocaleString() : undefined}
        >
          {walletCheckAge(wallet.scannedAt)}
          {wallet.scannedAt && (
            <small>Last checked {new Date(wallet.scannedAt).toLocaleString()}</small>
          )}
        </p>
        {wallet.lastActivity && (
          <p className="small">Last check: {walletActivitySummary(wallet)}</p>
        )}
        {!!wallet.unreviewedTransactionIds?.length && (
          <button onClick={onShowActivity} title="Transactions loaded since your last review">
            Show new activity ({wallet.unreviewedTransactionIds.length})
          </button>
        )}
        {wallet.activityOverflow && (
          <p className="small warning">
            Showing the latest 10,000 unreviewed transactions. Earlier loaded transactions remain in
            the full graph.
          </p>
        )}
        {!!wallet.lastActivity?.missingTransactionCount && (
          <p className="warning small">
            {wallet.lastActivity.missingTransactionCount} previously observed transactions are
            absent from checked histories. Saved transactions and annotations remain in the graph.
            This can follow a replacement, removal or chain reorganization.
          </p>
        )}
        {wallet.scannedAt && (
          <p className={`scan-result ${wallet.scanComplete ? '' : 'warning'}`}>
            {wallet.scanComplete
              ? 'Gap limit reached on both branches.'
              : 'Partial scan: increase limits or refresh to continue.'}
            <small>
              {wallet.scanGap ? `${wallet.scanGap} unused addresses · ` : ''}
              {wallet.scanLimit} addresses maximum per branch
            </small>
            {!!wallet.pendingTransactionIds?.length && (
              <small>
                {wallet.pendingTransactionIds.length} transaction downloads queued for the next
                refresh.
              </small>
            )}
          </p>
        )}
      </div>
      {onShowWallet && (
        <button className="text-button" onClick={onShowWallet}>
          Show wallet matches
        </button>
      )}
      <details className="wallet-key-details">
        <summary>Extended public key</summary>
        <p className="mono muted wrap small">{wallet.key}</p>
      </details>
      <dl className="details">
        <div>
          <dt>Address type</dt>
          <dd>{wallet.scriptType}</dd>
        </div>
        <div>
          <dt>Discovered addresses</dt>
          <dd>{wallet.addresses.length}</dd>
        </div>
        <div>
          <dt>History transactions</dt>
          <dd>{histories.size}</dd>
        </div>
        <div>
          <dt>Loaded received outputs</dt>
          <dd>{outputs.length}</dd>
        </div>
      </dl>
      <p className="small muted">
        Received outputs include spent outputs; this is not a wallet balance.
      </p>
      <div className="wallet-addresses">
        <h3>Discovered addresses</h3>
        {wallet.addresses
          .filter((a) => a.history?.length)
          .slice(0, 30)
          .map((a) => (
            <div className="wallet-address" key={a.address}>
              <span className="mono">{short(a.address, 9)}</span>
              <small>
                {a.branch === 0 ? 'Receive' : 'Change'} / {a.index} · {a.history?.length} tx
              </small>
            </div>
          ))}
        {!wallet.addresses.some((a) => a.history?.length) && (
          <p className="muted small">Used addresses appear after scanning.</p>
        )}
      </div>
      {confirmRemove ? (
        <div className="stack">
          <p className="small">
            Remove this wallet? Loaded transactions and annotations stay in the workspace.
          </p>
          <button className="danger" onClick={onRemove}>
            Remove wallet
          </button>
          <button onClick={() => setConfirmRemove(false)}>Keep wallet</button>
        </div>
      ) : (
        <button
          className="text-button danger"
          disabled={busy}
          onClick={() => setConfirmRemove(true)}
        >
          Remove wallet
        </button>
      )}
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
  hiddenNodeIds = [],
  onSetHidden,
  onRefresh,
  onRemove,
  onSave,
}: NodeInspectorProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const selectedHidden = hiddenNodeIds.includes(selected.id);
  const unavailable = busy
    ? 'Wait for the current operation to finish.'
    : queryDisabledReason ||
      (!canQuery
        ? w.demo
          ? 'Live node queries are unavailable for synthetic laboratory data.'
          : 'Connect to a node on this workspace network to expand its paths.'
        : undefined);
  const hasPrevious = !tx || tx.vin.some((input) => !!input.txid);
  const previousReason =
    unavailable ||
    (selected.kind === 'address' || !selected.txid
      ? 'Select a transaction or output to load its previous transactions.'
      : !hasPrevious
        ? 'Coinbase transactions do not have previous transactions.'
        : undefined);
  const selectedOutput =
    selected.kind === 'output' ? tx?.vout.find((output) => output.n === selected.vout) : undefined;
  const opReturn = decodeOpReturn(selectedOutput?.scriptPubKey.hex);
  const spendingReason =
    unavailable ||
    (opReturn ? 'OP_RETURN outputs are unspendable.' : undefined) ||
    (selected.kind === 'address'
      ? 'Select a transaction or output to find spending transactions.'
      : !tx
        ? 'Load the transaction that created this output before finding its spends.'
        : undefined);
  const sources = new Set(
    selected.kind === 'output'
      ? [selected.id]
      : graph.nodes
          .filter((node) => node.kind === 'output' && node.txid === selected.txid)
          .map((node) => node.id),
  );
  const spendingNodes = [
    ...new Set(
      graph.links
        .filter((link) => link.kind === 'spends' && sources.has(link.source))
        .map((link) => link.target),
    ),
  ].filter((id) => id.startsWith('tx:') && !!w.transactions[id.slice(3)]);
  const spendingCount = spendingNodes.length;
  const identifier = selected.id.replace(/^(tx|out|addr):/, '');
  const previousHint = !tx
    ? 'Load the transaction that created this output.'
    : selected.kind === 'output'
      ? "Load the inputs of this output's creating transaction."
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
  const relatedNav = !!onSelectNode && (spendingCount > 0 || (selected.kind === 'output' && !!tx));
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
            <VisibilityActions
              nodeId={selected.id}
              transaction={selected.kind === 'transaction' ? tx : undefined}
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
                disabled={selectedHidden}
              >
                <Crosshair size={15} />
              </button>
            )}
          </div>
        </div>
        {selectedHidden && (
          <div className="selection-hidden-state">
            <span className="entity-hidden-badge">
              <EyeOff size={12} /> Hidden from graph
            </span>
            {onShowAndCenter && (
              <button type="button" className="text-button" onClick={onShowAndCenter}>
                Show and center
              </button>
            )}
          </div>
        )}
        {w.annotations[selected.id]?.label && <h2>{w.annotations[selected.id].label}</h2>}
        <dl className="selection-facts">
          {selected.address && selected.kind !== 'address' && (
            <div>
              <dt>Address</dt>
              <dd>
                <code title={selected.address}>{short(selected.address, 12)}</code>
                <CopyButton value={selected.address} label="Copy address" />
              </dd>
            </div>
          )}
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
                    <span>{short(selected.txid ?? '', 8)}</span>
                    <span>:{selected.vout}</span>
                  </>
                ) : (
                  short(identifier, 12)
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
          <div>
            <dt>Value</dt>
            <dd>{formatSats(selected.value)}</dd>
          </div>
          {tx && (
            <div>
              <dt>Chain status</dt>
              <dd title={transactionStatus(tx).title}>{transactionStatus(tx).label}</dd>
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
        {selected.kind !== 'address' && (
          <p className="small muted spending-note">
            {opReturn
              ? 'OP_RETURN · Unspendable output'
              : spendingCount
                ? `${spendingCount} spending transaction${spendingCount === 1 ? ' is' : 's are'} loaded ${selected.kind === 'output' ? 'for this output' : 'across these outputs'}. Current chain status may differ.`
                : 'Spend status unknown. No spending transaction loaded.'}
          </p>
        )}
        <div className="selection-trace">
          <button
            disabled={!!previousReason}
            title={previousReason || previousHint}
            onClick={() => onExpand('funding')}
          >
            <ArrowDownLeft size={14} />
            Load previous transactions
          </button>
          <button
            disabled={!!spendingReason}
            title={spendingReason || spendingHint}
            onClick={() => onExpand('spending')}
          >
            <ArrowUpRight size={14} />
            Find spending transactions
          </button>
        </div>
        {traceReasons.map((reason) => (
          <p key={reason} className="small muted trace-reason">
            {reason}
          </p>
        ))}
        {relatedNav && (
          <div className="related-transactions">
            {selected.kind === 'output' && tx && (
              <button
                type="button"
                className="text-button mono"
                title={tx.txid}
                onClick={() => onSelectNode?.(txNodeId(tx.txid))}
              >
                Creating transaction: {short(tx.txid, 6)}
              </button>
            )}
            {spendingNodes.slice(0, 5).map((id) => (
              <button
                key={id}
                type="button"
                className="text-button mono"
                title={id.slice(3)}
                onClick={() => onSelectNode?.(id)}
              >
                Spending transaction: {short(id.slice(3), 6)}
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
      />
      {tagsPanel}
      {hasEvidence && (
        <details
          className="panel-section selection-evidence"
          open={evidenceOpen}
          onToggle={(event) => setEvidenceOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <span>Chain evidence</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="evidence-body">
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
        key={`scripts:${w.id}:${selected.id}`}
        workspace={w}
        selected={selected}
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
