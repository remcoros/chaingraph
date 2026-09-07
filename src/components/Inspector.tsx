import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bookmark, Check, RefreshCw } from 'lucide-react';
import {
  formatSats,
  short,
  type Annotation,
  type Wallet,
  type Workspace,
  type Transaction,
  type GraphNode,
  type GraphData,
} from '../domain/types';
import { equalOutputCount } from '../domain/analysis';
import { outputAddress } from '../domain/workspace';

export function AnnotationEditor({
  annotation,
  onSave,
}: {
  annotation: Annotation;
  onSave: (a: Annotation) => void;
}) {
  const [draft, setDraft] = useState(annotation);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(annotation);
  }, [annotation]);
  return (
    <form
      className="panel-section annotation-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
        setSaved(true);
      }}
    >
      <div className="section-title">
        <h3>Your context</h3>
        <Bookmark size={15} />
      </div>
      <label>
        Label
        <input
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
          rows={4}
          maxLength={10000}
          placeholder="What do you know about this?"
          value={draft.note}
          onChange={(e) => {
            setDraft({ ...draft, note: e.target.value });
            setSaved(false);
          }}
        />
      </label>
      <div className="annotation-options">
        <label>
          Icon
          <select
            aria-label="Node icon"
            value={draft.icon}
            onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
          >
            <option value="">None</option>
            <option value="★">★ Star</option>
            <option value="◇">◇ Diamond</option>
            <option value="⚑">⚑ Flag</option>
            <option value="?">? Question</option>
          </select>
        </label>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={draft.bookmarked}
            onChange={(e) => setDraft({ ...draft, bookmarked: e.target.checked })}
          />
          Bookmark
        </label>
      </div>
      <button type="submit" className="primary">
        {saved ? (
          <>
            <Check size={15} />
            Saved
          </>
        ) : (
          'Save context'
        )}
      </button>
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
            : 'Partial scan — increase limits or continue scanning.'}
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
  onExpand: (direction: 'funding' | 'spending') => void;
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
  onExpand,
  onRefresh,
  onRemove,
  onSave,
}: NodeInspectorProps) {
  return (
    <>
      <div className="panel-section selection-heading">
        <span className="eyebrow">
          {selected.kind === 'output' ? 'TRANSACTION OUTPUT' : selected.kind.toUpperCase()}
        </span>
        <h2>{w.annotations[selected.id]?.label || selected.label}</h2>
        <code className="wrap">{selected.id.replace(/^(tx|out|addr):/, '')}</code>
        <div className="selection-value">{formatSats(selected.value)}</div>
        {selected.address && (
          <label className="detail-label">
            Address
            <code className="wrap">{selected.address}</code>
          </label>
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
        {selected.kind === 'output' && (
          <p className="small muted">
            {graph.links.some((l) => l.source === selected.id && l.kind === 'spends')
              ? 'Spending transaction is loaded.'
              : 'Spend status unknown until spending history is checked.'}
          </p>
        )}
        <div className="button-row">
          <button
            disabled={!canQuery || busy || !tx || selected.kind === 'address'}
            onClick={() => onExpand('funding')}
          >
            <ArrowDownLeft size={14} />
            Funding
          </button>
          <button
            disabled={!canQuery || busy || !tx || selected.kind === 'address'}
            onClick={() => onExpand('spending')}
          >
            <ArrowUpRight size={14} />
            Spending
          </button>
        </div>
        {selected.txid && (
          <button className="text-button" disabled={!canQuery || busy} onClick={onRefresh}>
            <RefreshCw size={13} />
            {tx ? 'Refresh transaction' : 'Load funding transaction'}
          </button>
        )}
        {selected.kind === 'transaction' && tx && (
          <button className="text-button danger" disabled={busy} onClick={onRemove}>
            Remove transaction from graph
          </button>
        )}
      </div>
      <AnnotationEditor
        key={annotationKey}
        annotation={w.annotations[selected.id] ?? emptyAnnotation}
        onSave={onSave}
      />
    </>
  );
}
