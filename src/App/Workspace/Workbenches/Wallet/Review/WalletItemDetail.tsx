import { Amount } from '../../../../Controls/Display/Amount';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowRightFromLine,
  Bitcoin,
  Box,
  CalendarClock,
  CircleCheck,
  Coins,
  ChevronDown,
  FileText,
  Filter,
  Info,
  ListChecks,
  Layers,
  GitBranch,
  Network,
  RefreshCw,
  Tag,
  Wallet as WalletIcon,
} from 'lucide-react';
import { formatSats, short } from '../../../../../Core/Formatting';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../../Core/Workspace/workspace';

import { type WalletReviewItem } from '../../../../../Core/Workspace/Wallets/walletReview';
import {
  buildWalletReviewContext,
  orderWalletContextTransactions,
  type WalletReviewFlowEntry,
} from '../walletReviewContext';
import { matchesWalletStatus, walletRowRelationship, type WalletRow } from '../walletRows';
import { useTransactionFetch } from '../../../TransactionFetchProvider';
import { useWalletFlowInputs } from './useWalletFlowInputs';
import { WalletCounterpartyContext } from '../WalletCounterparties';
import { WalletMetadataFields, WalletIconEdit } from '../WalletMetadataFields';
import { WalletReference } from '../WalletReference';
import { CopyButton } from '../../../../Controls/CopyButton';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';
import { TransactionTimestamp } from '../../../../Controls/Display/TransactionBlockTime';
import {
  formatLocalTimestamp,
  transactionBlockTime,
} from '../../../../Controls/Display/transactionTime';
import { RelativeTime } from '../../../../Controls/Display/RelativeTime';
import { transactionFee } from '../../../../Controls/Display/transactionFee';
import { WalletReviewFlow } from './WalletReviewFlow';
import { WalletHelp } from '../../../../Controls/Display/WalletHelp';
import type { WalletWorkbenchContext } from '../walletWorkbenchContext';
import type {
  WalletSelectionIndex,
  WalletSelectionAddresses,
} from '../../../../../Core/Workspace/Wallets/walletSelectionIndex';
import { walletRelatedRecords, walletRelatedDescription } from './walletRelatedRecords';
import { transactionStatus } from '../../../../Controls/Display/transactionStatus';
import { walletOutputEvidence } from '../../../../../Core/Workspace/Wallets/walletOutputEvidence';
import { walletSubjectTitle } from './walletReviewGuidance';
import { addressBalanceSats } from '../../../../../Core/ChainData/observations';
import { walletRecordBlockObservation } from '../../../../../Core/Workspace/Wallets/walletRecordBlockObservation';
import {
  WalletFieldReview,
  WalletReviewChecklist,
  type WalletDecisionAction,
} from './WalletReviewInteractions';

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

type WalletDetailProps = Pick<
  WalletWorkbenchContext,
  | 'active'
  | 'tourPreview'
  | 'busy'
  | 'canLoadChainData'
  | 'updateEvidence'
  | 'onChange'
  | 'onShowInGraph'
  | 'onIsolateInGraph'
  | 'onRefreshAddressBalance'
> & {
  row: WalletRow;
  selectionIndex: WalletSelectionIndex;
  walletAddresses: WalletSelectionAddresses;
  workspace: Workspace;
  wallet: Wallet;
  onNotice: (message: string) => void;
  onOpenRecord?: (id: string) => void;
  canOpenRecord?: (id: string) => boolean;
  resolveInputs?: boolean;
};

/** One inspector composes editable fields, contextual reviews and independent findings. */
export function WalletItemDetail({
  onDecide,
  focusedReviewKey,
  onOpenReviewItem,
  ...props
}: WalletDetailProps & {
  focusedReviewKey?: string;
  onOpenReviewItem?: (row: WalletRow, item: WalletReviewItem) => void;
  onDecide: (items: readonly WalletReviewItem[], action: WalletDecisionAction) => void;
}) {
  const items = [...new Map(props.row.reviews.map((item) => [item.key, item])).values()];
  const description = items.filter(
    (item) =>
      item.kind === 'annotation-goal' &&
      item.nodeId === props.row.nodeId &&
      (item.goal === 'activity-context' ||
        item.goal === 'coin-context' ||
        item.goal === 'address-context'),
  );
  const parties = items.filter(
    (item) =>
      item.kind === 'annotation-goal' &&
      item.goal === 'counterparty-context' &&
      item.subjectIds.includes(props.row.nodeId),
  );
  const inField = new Set([...description, ...parties].map((item) => item.key));
  const independent = items.filter((item) => !inField.has(item.key));
  const contextReview =
    items.find((item) => item.key === focusedReviewKey) ??
    independent.find((item) => item.changed || item.status === 'open');
  const [reviewOpen, setReviewOpen] = useState(true);
  const [previousFocus, setPreviousFocus] = useState(focusedReviewKey);
  const reviewId = useId();
  if (previousFocus !== focusedReviewKey) {
    setPreviousFocus(focusedReviewKey);
    if (focusedReviewKey) setReviewOpen(true);
  }
  const fieldReview = (label: string, reviews: readonly WalletReviewItem[]) => (
    <WalletFieldReview
      items={reviews}
      label={label}
      row={props.row}
      active={props.active}
      busy={props.busy}
      focusedReviewKey={focusedReviewKey}
      onDecide={onDecide}
      onOpenReviewItem={onOpenReviewItem}
    />
  );
  const partyReviews =
    props.row.kind === 'transaction'
      ? {
          senders: fieldReview(
            'Sender',
            parties.filter((item) => item.relationshipKinds?.includes('source')),
          ),
          recipients: fieldReview(
            'Recipient',
            parties.filter((item) => item.relationshipKinds?.includes('destination')),
          ),
        }
      : { counterparties: fieldReview('Counterparties', parties) };
  return (
    <WalletDetailFrame
      {...props}
      contextReview={contextReview}
      annotationReviews={{ label: fieldReview('Label', description) }}
      partyReviews={partyReviews}
      guidance={
        independent.length > 0 && (
          <section aria-label="Review goals" data-tour="wallet-review-goals">
            <details className="wallet-linked-reviews wallet-transaction-reviews" open={reviewOpen}>
              <summary
                aria-controls={reviewId}
                onClick={(event) => {
                  event.preventDefault();
                  setReviewOpen(!reviewOpen);
                }}
              >
                <span className="wallet-transaction-section-heading">
                  <ListChecks size={18} aria-hidden="true" />
                  Review findings
                </span>
                <ChevronDown size={14} className="wallet-section-toggle" aria-hidden="true" />
              </summary>
              <div id={reviewId} hidden={!reviewOpen}>
                <WalletReviewChecklist
                  items={independent}
                  workspace={props.workspace}
                  walletId={props.wallet.id}
                  row={props.row}
                  active={props.active}
                  busy={props.busy}
                  onDecide={onDecide}
                  onOpenReviewItem={props.row.kind === 'transaction' ? undefined : onOpenReviewItem}
                />
              </div>
            </details>
          </section>
        )
      }
    />
  );
}

/** Evidence and flow state share one owner across factual and review tabs. */
function WalletDetailFrame({
  row,
  selectionIndex,
  walletAddresses,
  workspace,
  wallet,
  active,
  busy,
  canLoadChainData,
  updateEvidence,
  onChange,
  onNotice,
  onShowInGraph,
  onIsolateInGraph,
  onRefreshAddressBalance,
  onOpenRecord,
  canOpenRecord,
  resolveInputs = true,
  contextReview,
  guidance,
  annotationReviews,
  partyReviews,
  children,
}: WalletDetailProps & {
  contextReview?: WalletReviewItem;
  guidance?: ReactNode;
  annotationReviews?: Partial<Record<'label' | 'note' | 'tags', ReactNode>>;
  partyReviews?: Partial<Record<'senders' | 'recipients' | 'counterparties', ReactNode>>;
  children?: ReactNode;
}) {
  const fetchTransaction = useTransactionFetch('visible');
  const [chosenContext, setChosenContext] = useState('');
  const [flowOpen, setFlowOpen] = useState(row.kind === 'transaction');
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
  const transaction = row.txid ? workspace.chainData.transactions[row.txid] : undefined;
  const fee = row.kind === 'transaction' ? transactionFee(workspace, transaction) : undefined;
  const headerTransaction = row.utxo
    ? walletRecordBlockObservation(
        row.utxo.txid,
        transaction,
        row.utxo.height,
        row.utxo.height <= 0,
      )
    : transaction;
  const placement = transactionStatus(headerTransaction);
  const blockTime = transactionBlockTime(headerTransaction);
  const confirmations =
    headerTransaction?.status?.confirmations ??
    (row.utxo &&
    transaction?.status?.kind === 'confirmed' &&
    row.utxo.height === transaction.status.blockHeight
      ? transaction.status.confirmations
      : undefined);
  const coinObservation =
    row.utxo && row.address ? workspace.chainData.addressUtxos?.[row.address] : undefined;
  const coinCheckedAt =
    coinObservation?.network === workspace.network &&
    row.utxo &&
    coinObservation.utxos.some(
      (output) =>
        output.txid === row.utxo!.txid &&
        output.vout === row.utxo!.vout &&
        output.valueSats === row.utxo!.valueSats &&
        output.height === row.utxo!.height,
    )
      ? coinObservation.checkedAt
      : undefined;
  const subjectTitle = walletSubjectTitle(row);
  const walletAddress = row.walletAddress;
  const addressTitle = walletAddress
    ? `${walletAddress.branch === 0 ? 'RECEIVE' : 'CHANGE'} ADDRESS`
    : row.relationshipDirection
      ? `${row.relationshipDirection.toUpperCase()} ADDRESS`
      : 'ADDRESS';
  const addressBalance = row.address
    ? [
        workspace.chainData.addressBalances?.[row.address],
        workspace.chainData.addressUtxos?.[row.address],
      ]
        .filter(
          (observation) =>
            observation?.network === workspace.network &&
            Number.isFinite(Date.parse(observation.checkedAt)),
        )
        .sort((a, b) => Date.parse(b!.checkedAt) - Date.parse(a!.checkedAt))[0]
    : undefined;
  const balanceSats = addressBalanceSats(addressBalance);
  const reportedHistory =
    walletAddress?.history ??
    (row.address ? workspace.chainData.addressHistories?.[row.address]?.history : undefined);
  const addressTransactionCount = new Set([
    ...contextTransactionIds,
    ...(reportedHistory?.map((entry) => entry.tx_hash) ?? []),
  ]).size;
  const related = useMemo(
    () =>
      selectedWalletRelatedRecords(
        {
          network: workspace.network,
          chainData: { transactions: workspace.chainData.transactions },
          analysis: { findings: workspace.analysis.findings },
        },
        { ...row, reviews: contextReview?.kind === 'finding' ? [contextReview] : [] },
        selectionIndex,
      ),
    [
      workspace.network,
      workspace.chainData.transactions,
      workspace.analysis.findings,
      row,
      contextReview,
      selectionIndex,
    ],
  );
  const transactionOutputs =
    row.kind === 'transaction' && transaction
      ? transaction.vout.map((output) => `out:${row.txid}:${output.n}`)
      : [];
  const transactionOutpoints = new Set([...related.inputs, ...transactionOutputs]);
  const otherOutputs =
    row.kind === 'transaction'
      ? related.outputs.filter((id) => !transactionOutpoints.has(id))
      : related.outputs;
  const relatedRecords = (
    key: keyof typeof evidenceLimits,
    ids: readonly string[],
    showRelationship = true,
  ) => (
    <>
      {ids.slice(0, evidenceLimits[key]).map((id) => {
        const description = showRelationship
          ? walletRelatedDescription(workspace, row, id, selectionIndex)
          : undefined;
        const output = selectionIndex.prevouts.get(id.replace(/^out:/, ''));
        const relatedAddress =
          output?.status === 'loaded' || output?.status === 'attached'
            ? walletOutputEvidence(output.output, workspace.network).address
            : undefined;
        return (
          <div key={id} className="wallet-evidence-outpoint">
            <div className="wallet-reference-actions">
              {canOpenRecord?.(id) && onOpenRecord ? (
                <span className="wallet-reference">
                  <a
                    href="#wallet-record-detail"
                    data-wallet-reference={id}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenRecord(id);
                    }}
                    aria-label={`Open ${id.startsWith('tx:') ? 'transaction' : 'output'} ${id.slice(id.indexOf(':') + 1)}`}
                  >
                    <code title={id.slice(id.indexOf(':') + 1)}>
                      <ResponsiveIdentifier value={id.slice(id.indexOf(':') + 1)} />
                    </code>
                  </a>
                  <CopyButton
                    value={id.slice(id.indexOf(':') + 1)}
                    label={`Copy ${id.startsWith('tx:') ? 'transaction ID' : 'outpoint'}`}
                  />
                </span>
              ) : (
                <WalletReference
                  value={id.replace(/^(out|tx):/, '')}
                  kind={id.startsWith('tx:') ? 'transaction ID' : 'outpoint'}
                />
              )}
              <button
                className="icon-button"
                title="Show on graph"
                aria-label={`Show ${id.startsWith('tx:') ? 'transaction' : 'outpoint'} ${id.slice(id.indexOf(':') + 1)} on graph`}
                onClick={() => onShowInGraph(id)}
              >
                <Network size={13} />
              </button>
            </div>
            {relatedAddress && canOpenRecord?.(`addr:${relatedAddress}`) && onOpenRecord && (
              <a
                href="#wallet-record-detail"
                className="wallet-related-address"
                data-wallet-reference={`addr:${relatedAddress}`}
                aria-label={`Open address ${relatedAddress}`}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenRecord(`addr:${relatedAddress}`);
                }}
              >
                <Layers size={13} aria-hidden="true" />
                <code>
                  <ResponsiveIdentifier value={relatedAddress} />
                </code>
              </a>
            )}
            {description && <span className="wallet-related-description">{description}</span>}
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
    </>
  );
  const metadataFields = (
    <WalletMetadataFields
      reviews={annotationReviews}
      workspace={workspace}
      id={row.nodeId}
      active={active}
      disabled={!active || busy || awaitingAddress}
      onChange={onChange}
      onNotice={onNotice}
    >
      <WalletCounterpartyContext
        reviews={partyReviews}
        workspace={workspace}
        wallet={wallet}
        row={row}
        active={active}
        busy={busy}
        onChange={onChange}
        onNotice={onNotice}
        onOpenRecord={onOpenRecord}
        prepared={{
          prevouts: selectionIndex.prevouts,
          scripthashes: walletAddresses.scripthashes,
        }}
      />
    </WalletMetadataFields>
  );

  const graphActions = (
    <span className="wallet-detail-graph-actions">
      <button
        className="wallet-inline-edit"
        aria-label="Show on graph"
        title="Show on graph"
        disabled={!active || busy}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onShowInGraph(row.nodeId, row.utxo);
        }}
      >
        <Network size={14} />
      </button>
      <button
        className="wallet-inline-edit"
        aria-label="Isolate on graph"
        title="Isolate on graph"
        disabled={!active || busy}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onIsolateInGraph(row.nodeId, row.utxo);
        }}
      >
        <Filter size={14} />
      </button>
    </span>
  );
  const iconEditor = (
    <WalletIconEdit
      workspace={workspace}
      id={row.nodeId}
      active={active}
      onChange={onChange}
      disabled={!active || busy}
    />
  );
  const blockFacts = (
    <>
      {blockTime && (
        <div>
          <dt aria-label="Block date (UTC)">
            <CalendarClock size={24} aria-hidden="true" />
            <span className="wallet-transaction-fact-value">
              <TransactionTimestamp transaction={headerTransaction} />
            </span>
          </dt>
          <dd>
            <small>
              <RelativeTime dateTime={blockTime.iso} active={active} />
            </small>
          </dd>
        </div>
      )}
      <div>
        <dt>
          <Box size={24} aria-hidden="true" />
          <span className="wallet-transaction-fact-value" title={placement.title}>
            {placement.kind === 'confirmed' && headerTransaction?.status?.blockHeight !== undefined
              ? `Block ${placement.label}`
              : placement.label}
          </span>
        </dt>
        <dd>
          {(placement.kind === 'confirmed' || placement.kind === 'mempool') &&
            confirmations !== undefined &&
            confirmations >= 0 && (
              <small title="Confirmations at the last lookup.">
                {confirmations.toLocaleString()} confirmation{confirmations === 1 ? '' : 's'}
              </small>
            )}
        </dd>
      </div>
    </>
  );

  const identifier = (
    <h2 className="wallet-item-title" tabIndex={-1}>
      <WalletReference
        value={row.identifier}
        kind={
          row.kind === 'address' ? 'address' : row.kind === 'output' ? 'outpoint' : 'transaction ID'
        }
      />
    </h2>
  );

  return (
    <>
      <header
        className={`wallet-subject-header wallet-detail-heading wallet-record-heading${row.kind === 'transaction' ? ' wallet-transaction-heading' : row.kind === 'address' ? ' wallet-address-heading' : ' wallet-coin-heading'}`}
      >
        <div className="wallet-detail-identity">
          {row.kind === 'transaction' ? (
            <div className="wallet-transaction-title-row">
              {row.walletTransaction && (
                <span
                  className={`wallet-transaction-direction-icon is-${row.walletTransaction.direction}`}
                  title={row.walletTransaction.direction}
                  aria-label={row.walletTransaction.direction}
                >
                  {row.walletTransaction.direction === 'sent' ? (
                    <ArrowUpRight size={48} />
                  ) : row.walletTransaction.direction === 'received' ? (
                    <ArrowDownLeft size={48} />
                  ) : (
                    <ArrowLeftRight size={48} />
                  )}
                </span>
              )}
              <div className="wallet-transaction-title-text">
                <span className="wallet-transaction-title">
                  TRANSACTION
                  {row.walletTransaction && ` ${row.walletTransaction.direction.toUpperCase()}`}
                </span>
                {matchesWalletStatus(row, 'open') && (
                  <span className="wallet-transaction-review-status">Needs review</span>
                )}
              </div>
            </div>
          ) : row.kind === 'address' ? (
            <div className="wallet-transaction-title-row">
              <span className="wallet-address-type-icon" aria-hidden="true">
                <Layers size={48} />
              </span>
              <div className="wallet-transaction-title-text">
                <span className="wallet-transaction-title">{addressTitle}</span>
                {matchesWalletStatus(row, 'open') && (
                  <span className="wallet-transaction-review-status">Needs review</span>
                )}
              </div>
              {graphActions}
            </div>
          ) : (
            <div className="wallet-transaction-title-row">
              <span className="wallet-record-type-icon" aria-hidden="true">
                {row.utxo ? <Coins size={48} /> : <ArrowRightFromLine size={48} />}
              </span>
              <div className="wallet-transaction-title-text">
                <span className="wallet-transaction-title">{row.utxo ? 'COIN' : 'OUTPUT'}</span>
                {matchesWalletStatus(row, 'open') && (
                  <span className="wallet-transaction-review-status">Needs review</span>
                )}
              </div>
            </div>
          )}
        </div>
        {row.walletTransaction && (
          <div
            className={`wallet-detail-value ${row.walletTransaction.netSats !== undefined ? (row.walletTransaction.netSats > 0 ? 'is-positive' : row.walletTransaction.netSats < 0 ? 'is-negative' : '') : ''}`}
          >
            <Amount value={row.walletTransaction.netSats} signed />
          </div>
        )}
        {row.kind === 'output' && (
          <div className="wallet-detail-value">
            <Amount value={row.amountSats} />
          </div>
        )}
        {identifier}
        {row.kind === 'output' && (
          <>
            <dl className="wallet-record-facts wallet-coin-facts" aria-label="Coin facts">
              {row.utxo ? (
                <div>
                  <dt>
                    <CircleCheck size={24} aria-hidden="true" />
                    <span className="wallet-transaction-fact-value">Reported unspent</span>
                  </dt>
                  <dd>
                    <small
                      title={
                        coinCheckedAt ? `Checked ${formatLocalTimestamp(coinCheckedAt)}` : undefined
                      }
                    >
                      {coinCheckedAt ? (
                        <>
                          Checked <RelativeTime dateTime={coinCheckedAt} active={active} />
                        </>
                      ) : (
                        'Coin check'
                      )}
                    </small>
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>
                    <WalletIcon size={24} aria-hidden="true" />
                    <span
                      className={`wallet-transaction-fact-value ${relationship === 'In this wallet' ? 'is-wallet' : ''}`}
                    >
                      {relationship}
                    </span>
                  </dt>
                  <dd>
                    <small>
                      Wallet relationship{' '}
                      <WalletHelp title="Wallet relationship" active={active}>
                        Matched against this wallet's discovered addresses. No match does not rule
                        out an undiscovered wallet address or identify its owner.
                      </WalletHelp>
                    </small>
                  </dd>
                </div>
              )}
              {blockFacts}
            </dl>
            {row.address && (
              <div className="wallet-coin-address" role="group" aria-label="Address">
                <Layers size={16} aria-hidden="true" />
                {canOpenRecord?.(`addr:${row.address}`) && onOpenRecord ? (
                  <span className="wallet-reference">
                    <a
                      href="#wallet-record-detail"
                      data-wallet-reference={`addr:${row.address}`}
                      aria-label={`Open address ${row.address}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onOpenRecord(`addr:${row.address}`);
                      }}
                    >
                      <code title={row.address}>
                        <ResponsiveIdentifier value={row.address} />
                      </code>
                    </a>
                    <CopyButton value={row.address} label="Copy address" />
                  </span>
                ) : (
                  <WalletReference value={row.address} kind="address" />
                )}
              </div>
            )}
          </>
        )}
        {row.kind === 'address' && (
          <dl className="wallet-record-facts wallet-address-facts" aria-label="Address facts">
            <div>
              <dt aria-label="Balance">
                <Bitcoin size={24} aria-hidden="true" />
                <span className="wallet-transaction-fact-value wallet-address-balance">
                  <Amount
                    value={balanceSats}
                    unknown={addressBalance ? 'Unavailable' : 'Not checked'}
                  />
                  {onRefreshAddressBalance && row.address && (
                    <button
                      className="icon-button wallet-address-balance-refresh"
                      aria-label={addressBalance ? 'Refresh balance' : 'Check balance'}
                      title={addressBalance ? 'Refresh balance' : 'Check balance'}
                      disabled={!active || busy || !canLoadChainData}
                      onClick={() => onRefreshAddressBalance(row.address!)}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </dt>
              <dd>
                <small
                  className="wallet-address-balance-caption"
                  title={
                    addressBalance
                      ? `Checked ${formatLocalTimestamp(addressBalance.checkedAt)}`
                      : undefined
                  }
                >
                  Balance
                  {addressBalance && (
                    <>
                      {' '}
                      · Checked <RelativeTime dateTime={addressBalance.checkedAt} active={active} />
                    </>
                  )}
                </small>
                {addressBalance &&
                  'unconfirmedSats' in addressBalance &&
                  addressBalance.unconfirmedSats !== 0 && (
                    <small>
                      Pending <Amount value={addressBalance.unconfirmedSats} signed />
                    </small>
                  )}
              </dd>
            </div>
            <div>
              <dt>
                <ArrowLeftRight size={24} aria-hidden="true" />
                <span className="wallet-transaction-fact-value">
                  {addressTransactionCount.toLocaleString()} transaction
                  {addressTransactionCount === 1 ? '' : 's'}
                </span>
              </dt>
              <dd>
                {contextTransactionIds.length < addressTransactionCount ? (
                  <small>{contextTransactionIds.length.toLocaleString()} loaded</small>
                ) : !reportedHistory ? (
                  <small>Loaded activity</small>
                ) : null}
              </dd>
            </div>
            {walletAddress && (
              <div className="wallet-address-derivation">
                <dt>
                  <GitBranch size={24} aria-hidden="true" />
                  <span className="wallet-transaction-fact-value">
                    <code title="Relative to imported account key">{walletAddress.path}</code>
                  </span>
                </dt>
                <dd>
                  <small>Derivation</small>
                </dd>
              </div>
            )}
          </dl>
        )}
        {row.kind === 'transaction' && (
          <dl
            className="wallet-record-facts wallet-transaction-facts"
            aria-label="Transaction facts"
          >
            {blockFacts}
            {placement.kind === 'confirmed' && (
              <div>
                <dt aria-label="Network fee">
                  <Bitcoin size={24} aria-hidden="true" />
                  <span className="wallet-transaction-fact-value" title="Network fee">
                    {fee ? formatSats(fee.feeSats) : 'Unknown'}
                  </span>
                </dt>
                <dd>{fee && <small>{fee.feeRateSatVb.toFixed(2)} sat/vB</small>}</dd>
              </div>
            )}
            {(transaction?.vsize !== undefined || transaction?.size !== undefined) && (
              <div>
                <dt aria-label="Transaction size">
                  <FileText size={24} aria-hidden="true" />
                  <span
                    className="wallet-transaction-fact-value"
                    title={transaction.vsize !== undefined ? 'Virtual size' : 'Serialized size'}
                  >
                    {transaction.vsize !== undefined
                      ? `${transaction.vsize.toLocaleString()} vB`
                      : `${transaction.size?.toLocaleString()} bytes`}
                  </span>
                </dt>
                <dd>
                  {transaction.vsize !== undefined && transaction.size !== undefined && (
                    <small>{transaction.size.toLocaleString()} bytes</small>
                  )}
                </dd>
              </div>
            )}
            {!row.walletTransaction && (
              <div>
                <dt>
                  <WalletIcon size={24} aria-hidden="true" />
                  <span>Wallet relationship</span>
                </dt>
                <dd
                  className={`wallet-match-value ${relationship === 'In this wallet' ? 'is-wallet' : ''}`}
                >
                  {relationship}
                  <WalletHelp title="Wallet relationship" active={active}>
                    Matched against this wallet's discovered addresses. No match does not rule out
                    an undiscovered wallet address or identify its owner.
                  </WalletHelp>
                </dd>
              </div>
            )}
          </dl>
        )}
      </header>
      <section className="wallet-transaction-overview" aria-label={`${subjectTitle} details`}>
        <section className="wallet-transaction-metadata" aria-label="Metadata">
          <div className="wallet-transaction-metadata-heading">
            <h3 className="wallet-transaction-section-heading">
              <Tag size={18} aria-hidden="true" />
              Metadata
            </h3>
            {iconEditor}
          </div>
          {metadataFields}
        </section>
        {guidance}
      </section>
      {children}
      {context ? (
        <details
          className="wallet-flow-disclosure wallet-transaction-flow"
          aria-label={row.kind === 'address' ? 'Address activity' : 'Transaction flow'}
          open={flowOpen}
        >
          <summary
            onClick={(event) => {
              event.preventDefault();
              setFlowOpen(!flowOpen);
            }}
            aria-controls={flowId}
          >
            <>
              <span className="wallet-transaction-section-heading">
                <Network size={18} aria-hidden="true" />
                {row.kind === 'address' ? 'Address activity' : 'Transaction flow'}
              </span>
              {row.kind !== 'address' && graphActions}
              <ChevronDown size={14} className="wallet-section-toggle" aria-hidden="true" />
            </>
          </summary>
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
                    {short(txid)}
                    {workspace.annotations.entities[`tx:${txid}`]?.label
                      ? ` · ${workspace.annotations.entities[`tx:${txid}`].label}`
                      : ''}
                  </option>
                ))}
              </select>
              {contextId && <CopyButton value={contextId} label="Copy transaction ID" />}
            </div>
          )}
          <div id={flowId} className="wallet-flow-content" hidden={!flowOpen}>
            {flowOpen && (
              <>
                <WalletReviewFlow
                  key={contextId}
                  context={context}
                  workspace={workspace}
                  editedNodeId={row.nodeId}
                  onVisibleInputsChange={onVisibleInputsChange}
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
        </details>
      ) : (
        <div className="wallet-flow-empty" role="status">
          <Info size={16} aria-hidden="true" />
          <div>
            <span>No linked transaction</span>
            {hasUnloadedHistory && <span>Some wallet history is not loaded.</span>}
          </div>
          {row.kind !== 'address' && graphActions}
        </div>
      )}

      <div className="wallet-related-grid">
        {row.kind === 'transaction' &&
          (related.inputs.length > 0 || transactionOutputs.length > 0) && (
            <details className="wallet-related-records" aria-label="Inputs and outputs">
              <summary>
                Inputs ({related.inputs.length}) / Outputs ({transactionOutputs.length})
              </summary>
              <div className="wallet-outpoint-columns">
                {(
                  [
                    ['inputs', related.inputs],
                    ['outputs', transactionOutputs],
                  ] as const
                ).map(([key, ids]) => (
                  <section aria-label={key === 'inputs' ? 'Inputs' : 'Outputs'} key={key}>
                    <h3>
                      {key === 'inputs' ? 'Inputs' : 'Outputs'} ({ids.length})
                    </h3>
                    {ids.length ? relatedRecords(key, ids, false) : <p className="muted">None</p>}
                  </section>
                ))}
              </div>
            </details>
          )}
        {row.walletTransaction && (
          <details className="wallet-accounting" aria-label="Wallet accounting">
            <summary>Wallet accounting</summary>
            <dl className="wallet-review-evidence">
              <div>
                <dt>Direction</dt>
                <dd>{row.walletTransaction.direction}</dd>
              </div>
              <div>
                <dt>Wallet inputs</dt>
                <Amount as="dd" value={row.walletTransaction.spentSats} />
              </div>
              <div>
                <dt>Wallet outputs</dt>
                <Amount as="dd" value={row.walletTransaction.receivedSats} />
              </div>
              <div>
                <dt>Wallet net change</dt>
                <Amount as="dd" value={row.walletTransaction.netSats} />
              </div>
              <div>
                <dt>Whole-transaction fee</dt>
                <Amount as="dd" value={row.walletTransaction.feeSats} />
              </div>
            </dl>
            {row.walletTransaction.missingInputCount > 0 && (
              <button disabled={!canLoadChainData || busy} onClick={() => setFlowOpen(true)}>
                Load inputs ({row.walletTransaction.missingInputCount})
              </button>
            )}
            {!row.walletTransaction.transaction && (
              <button
                disabled={!canLoadChainData || busy}
                onClick={() => onShowInGraph(row.nodeId)}
              >
                Load transaction
              </button>
            )}
          </details>
        )}
        {otherOutputs.length > 0 && (
          <details className="wallet-related-records" aria-label="Related outpoints">
            <summary>Related outpoints ({otherOutputs.length})</summary>
            {relatedRecords('outputs', otherOutputs)}
          </details>
        )}
        {related.transactions.length > 0 && (
          <details className="wallet-related-records" aria-label="Related transactions">
            <summary>Related transactions ({related.transactions.length})</summary>
            {relatedRecords('transactions', related.transactions)}
          </details>
        )}
      </div>
    </>
  );
}
