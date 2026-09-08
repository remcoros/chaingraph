import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  Crosshair,
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
import { CopyButton } from './CopyButton';
import { IconPicker } from './IconPicker';

export function AnnotationEditor({
  annotation,
  onSave,
  editToken,
  onEditHandled,
}: {
  annotation: Annotation;
  editToken?: number;
  onEditHandled?: () => void;
  onSave: (a: Annotation) => void;
}) {
  const [draft, setDraft] = useState(annotation);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const baseline = useRef(annotation);
  const labelRef = useRef<HTMLInputElement>(null);
  const previousEditToken = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (editToken && editToken !== previousEditToken.current) {
      labelRef.current?.focus();
      onEditHandled?.();
    }
    previousEditToken.current = editToken;
  }, [editToken]);
  useEffect(() => {
    if (JSON.stringify(annotation) === JSON.stringify(baseline.current)) return;
    if (
      JSON.stringify(draft) !== JSON.stringify(baseline.current) &&
      JSON.stringify(draft) !== JSON.stringify(annotation)
    ) {
      baseline.current = annotation;
      setConflict(true);
      return;
    }
    baseline.current = annotation;
    setDraft(annotation);
    setConflict(false);
  }, [annotation]);
  return (
    <form
      className="panel-section annotation-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
        setSaved(true);
        setConflict(false);
      }}
    >
      {conflict && (
        <div className="annotation-conflict" role="status">
          <p>
            Saved context changed while you were editing. Your draft is preserved. Saving replaces
            the saved context.
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft(annotation);
              setConflict(false);
              setSaved(false);
            }}
          >
            Reload saved context
          </button>
        </div>
      )}
      <div className="section-title">
        <h3>Label and notes</h3>
        <Bookmark size={15} />
      </div>
      <label>
        Label
        <input
          ref={labelRef}
          aria-label="Node label"
          maxLength={200}
          placeholder="Give this a meaningful name"
          value={draft.label}
          onChange={(e) => {
            setDraft({ ...draft, label: e.target.value });
            setSaved(false);
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
          value={draft.note}
          onChange={(e) => {
            setDraft({ ...draft, note: e.target.value });
            setSaved(false);
          }}
        />
      </label>
      <div className="annotation-actions">
        <IconPicker
          value={draft.icon}
          onChange={(icon) => {
            setDraft({ ...draft, icon });
            setSaved(false);
          }}
        />
        <label className="switch-label">
          <input
            type="checkbox"
            checked={draft.bookmarked}
            onChange={(e) => setDraft({ ...draft, bookmarked: e.target.checked })}
          />
          Bookmark
        </label>
        <button type="submit" className="primary annotation-save">
          {saved ? (
            <>
              <Check size={15} />
              Saved
            </>
          ) : (
            'Save context'
          )}
        </button>
      </div>
    </form>
  );
}
export function WalletInspector({
  wallet,
  workspace,
  busy,
  canQuery,
  onScan,
  onRemove,
}: {
  wallet: Wallet;
  workspace: Workspace;
  busy: boolean;
  canQuery: boolean;
  onScan: () => void;
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
      <p className="mono muted wrap small">{wallet.key}</p>
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
      <button className="primary" disabled={busy || !canQuery} onClick={onScan}>
        <RefreshCw size={15} />
        {wallet.scannedAt ? 'Rescan wallet' : 'Scan wallet'}
      </button>
      {wallet.scannedAt && (
        <p className={`scan-result ${wallet.scanComplete ? '' : 'warning'}`}>
          {wallet.scanComplete
            ? 'Gap limit reached on both branches.'
            : 'Partial scan: increase limits or continue scanning.'}
          <small>Last scan {new Date(wallet.scannedAt).toLocaleString()}</small>
        </p>
      )}
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
interface NodeInspectorProps {
  w: Workspace;
  selected: GraphNode;
  tx?: Transaction;
  graph: GraphData;
  busy: boolean;
  canQuery: boolean;
  annotationKey: string;
  queryDisabledReason?: string;
  editToken?: number;
  onEditHandled?: () => void;
  onExpand: (direction: 'funding' | 'spending') => void;
  onSelectNode?: (id: string) => void;
  onCenter?: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onSave: (annotation: Annotation) => void;
}
export function NodeInspector({
  w,
  selected,
  tx,
  graph,
  busy,
  canQuery,
  annotationKey,
  queryDisabledReason,
  editToken,
  onEditHandled,
  onExpand,
  onSelectNode,
  onCenter,
  onRefresh,
  onRemove,
  onSave,
}: NodeInspectorProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
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
  const spendingReason =
    unavailable ||
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
  const selectedOutput =
    selected.kind === 'output' ? tx?.vout.find((output) => output.n === selected.vout) : undefined;
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
  const showRemove = selected.kind === 'transaction' && !!tx;
  return (
    <>
      <div className="panel-section selection-heading">
        <div className="selection-top">
          <span className="eyebrow">
            {selected.kind === 'output' ? 'TRANSACTION OUTPUT' : selected.kind.toUpperCase()}
          </span>
          {onCenter && (
            <button
              type="button"
              className="icon-button"
              title="Center this node in graph"
              aria-label="Center this node in graph"
              onClick={onCenter}
            >
              <Crosshair size={15} />
            </button>
          )}
        </div>
        <h2>{w.annotations[selected.id]?.label || selected.label}</h2>
        <div className="identifier-row">
          <code className="wrap">{identifier}</code>
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
        </div>
        <div className="selection-value">{formatSats(selected.value)}</div>
        {cautions.length > 0 && (
          <p className="selection-caution">
            <TriangleAlert size={13} />
            {cautions.join(' · ')}
          </p>
        )}
        {selected.kind !== 'address' && (
          <p className="small muted spending-note">
            {spendingCount
              ? `${spendingCount} spending transaction${spendingCount === 1 ? ' is' : 's are'} loaded ${selected.kind === 'output' ? 'for this output' : 'across these outputs'}. Current chain status may differ.`
              : 'No spending transaction is loaded. This does not establish that these coins are unspent.'}
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
        onEditHandled={onEditHandled}
        onSave={onSave}
      />
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
            {selected.address && (
              <label className="detail-label">
                Address
                <code className="wrap">{selected.address}</code>
              </label>
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
                  <dd>
                    {(tx.confirmations ?? 0) < 0
                      ? 'Conflicted at fetch'
                      : tx.confirmations
                        ? `${tx.confirmations} confirmations`
                        : 'Unconfirmed / unknown'}
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
              Remove transaction from graph
            </button>
          )}
        </div>
      )}
    </>
  );
}
