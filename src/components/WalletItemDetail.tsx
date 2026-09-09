import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Clock3, Filter, Network, Search, Undo2 } from 'lucide-react';
import { formatSats, short, type Wallet, type Workspace } from '../domain/types';
import { isCompletedReview, type WalletReviewItem } from '../domain/walletReview';
import {
  buildWalletReviewContext,
  type WalletReviewFlowEntry,
} from '../domain/walletReviewContext';
import { walletRowTags, type WalletRow } from '../domain/walletWorkbenchRows';
import { fetchTransaction } from '../lib/api';
import { useWalletFlowInputs } from '../lib/useWalletFlowInputs';
import { BatchMetadataBar } from './BatchMetadataBar';
import { WalletReference } from './WalletReference';
import { CopyButton } from './CopyButton';
import { WalletReviewFlow } from './WalletReviewFlow';
import { WalletHelp } from './WalletHelp';
import type { WalletWorkbenchProps } from './WalletWorkbench';
import { walletRelatedRecords } from '../domain/walletRelatedRecords';

export type WalletDecisionAction = 'reviewed' | 'later' | 'reopen';

export function WalletDecisionButtons({
  items,
  busy,
  onDecide,
}: {
  items: readonly WalletReviewItem[];
  busy: boolean;
  onDecide: (items: readonly WalletReviewItem[], action: WalletDecisionAction) => void;
}) {
  if (!items.length) return null;
  const completed = items.every(
    (item) => !item.changed && item.status !== 'open' && isCompletedReview({ status: item.status }),
  );
  const later = items.every((item) => !item.changed && item.status === 'later');
  return (
    <div className="button-row wallet-review-decisions">
      {completed ? (
        <button
          disabled={busy}
          title="Return these decisions to To review"
          onClick={() => onDecide(items, 'reopen')}
        >
          <Undo2 size={14} /> Reopen
        </button>
      ) : (
        <>
          <button className="primary" disabled={busy} onClick={() => onDecide(items, 'reviewed')}>
            Mark reviewed
          </button>
          <button
            disabled={busy}
            aria-pressed={later}
            title={later ? 'Return to To review' : 'Set aside without completing the review'}
            onClick={() => onDecide(items, later ? 'reopen' : 'later')}
          >
            <Clock3 size={14} /> {later ? 'Return to review' : 'Review later'}
          </button>
        </>
      )}
    </div>
  );
}

export function WalletItemDetail({
  row,
  workspace,
  wallet,
  active,
  busy,
  canQuery,
  updateEvidence,
  onChange,
  onNotice,
  onDecide,
  onShowInGraph,
  onIsolateInGraph,
  relatedSelection,
  resolveInputs = true,
}: Pick<
  WalletWorkbenchProps,
  | 'active'
  | 'busy'
  | 'canQuery'
  | 'updateEvidence'
  | 'onChange'
  | 'onShowInGraph'
  | 'onIsolateInGraph'
> & {
  row: WalletRow;
  workspace: Workspace;
  wallet: Wallet;
  onNotice: (message: string) => void;
  onDecide: (items: readonly WalletReviewItem[], action: WalletDecisionAction) => void;
  relatedSelection?: ReactNode;
  resolveInputs?: boolean;
}) {
  const [chosenContext, setChosenContext] = useState('');
  const [flowOpen, setFlowOpen] = useState(true);
  const [evidenceLimits, setEvidenceLimits] = useState({
    inputs: 20,
    outputs: 20,
    transactions: 20,
  });
  const [visible, setVisible] = useState<{
    transactionId?: string;
    inputs: readonly WalletReviewFlowEntry[];
  }>({ inputs: [] });
  const contextId = row.contextTransactionIds.includes(chosenContext)
    ? chosenContext
    : row.kind === 'address' && row.contextTransactionIds.length > 1
      ? ''
      : row.contextTransactionIds[0];
  const context = useMemo(
    () =>
      contextId
        ? buildWalletReviewContext(
            workspace,
            wallet,
            row.reviews.find((item) => item.key === row.key) ?? {
              nodeId: row.nodeId,
              txid: row.txid,
            },
            contextId,
          )
        : undefined,
    [
      workspace.transactions,
      workspace.network,
      wallet.addresses,
      row.nodeId,
      row.key,
      row.reviews.find((item) => item.key === row.key)?.evidence,
      contextId,
    ],
  );
  const onVisibleInputsChange = useCallback(
    (inputs: readonly WalletReviewFlowEntry[]) => {
      setVisible((previous) =>
        previous.transactionId === contextId &&
        previous.inputs.map((input) => `${input.id}:${input.missing}`).join('|') ===
          inputs.map((input) => `${input.id}:${input.missing}`).join('|')
          ? previous
          : { transactionId: contextId, inputs },
      );
    },
    [contextId],
  );
  const flowInputs = useWalletFlowInputs({
    workspace,
    walletId: wallet.id,
    selectionKey: row.key,
    transactionId: contextId,
    inputs: visible.transactionId === contextId ? visible.inputs : [],
    enabled: active && canQuery && !busy && flowOpen && resolveInputs,
    fetch: fetchTransaction,
    update: updateEvidence,
  });
  const annotation = workspace.annotations[row.nodeId];
  const awaitingAddress =
    row.kind === 'output' &&
    !row.address &&
    flowOpen &&
    canQuery &&
    !flowInputs.error &&
    context?.inputs.some((input) => input.id === row.nodeId && input.missing);
  const tags = walletRowTags(workspace, row);
  const role =
    row.ownership ??
    (context?.role === 'wallet-output'
      ? 'wallet'
      : context?.role === 'possible-counterparty'
        ? 'external'
        : undefined);
  const changed = row.reviews.find((item) => item.changed);
  const outpoints = row.outpointIds ?? [];
  const related = useMemo(
    () => walletRelatedRecords(workspace, row),
    [
      workspace.transactions,
      workspace.network,
      row.nodeId,
      row.contextTransactionIds,
      row.outpointIds,
    ],
  );
  return (
    <>
      <div className="wallet-detail-toolbar" aria-label="Selected item actions">
        <BatchMetadataBar
          active={active}
          workspace={workspace}
          ids={[row.nodeId]}
          single
          scopeLabel={row.kind}
          disabled={
            busy || awaitingAddress || (row.kind === 'output' && !row.address && flowInputs.loading)
          }
          onChange={onChange}
          onNotice={onNotice}
        />
        {row.reviews.length > 0 && (
          <div className="wallet-action-group" aria-label="Review decision">
            <WalletDecisionButtons items={row.reviews} busy={busy} onDecide={onDecide} />
            {row.reviews.length > 1 && (
              <span className="small muted">{row.reviews.length} decisions</span>
            )}
          </div>
        )}
        {relatedSelection && <div className="wallet-action-group">{relatedSelection}</div>}
        <div className="wallet-action-group" aria-label="Graph actions">
          <button
            disabled={busy}
            aria-label="Show in Graph"
            title={`Show and zoom to this ${row.kind === 'output' ? 'outpoint' : row.kind} in Graph`}
            onClick={() => onShowInGraph(row.nodeId, row.utxo)}
          >
            <Network size={14} /> Show
          </button>
          <button
            disabled={busy}
            title="Show only this selection and its connected graph context"
            onClick={() => onIsolateInGraph(row.nodeId, row.utxo)}
          >
            <Filter size={14} /> Isolate
          </button>
        </div>
      </div>
      {(context || row.contextTransactionIds.length > 0) && (
        <details
          className="wallet-flow-disclosure"
          open={flowOpen}
          onToggle={(event) => setFlowOpen(event.currentTarget.open)}
        >
          <summary>Transaction flow</summary>
          {flowOpen && (
            <>
              {row.contextTransactionIds.length > 1 && (
                <label className="wallet-context-chooser">
                  Context
                  <select
                    aria-label="Transaction context"
                    title={contextId}
                    value={contextId ?? ''}
                    onChange={(event) => setChosenContext(event.target.value)}
                  >
                    {row.kind === 'address' && (
                      <option value="">
                        Choose transaction ({row.contextTransactionIds.length})
                      </option>
                    )}
                    {row.contextTransactionIds.map((txid) => (
                      <option value={txid} key={txid} title={txid}>
                        {workspace.annotations[`tx:${txid}`]?.label || short(txid, 12)}
                      </option>
                    ))}
                  </select>
                  {contextId && <CopyButton value={contextId} label="Copy transaction ID" />}
                </label>
              )}
              {context ? (
                <WalletReviewFlow
                  key={contextId}
                  context={context}
                  workspace={workspace}
                  walletName={wallet.name}
                  editedNodeId={row.nodeId}
                  onShowInGraph={onShowInGraph}
                  onVisibleInputsChange={onVisibleInputsChange}
                  active={active}
                />
              ) : (
                <p className="small muted">Choose a transaction to show its flow.</p>
              )}
              <div className="wallet-flow-load-state" role="status">
                {flowInputs.loading && <span>Loading input details...</span>}
                {flowInputs.error && (
                  <>
                    <span className="warning">Input details unavailable</span>
                    <WalletHelp title="Input loading" active={active}>
                      <p>{flowInputs.error}</p>
                    </WalletHelp>
                    <button
                      disabled={!active || !canQuery || busy || flowInputs.loading}
                      onClick={flowInputs.retry}
                    >
                      Retry inputs
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </details>
      )}
      <div className="wallet-detail-heading">
        <h2 className="wallet-item-title">
          {annotation?.icon && (
            <span className="wallet-entity-icon" aria-hidden="true">
              {annotation.icon}
            </span>
          )}
          {annotation?.label || (
            <WalletReference
              value={row.identifier}
              kind={
                row.kind === 'output'
                  ? 'outpoint'
                  : row.kind === 'transaction'
                    ? 'transaction ID'
                    : 'address'
              }
            />
          )}
        </h2>
      </div>
      <div
        className={`wallet-context-badge ${role === 'wallet' ? 'is-wallet' : ''}`}
        title={
          role === 'wallet'
            ? 'Matches a discovered address of this wallet'
            : "No match among this wallet's discovered addresses. This does not prove who controls the address."
        }
      >
        {role === 'wallet'
          ? 'Wallet match'
          : role === 'external'
            ? 'No wallet match'
            : row.kind === 'transaction'
              ? 'Wallet-related transaction'
              : 'Unresolved script'}
        {outpoints.length > 0 ? ` · ${outpoints.length} outpoints` : ''}
        {changed ? ' · evidence changed' : ''}
      </div>
      <dl className="wallet-review-evidence" aria-label="Identifiers and tags">
        {annotation?.label && (
          <div>
            <dt>{row.kind === 'output' ? 'Outpoint' : row.kind}</dt>
            <dd className="wallet-copy-value">
              <WalletReference
                value={row.identifier}
                kind={
                  row.kind === 'output'
                    ? 'outpoint'
                    : row.kind === 'transaction'
                      ? 'transaction ID'
                      : 'address'
                }
                length={14}
              />
            </dd>
          </div>
        )}
        {row.address && row.kind !== 'address' && (
          <div>
            <dt>Address</dt>
            <dd className="wallet-copy-value">
              <WalletReference value={row.address} kind="address" length={14} />
            </dd>
          </div>
        )}
        {row.amountSats !== undefined && (
          <div>
            <dt>{outpoints.length ? 'Observed output total' : 'Amount'}</dt>
            <dd>{formatSats(row.amountSats)}</dd>
          </div>
        )}
        <div>
          <dt>Tags</dt>
          <dd className="wallet-item-tags">
            {tags.length ? (
              tags.map((tag) => (
                <span className="wallet-review-record-tag" key={tag.id} title={tag.name}>
                  <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </span>
              ))
            ) : (
              <span className="muted">No tags</span>
            )}
          </dd>
        </div>
      </dl>
      {annotation?.note && <p className="wallet-detail-note">{annotation.note}</p>}
      {(
        [
          ['inputs', 'Input outpoints', related.inputs],
          [
            'outputs',
            row.kind === 'transaction' ? 'Output outpoints' : 'Related outpoints',
            related.outputs,
          ],
          ['transactions', 'Related transactions', related.transactions],
        ] as const
      )
        .filter(([, , ids]) => ids.length)
        .map(([key, title, ids]) => (
          <section className="wallet-related-records" aria-label={title} key={title}>
            <h3>
              {title} ({ids.length})
            </h3>
            {ids.slice(0, evidenceLimits[key]).map((id) => (
              <div key={id} className="wallet-evidence-outpoint">
                <WalletReference
                  value={id.replace(/^(out|tx):/, '')}
                  kind={id.startsWith('tx:') ? 'transaction ID' : 'outpoint'}
                  length={12}
                />
                {workspace.annotations[id]?.label && <span>{workspace.annotations[id].label}</span>}
                <button
                  className="icon-button"
                  title="Show on graph"
                  aria-label={`Show ${id.startsWith('tx:') ? 'transaction' : 'outpoint'} ${id.slice(id.indexOf(':') + 1)} on graph`}
                  onClick={() => onShowInGraph(id)}
                >
                  <Search size={13} />
                </button>
              </div>
            ))}
            {ids.length > evidenceLimits[key] && (
              <button
                onClick={() =>
                  setEvidenceLimits((value) => ({
                    ...value,
                    [key]: value[key] + 20,
                  }))
                }
              >
                Show more
              </button>
            )}
          </section>
        ))}
    </>
  );
}
