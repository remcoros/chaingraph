import { Amount } from '../../../../Controls/Display/Amount';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Filter,
  Info,
  Network,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { short } from '../../../../../Core/Formatting';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { WorkspaceTag } from '../../../../../Core/Workspace/Annotations/annotations';

import {
  isCompletedReview,
  type WalletReviewItem,
} from '../../../../../Core/Workspace/Wallets/walletReview';
import {
  buildWalletReviewContext,
  orderWalletContextTransactions,
  type WalletReviewFlowEntry,
} from '../walletReviewContext';
import { walletRowFinding, walletRowRelationship, type WalletRow } from '../walletRows';
import { useTransactionFetch } from '../../../TransactionFetchProvider';
import { useWalletFlowInputs } from './useWalletFlowInputs';
import { BatchMetadataBar } from './BatchMetadataBar';
import { WalletReference } from '../WalletReference';
import { CopyButton } from '../../../../Controls/CopyButton';
import { TransactionBlockTime } from '../../../../Controls/Display/TransactionBlockTime';
import { WalletReviewFlow } from './WalletReviewFlow';
import { WalletHelp } from '../../../../Controls/Display/WalletHelp';
import type { WalletWorkbenchContext } from '../walletWorkbenchContext';
import type {
  WalletSelectionIndex,
  WalletSelectionAddresses,
} from '../../../../../Core/Workspace/Wallets/walletSelectionIndex';
import { walletRelatedRecords, walletRelatedDescription } from './walletRelatedRecords';
import { walletReviewGuidance, walletSubjectTitle } from './walletReviewGuidance';

export type WalletDecisionAction = 'reviewed' | 'later' | 'reopen';

/** The selected context already receives indexes and verified addresses. */
function selectedWalletReviewContext(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  },
  wallet: Pick<Wallet, 'addresses'>,
  subject: { nodeId: string; txid?: string; nodeIds?: readonly string[]; reason?: string },
  contextId: string,
  selectionIndex: WalletSelectionIndex,
  walletAddresses: WalletSelectionAddresses,
) {
  return buildWalletReviewContext(
    workspace,
    wallet,
    subject,
    contextId,
    selectionIndex,
    walletAddresses,
  );
}

function selectedWalletRelatedRecords(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
    analysis: Pick<Workspace['analysis'], 'findings'>;
  },
  row: WalletRow,
  selectionIndex: WalletSelectionIndex,
) {
  return walletRelatedRecords(workspace, row, selectionIndex);
}

export function WalletDecisionButtons({
  items,
  busy,
  onDecide,
}: {
  items: readonly WalletReviewItem[];
  busy: boolean;
  onDecide: (items: readonly WalletReviewItem[], action: WalletDecisionAction) => void;
}) {
  const actionable = items.filter((item) => !item.legacyOutputReview);
  if (!actionable.length) return null;
  const completed = actionable.every(
    (item) => !item.changed && item.status !== 'open' && isCompletedReview({ status: item.status }),
  );
  const later = actionable.every((item) => !item.changed && item.status === 'later');
  return (
    <div className="button-row wallet-review-decisions">
      {completed ? (
        <button
          disabled={busy}
          title="Return these decisions to To review"
          onClick={() => onDecide(actionable, 'reopen')}
        >
          <Undo2 size={14} /> Reopen
        </button>
      ) : (
        <>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onDecide(actionable, 'reviewed')}
          >
            Mark reviewed
          </button>
          <button
            disabled={busy}
            aria-pressed={later}
            title={later ? 'Return to To review' : 'Set aside without completing the review'}
            onClick={() => onDecide(actionable, later ? 'reopen' : 'later')}
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
  selectionIndex,
  walletAddresses,
  tags = [],
  workspace,
  wallet,
  active,
  tourPreview,
  busy,
  canLoadChainData,
  updateEvidence,
  onChange,
  onNotice,
  onDecide,
  onShowInGraph,
  onIsolateInGraph,
  relatedSelection,
  resolveInputs = true,
  reviewMode = true,
  onOpenReviewItem,
}: Pick<
  WalletWorkbenchContext,
  | 'active'
  | 'tourPreview'
  | 'busy'
  | 'canLoadChainData'
  | 'updateEvidence'
  | 'onChange'
  | 'onShowInGraph'
  | 'onIsolateInGraph'
> & {
  row: WalletRow;
  selectionIndex: WalletSelectionIndex;
  walletAddresses: WalletSelectionAddresses;
  tags?: WorkspaceTag[];
  workspace: Workspace;
  wallet: Wallet;
  onNotice: (message: string) => void;
  onDecide: (items: readonly WalletReviewItem[], action: WalletDecisionAction) => void;
  relatedSelection?: ReactNode;
  resolveInputs?: boolean;
  reviewMode?: boolean;
  onOpenReviewItem?: (row: WalletRow, item: WalletReviewItem) => void;
}) {
  const fetchTransaction = useTransactionFetch('visible');
  const [chosenContext, setChosenContext] = useState('');
  const [flowOpen, setFlowOpen] = useState(false);
  const flowId = useId();
  const [evidenceLimits, setEvidenceLimits] = useState({
    inputs: 20,
    outputs: 20,
    transactions: 20,
  });
  const [visible, setVisible] = useState<{
    transactionId?: string;
    inputs: readonly WalletReviewFlowEntry[];
  }>({ inputs: [] });
  const contextTransactionIds = useMemo(
    () => orderWalletContextTransactions(row.contextTransactionIds, selectionIndex.transactions),
    [row.contextTransactionIds, selectionIndex],
  );
  const contextId = contextTransactionIds.includes(chosenContext)
    ? chosenContext
    : contextTransactionIds[0];
  const hasUnloadedHistory =
    !contextId &&
    row.kind === 'address' &&
    wallet.addresses.some(
      (entry) =>
        entry.address === row.address &&
        entry.history?.some((transaction) => !selectionIndex.transactions.has(transaction.tx_hash)),
    );
  const contextReview = reviewMode ? row.reviews[0] : undefined;
  const contextReviewNodeId = contextReview?.nodeId;
  const contextReviewTxid = contextReview?.txid;
  const contextReviewNodeIds = contextReview?.nodeIds;
  const contextReviewReason = contextReview?.reason;
  const context = useMemo(
    () =>
      contextId
        ? selectedWalletReviewContext(
            {
              network: workspace.network,
              chainData: { transactions: workspace.chainData.transactions },
            },
            { addresses: wallet.addresses },
            {
              nodeId: contextReviewNodeId ?? row.nodeId,
              txid: contextReviewTxid ?? row.txid,
              nodeIds: contextReviewNodeIds,
              reason: contextReviewReason,
            },
            contextId,
            selectionIndex,
            walletAddresses,
          )
        : undefined,
    [
      workspace.network,
      workspace.chainData.transactions,
      wallet.addresses,
      contextReviewNodeId,
      contextReviewTxid,
      contextReviewNodeIds,
      contextReviewReason,
      row.nodeId,
      row.txid,
      contextId,
      selectionIndex,
      walletAddresses,
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
    prevouts: selectionIndex.prevouts,
    walletId: wallet.id,
    selectionKey: row.key,
    transactionId: contextId,
    inputs: visible.transactionId === contextId ? visible.inputs : [],
    enabled: active && canLoadChainData && !busy && flowOpen && resolveInputs,
    fetch: fetchTransaction,
    update: updateEvidence,
  });
  const annotation = workspace.annotations.entities[row.nodeId];
  const awaitingAddress =
    row.kind === 'output' &&
    !row.address &&
    flowOpen &&
    canLoadChainData &&
    !flowInputs.error &&
    context?.inputs.some((input) => input.id === row.nodeId && input.missing);
  const relationship = walletRowRelationship(
    row,
    wallet,
    workspace.network,
    context?.selected,
    walletAddresses,
  );
  const changed = row.reviews.find((item) => item.changed);
  const outpoints = row.outpointIds ?? [];
  const actionableReviews = reviewMode
    ? row.reviews.filter((item) => !item.legacyOutputReview)
    : [];
  const subjectTitle = walletSubjectTitle(row);
  const missingContext = !annotation?.label?.trim() && tags.length === 0;
  const completed = !changed && (row.status === 'reviewed' || row.status === 'unknown');
  const finding = reviewMode ? walletRowFinding(workspace, row) : undefined;
  const addressReuse = finding?.algorithm.replace(/-v\d+$/, '') === 'address-reuse';
  const guidedActions: ('label' | 'tags')[] = !reviewMode
    ? []
    : completed
      ? []
      : finding
        ? tags.length === 0
          ? ['tags']
          : []
        : [
            ...(!annotation?.label?.trim() ? ['label' as const] : []),
            ...(tags.length === 0 ? ['tags' as const] : []),
          ];
  const title = reviewMode
    ? finding?.title ||
      annotation?.label?.trim() ||
      (missingContext ? `${subjectTitle} without label or tags` : subjectTitle)
    : annotation?.label?.trim() || subjectTitle;
  const calloutTone =
    changed || (!completed && (missingContext || addressReuse))
      ? 'attention'
      : completed
        ? 'complete'
        : 'info';
  const GuidanceIcon = calloutTone === 'attention' ? TriangleAlert : completed ? CircleCheck : Info;
  const guidance = walletReviewGuidance(
    row,
    { label: annotation?.label, tagCount: tags.length },
    finding,
    !!relatedSelection,
  );
  const statusLabel = changed
    ? 'Evidence changed'
    : row.status === 'unknown'
      ? 'Source unknown'
      : row.status === 'reviewed'
        ? 'Reviewed'
        : row.status === 'later'
          ? 'Review later'
          : 'Not reviewed';
  const linkedReviews = [...new Map(row.reviews.map((item) => [item.key, item])).values()];
  const related = useMemo(
    () =>
      selectedWalletRelatedRecords(
        {
          network: workspace.network,
          chainData: { transactions: workspace.chainData.transactions },
          analysis: { findings: workspace.analysis.findings },
        },
        row,
        selectionIndex,
      ),
    [
      workspace.network,
      workspace.chainData.transactions,
      workspace.analysis.findings,
      row,
      selectionIndex,
    ],
  );
  return (
    <>
      <header className="wallet-subject-header wallet-detail-heading">
        <div>
          {annotation?.label && <span className="wallet-subject-kind">{subjectTitle}</span>}
          <div className="wallet-subject-title-row">
            <h2 className="wallet-item-title">
              {annotation?.icon && (
                <span className="wallet-entity-icon" aria-hidden="true">
                  {annotation.icon}
                </span>
              )}
              {title}
            </h2>
            {reviewMode && row.reviews.length > 0 && (
              <span className={`wallet-subject-status status-${changed ? 'changed' : row.status}`}>
                {statusLabel}
              </span>
            )}
          </div>
          <div className="wallet-header-reference">
            <WalletReference
              value={row.identifier}
              kind={
                row.kind === 'address'
                  ? 'address'
                  : row.kind === 'output'
                    ? 'outpoint'
                    : 'transaction ID'
              }
            />
          </div>
        </div>
        <div className="wallet-detail-graph-actions" aria-label="Graph actions">
          <button
            disabled={busy}
            aria-label="Show on graph"
            title={`Show and zoom to this ${row.kind === 'output' ? 'outpoint' : row.kind} in Graph`}
            onClick={() => onShowInGraph(row.nodeId, row.utxo)}
          >
            <Network size={13} /> Show on graph
          </button>
          <button
            disabled={busy}
            title="Show only this selection and its connected graph context"
            onClick={() => onIsolateInGraph(row.nodeId, row.utxo)}
          >
            <Filter size={13} /> Isolate
          </button>
        </div>
      </header>
      <div
        className="wallet-detail-toolbar"
        aria-label="Selected item actions"
        data-tour="wallet-item-actions"
      >
        <BatchMetadataBar
          active={active || !!tourPreview}
          workspace={workspace}
          ids={[row.nodeId]}
          single
          guidedActions={guidedActions}
          scopeLabel=""
          disabled={
            busy || awaitingAddress || (row.kind === 'output' && !row.address && flowInputs.loading)
          }
          onChange={onChange}
          onNotice={onNotice}
        />
        {reviewMode && actionableReviews.length > 0 && (
          <div className="wallet-action-group" aria-label="Review decision">
            <WalletDecisionButtons items={row.reviews} busy={busy} onDecide={onDecide} />
            {actionableReviews.length > 1 && (
              <span className="small muted">{actionableReviews.length} decisions</span>
            )}
          </div>
        )}
        {relatedSelection && (
          <div
            className={`wallet-action-group${reviewMode && !completed && finding ? ' wallet-guided-related' : ''}`}
          >
            {relatedSelection}
          </div>
        )}
      </div>
      {reviewMode && (
        <div
          className={`wallet-review-callout tone-${calloutTone}`}
          role="note"
          aria-label="Review guidance"
        >
          <GuidanceIcon size={18} aria-hidden="true" />
          <p>{guidance}</p>
        </div>
      )}
      <section className="wallet-subject-card" aria-label={`${subjectTitle} details`}>
        <dl className="wallet-review-evidence" aria-label="Identifiers and tags">
          <div className="wallet-subject-identifier">
            <dt>
              {row.kind === 'output'
                ? 'Outpoint'
                : row.kind === 'transaction'
                  ? 'Transaction ID'
                  : 'Address'}
            </dt>
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
              />
            </dd>
          </div>
          {row.address && row.kind !== 'address' && (
            <div>
              <dt>Address</dt>
              <dd className="wallet-copy-value">
                <WalletReference value={row.address} kind="address" />
              </dd>
            </div>
          )}
          {row.kind !== 'address' && row.txid && (
            <div>
              <dt>{row.kind === 'output' ? 'Creating transaction block' : 'Transaction block'}</dt>
              <dd>
                <TransactionBlockTime
                  transaction={workspace.chainData.transactions[row.txid]}
                  workspace={workspace}
                  showFee={row.kind !== 'output'}
                />
              </dd>
            </div>
          )}
          <div>
            <dt>Wallet relationship</dt>
            <dd
              className={`wallet-match-value ${relationship === 'In this wallet' ? 'is-wallet' : ''}`}
            >
              {relationship}
              <WalletHelp title="Wallet relationship" active={active}>
                Matched against this wallet's discovered addresses. No match does not rule out an
                undiscovered wallet address or identify its owner.
              </WalletHelp>
            </dd>
          </div>
          {row.kind === 'address' && row.contextTransactionIds.length > 0 && (
            <div>
              <dt>Seen in loaded data</dt>
              <dd>
                {row.contextTransactionIds.length} transaction
                {row.contextTransactionIds.length === 1 ? '' : 's'}
              </dd>
            </div>
          )}
          {row.amountSats !== undefined && (
            <div>
              <dt>
                {row.kind === 'address'
                  ? `Observed total (${outpoints.length} output${outpoints.length === 1 ? '' : 's'})`
                  : 'Amount'}
              </dt>
              <Amount as="dd" value={row.amountSats} />
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
        {annotation?.note && (
          <div className="wallet-subject-note">
            <h3>Note</h3>
            <p className="wallet-detail-note">{annotation.note}</p>
          </div>
        )}
      </section>
      {!reviewMode && (
        <section className="wallet-linked-reviews" aria-label="Review items">
          <h3>Review items</h3>
          {linkedReviews.length ? (
            <ul>
              {linkedReviews.map((item) => {
                const state = item.changed
                  ? 'Evidence changed'
                  : item.status === 'later'
                    ? 'Review later'
                    : item.status === 'reviewed'
                      ? 'Reviewed'
                      : item.status === 'unknown'
                        ? 'Source unknown'
                        : 'To review';
                const StateIcon = item.changed
                  ? TriangleAlert
                  : item.status === 'later'
                    ? Clock3
                    : item.status === 'reviewed' || item.status === 'unknown'
                      ? CircleCheck
                      : Circle;
                return (
                  <li key={item.key}>
                    <button
                      title={`${item.title}. ${state}`}
                      onClick={() => onOpenReviewItem?.(row, item)}
                    >
                      <StateIcon size={14} aria-hidden="true" />
                      <span>{item.title}</span>
                      <small>{state}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">None</p>
          )}
        </section>
      )}
      {context ? (
        <section
          className={`wallet-flow-disclosure${flowOpen ? ' is-open' : ''}`}
          aria-label="Transaction flow"
        >
          <div className="wallet-flow-titlebar">
            <button
              className="wallet-flow-toggle"
              aria-expanded={flowOpen}
              aria-controls={flowId}
              onClick={() => setFlowOpen(!flowOpen)}
            >
              <ChevronRight size={14} aria-hidden="true" /> Transaction flow
            </button>
            {contextTransactionIds.length > 1 && (
              <div className="wallet-context-chooser">
                <select
                  aria-label="Transaction context"
                  title={contextId}
                  value={contextId ?? ''}
                  onChange={(event) => setChosenContext(event.target.value)}
                >
                  {contextTransactionIds.map((txid) => (
                    <option value={txid} key={txid} title={txid}>
                      {workspace.annotations.entities[`tx:${txid}`]?.label || short(txid)}
                    </option>
                  ))}
                </select>
                {contextId && <CopyButton value={contextId} label="Copy transaction ID" />}
              </div>
            )}
          </div>
          <div id={flowId} className="wallet-flow-content" hidden={!flowOpen}>
            {flowOpen && (
              <>
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
                <div className="wallet-flow-load-state" role="status">
                  {flowInputs.loading && <span>Loading input details...</span>}
                  {flowInputs.error && (
                    <>
                      <span className="warning">Input details unavailable</span>
                      <WalletHelp title="Input loading" active={active}>
                        <p>{flowInputs.error}</p>
                      </WalletHelp>
                      <button
                        disabled={!active || !canLoadChainData || busy || flowInputs.loading}
                        onClick={flowInputs.retry}
                      >
                        Retry inputs
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      ) : (
        <div className="wallet-flow-empty" role="status">
          <Info size={16} aria-hidden="true" />
          <div>
            <span>No related transaction found in loaded data.</span>
            {hasUnloadedHistory && <span>Some wallet history is not loaded.</span>}
          </div>
        </div>
      )}
      <div className="wallet-related-grid">
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
              {ids.slice(0, evidenceLimits[key]).map((id) => {
                const description = walletRelatedDescription(workspace, row, id, selectionIndex);
                return (
                  <div key={id} className="wallet-evidence-outpoint">
                    <div className="wallet-reference-actions">
                      <WalletReference
                        value={id.replace(/^(out|tx):/, '')}
                        kind={id.startsWith('tx:') ? 'transaction ID' : 'outpoint'}
                      />
                      <button
                        className="icon-button"
                        title="Show on graph"
                        aria-label={`Show ${id.startsWith('tx:') ? 'transaction' : 'outpoint'} ${id.slice(id.indexOf(':') + 1)} on graph`}
                        onClick={() => onShowInGraph(id)}
                      >
                        <Network size={13} />
                      </button>
                    </div>
                    {description && (
                      <span className="wallet-related-description">{description}</span>
                    )}
                    {workspace.annotations.entities[id]?.label && (
                      <span
                        className="wallet-related-label"
                        title={workspace.annotations.entities[id].label}
                      >
                        {workspace.annotations.entities[id].label}
                      </span>
                    )}
                  </div>
                );
              })}
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
      </div>
    </>
  );
}
