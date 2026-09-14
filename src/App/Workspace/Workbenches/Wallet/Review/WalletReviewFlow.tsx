import { formatBitcoinAmount } from '../../../../../Domain/Chain/amountFormat';
import { Amount } from '../../../../../Shared/Display/Amount';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Box,
  Pencil,
  Search,
  Wallet,
  CircleHelp,
  TriangleAlert,
  FileCode,
} from 'lucide-react';
import type { Annotation, GraphNode, Workspace } from '../../../../../Domain/types';
import { listTagsForNode } from '../../../../../Domain/Metadata/tags';
import type {
  WalletReviewContext,
  WalletReviewFlowEntry,
} from '../../../../../Domain/Wallet/walletReviewContext';
import {
  isWalletFlowEditTarget,
  walletFlowVisibility,
} from '../../../../../Domain/Wallet/walletFlowVisibility';
import { TransactionBlockTime } from '../../../../../Shared/Display/TransactionBlockTime';
import { isOpReturn } from '../../../../../Domain/Chain/opReturn';
import { OpReturnData } from '../../../../../Shared/Display/OpReturnData';
import { WalletHelp } from '../../../../../Shared/Display/WalletHelp';
import { WalletReference } from '../WalletReference';
import './wallet-review-flow.css';

const PAGE_SIZE = 20;
const MAX_VISIBLE = 100;

/** A transaction's actual edges, never a claim about which input paid an output. */
export function WalletReviewFlow({
  context,
  workspace,
  walletName,
  editedNodeId,
  onShowInGraph,
  onVisibleInputsChange,
  active = true,
}: {
  context: WalletReviewContext;
  workspace: Workspace;
  walletName: string;
  editedNodeId?: string;
  onShowInGraph: (id: string) => void;
  onVisibleInputsChange?: (inputs: readonly WalletReviewFlowEntry[]) => void;
  active?: boolean;
}) {
  useEffect(() => {
    if (context.status !== 'loaded') onVisibleInputsChange?.([]);
  }, [context.status, onVisibleInputsChange]);
  const editingId =
    editedNodeId ??
    context.selectedNodeId ??
    context.selected?.id ??
    [...context.inputs, ...context.outputs].find((entry) => entry.selected)?.id ??
    context.transactionNodeId;
  if (context.status !== 'loaded')
    return (
      <div className="wallet-flow-unavailable">
        <p>The transaction is not loaded. Open it to see its inputs and outputs.</p>
        {context.transactionNodeId && (
          <button onClick={() => onShowInGraph(context.transactionNodeId!)}>
            Load transaction details
          </button>
        )}
      </div>
    );
  const editingTransaction = editingId === context.transactionNodeId;
  const transactionAnnotation = context.transactionNodeId
    ? workspace.annotations[context.transactionNodeId]
    : undefined;
  return (
    <figure className="wallet-review-flow" aria-label="Wallet transaction flow">
      <figcaption>
        <span className="wallet-flow-legend">
          <Wallet size={12} aria-hidden="true" /> Your wallet · {walletName}
        </span>
      </figcaption>
      <div className="wallet-flow-columns">
        <FlowColumn
          key={`${context.transactionNodeId}:inputs`}
          title="Inputs"
          kind="input"
          entries={context.inputs}
          workspace={workspace}
          editingId={editingId}
          onShowInGraph={onShowInGraph}
          onVisibleEntriesChange={onVisibleInputsChange}
        />
        <div className="wallet-flow-transaction">
          <ArrowRight className="wallet-flow-arrow" size={17} aria-hidden="true" />
          <div
            className={`wallet-flow-node wallet-flow-transaction-node${editingTransaction ? ' is-selected' : ''}`}
            title={[context.transactionId, transactionAnnotation?.label]
              .filter(Boolean)
              .join(' · ')}
          >
            <Box className="wallet-flow-transaction-icon" size={25} aria-hidden="true" />
            <span className="wallet-flow-role" title="Inputs / outputs">
              Transaction ({context.inputs.length} / {context.outputs.length})
            </span>
            {editingTransaction && (
              <span className="wallet-flow-editing">
                <Pencil size={10} aria-hidden="true" /> Editing transaction
              </span>
            )}
            {(transactionAnnotation?.label || transactionAnnotation?.icon) && (
              <strong title={transactionAnnotation.label}>
                {transactionAnnotation.icon && <span>{transactionAnnotation.icon} </span>}
                {transactionAnnotation.label}
              </strong>
            )}
            <WalletReference value={context.transactionId!} kind="transaction ID" />
            <FlowTags
              workspace={workspace}
              node={{ id: context.transactionNodeId!, kind: 'transaction', label: '' }}
            />
            <TransactionBlockTime transaction={context.transaction} workspace={workspace} />
            <ShowOnGraph
              id={context.transactionNodeId!}
              kind="transaction"
              onShowInGraph={onShowInGraph}
            />
          </div>
          <ArrowRight className="wallet-flow-arrow" size={17} aria-hidden="true" />
        </div>
        <FlowColumn
          key={`${context.transactionNodeId}:outputs`}
          title="Outputs"
          kind="output"
          displayedTransactionId={context.transactionId}
          entries={context.outputs}
          workspace={workspace}
          editingId={editingId}
          onShowInGraph={onShowInGraph}
        />
      </div>
      {context.currentOutputs.length > 0 && (
        <div className="wallet-flow-descendants">
          <span>This receipt was spent in transactions creating these wallet outputs:</span>
          <FlowColumn
            key={`${context.transactionNodeId}:descendants`}
            title="Related wallet outputs"
            kind="output"
            entries={context.currentOutputs}
            workspace={workspace}
            editingId={editingId}
            onShowInGraph={onShowInGraph}
          />
        </div>
      )}
      <div className="wallet-flow-footnote">
        <span>
          {context.missingPrevouts > 0
            ? `${context.missingPrevouts} previous-output details unavailable`
            : 'Previous-output details available'}
        </span>
        <WalletHelp title="Wallet flow evidence" active={active}>
          <p>
            “Your wallet” identifies an address discovered in your wallet. “No wallet match” means
            it is not among your discovered addresses, though it could still belong to you.
            “Unknown” means there is not enough information to check.
          </p>
          <p>
            Arrows connect transactions to the outputs they create or spend. They do not show which
            input funded each output or who owns the coins. Choose “Show on graph” (the magnifying
            glass) to open a transaction or outpoint in Graph.
          </p>
        </WalletHelp>
      </div>
    </figure>
  );
}

function ShowOnGraph({
  id,
  kind,
  unavailable,
  onShowInGraph,
}: {
  id: string;
  kind: 'input' | 'output' | 'transaction';
  unavailable?: 'coinbase' | 'missing-input';
  onShowInGraph: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="wallet-flow-show"
      title="Show on graph"
      aria-label={
        unavailable
          ? `${unavailable === 'coinbase' ? 'Coinbase input' : 'Input'} for ${id.replace(/^tx:/, '')} has no ${unavailable === 'coinbase' ? 'previous output' : 'known outpoint'}`
          : `Show ${kind} ${id.replace(/^(?:out|tx):/, '')} on graph`
      }
      disabled={!!unavailable}
      onClick={() => onShowInGraph(id)}
    >
      <Search size={13} aria-hidden="true" />
    </button>
  );
}

function FlowColumn({
  title,
  kind,
  entries,
  displayedTransactionId,
  workspace,
  editingId,
  onShowInGraph,
  onVisibleEntriesChange,
}: {
  title: string;
  kind: 'input' | 'output';
  entries: WalletReviewFlowEntry[];
  displayedTransactionId?: string;
  workspace: Workspace;
  editingId?: string;
  onShowInGraph: (id: string) => void;
  onVisibleEntriesChange?: (entries: readonly WalletReviewFlowEntry[]) => void;
}) {
  const [limit, setLimit] = useState(2);
  const list = useRef<HTMLDivElement>(null);
  const editingAddress = editingId?.startsWith('addr:') ? editingId.slice(5) : undefined;
  const isEditing = (entry: WalletReviewFlowEntry) => isWalletFlowEditTarget(entry, editingId);
  const { visible, total, hidden, owned, hiddenOwned, hiddenContext } = walletFlowVisibility(
    entries,
    editingId,
    limit,
  );
  // Payload bytes cannot change which prevouts need loading or which row needs framing.
  // Keep potentially large scripts out of effect signatures and decode only visible cards.
  const visibleKey = JSON.stringify(visible, (key, value) =>
    key === 'scriptPubKey' ? undefined : value,
  );
  const reportsVisible = !!onVisibleEntriesChange;
  const reportVisibleEntries = useEffectEvent(() => onVisibleEntriesChange?.(visible));
  useEffect(() => {
    reportVisibleEntries();
  }, [visibleKey, reportsVisible]);
  useLayoutEffect(() => {
    const container = list.current;
    const selected = container?.querySelector<HTMLElement>('.is-selected');
    if (!container || !selected) return;
    const outer = container.getBoundingClientRect();
    const inner = selected.getBoundingClientRect();
    if (inner.top < outer.top) container.scrollTop -= outer.top - inner.top;
    else if (inner.bottom > outer.bottom) container.scrollTop += inner.bottom - outer.bottom;
  }, [editingId, limit, visibleKey]);
  return (
    <div className={`wallet-flow-column${limit === 2 ? ' is-collapsed' : ''}`}>
      <div className="wallet-flow-column-heading">
        <span>
          {title} <b>{total}</b>
        </span>
        {(hidden > 0 || limit > 2) && (
          <button
            className="text-button"
            aria-label={`${limit > 2 ? 'Collapse' : 'Expand'} ${title.toLowerCase()}`}
            aria-expanded={limit > 2}
            onClick={() => setLimit(limit > 2 ? 2 : PAGE_SIZE)}
          >
            {limit > 2 ? 'Collapse' : `Show ${Math.min(PAGE_SIZE, total)}`}
          </button>
        )}
      </div>
      {(owned > 0 || hidden > 0) && (
        <div className="wallet-flow-counts">
          {owned > 0 && (
            <span>
              <Wallet size={10} aria-hidden="true" /> {owned} wallet {kind}
              {owned === 1 ? '' : 's'}
            </span>
          )}
          {hidden > 0 && (
            <span>
              {hidden} hidden{hiddenOwned > 0 ? ` · ${hiddenOwned} wallet` : ''}
              {hiddenContext > 0 ? ` · ${hiddenContext} selected context` : ''}
            </span>
          )}
        </div>
      )}
      <div className="wallet-flow-entries" ref={list}>
        {visible.map((entry, index) => {
          const annotation = workspace.annotations[entry.id];
          const addressId = entry.address ? `addr:${entry.address}` : undefined;
          const addressAnnotation = addressId ? workspace.annotations[addressId] : undefined;
          const addressPrimary = !!editingAddress && entry.address === editingAddress;
          const primaryAnnotation = addressPrimary ? addressAnnotation : annotation;
          const creatingId = entry.txid ?? /^out:([0-9a-f]{64}):/.exec(entry.id)?.[1];
          const creatingAnnotation = creatingId
            ? workspace.annotations[`tx:${creatingId}`]
            : undefined;
          const opReturn = isOpReturn(entry.scriptPubKey?.hex);
          const scriptOutput = !entry.address && !entry.missing && !!entry.scriptPubKey;
          const role = entry.coinbase
            ? 'Coinbase'
            : opReturn
              ? 'Unspendable'
              : entry.ownership === 'wallet'
                ? 'Your wallet'
                : entry.ownership === 'external'
                  ? 'No wallet match'
                  : entry.prevoutStatus === 'conflict'
                    ? 'Conflicting evidence'
                    : scriptOutput
                      ? 'Script output'
                      : 'Unknown';
          const selected = isEditing(entry);
          const value =
            entry.valueSats === undefined
              ? 'Value not loaded'
              : formatBitcoinAmount(entry.valueSats);
          return (
            <div
              className={`wallet-flow-node ownership-${entry.ownership}${selected ? ' is-selected' : ''}`}
              key={entry.id.startsWith('out:') ? entry.id : `${entry.id}:${index}`}
              title={[
                role,
                entry.id,
                entry.address,
                annotation?.label,
                addressAnnotation?.label,
                value,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <div className="wallet-flow-node-heading">
                <span className="wallet-flow-role">
                  {opReturn ? (
                    <FileCode size={11} aria-hidden="true" />
                  ) : entry.ownership === 'wallet' ? (
                    <Wallet size={11} aria-hidden="true" />
                  ) : entry.prevoutStatus === 'conflict' ? (
                    <TriangleAlert size={11} aria-hidden="true" />
                  ) : scriptOutput ? (
                    <FileCode size={11} aria-hidden="true" />
                  ) : entry.ownership === 'unknown' && !entry.coinbase ? (
                    <CircleHelp size={11} aria-hidden="true" />
                  ) : null}
                  {role}
                </span>
                <ShowOnGraph
                  id={entry.id}
                  kind={kind}
                  unavailable={
                    entry.coinbase
                      ? 'coinbase'
                      : kind === 'input' && !entry.id.startsWith('out:')
                        ? 'missing-input'
                        : undefined
                  }
                  onShowInGraph={onShowInGraph}
                />
              </div>
              {selected && (
                <span className="wallet-flow-editing">
                  <Pencil size={10} aria-hidden="true" /> Editing{' '}
                  {editingAddress ? 'address' : kind}
                </span>
              )}
              {(primaryAnnotation?.label || primaryAnnotation?.icon) && (
                <strong title={primaryAnnotation.label}>
                  {primaryAnnotation.icon && <span>{primaryAnnotation.icon} </span>}
                  {primaryAnnotation.label}
                </strong>
              )}
              {opReturn && <OpReturnData hex={entry.scriptPubKey?.hex} />}
              {entry.coinbase ? (
                <strong>Newly mined coins</strong>
              ) : (
                <WalletReference
                  value={entry.address ?? entry.id.replace(/^(out|tx):/, '')}
                  kind={
                    entry.address
                      ? 'address'
                      : entry.id.startsWith('out:')
                        ? 'outpoint'
                        : 'transaction ID'
                  }
                />
              )}
              {addressPrimary ? (
                <AnnotationLine
                  name={kind === 'input' ? 'Previous output' : 'Output'}
                  annotation={annotation}
                />
              ) : (
                <AnnotationLine name="Address" annotation={addressAnnotation} />
              )}
              {!entry.coinbase && creatingId !== displayedTransactionId && (
                <AnnotationLine name="Creating transaction" annotation={creatingAnnotation} />
              )}
              {!entry.coinbase && creatingId && creatingId !== displayedTransactionId && (
                <FlowTags
                  workspace={workspace}
                  node={{ id: `tx:${creatingId}`, kind: 'transaction', label: '' }}
                  caption="Creating transaction tags"
                />
              )}
              <FlowTags
                workspace={workspace}
                node={{
                  id: entry.id,
                  kind: entry.id.startsWith('out:') ? 'output' : 'transaction',
                  address: entry.address,
                  label: '',
                }}
              />
              <Amount value={entry.valueSats} unknown="Value not loaded" />
            </div>
          );
        })}
        {entries.length === 0 && <span className="small muted">No {title.toLowerCase()}</span>}
      </div>
      {limit > 2 && hidden > 0 && (
        <div className="wallet-flow-more">
          {limit < MAX_VISIBLE ? (
            <button
              className="text-button"
              onClick={() => setLimit(Math.min(MAX_VISIBLE, limit + PAGE_SIZE))}
            >
              Show {Math.min(PAGE_SIZE, hidden)} more
            </button>
          ) : (
            <span>
              Showing {visible.length} of {total}. Open the transaction for more.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function AnnotationLine({ name, annotation }: { name: string; annotation?: Annotation }) {
  if (!annotation?.label && !annotation?.icon) return null;
  return (
    <span className="wallet-flow-annotation" title={`${name}: ${annotation.label}`}>
      <span className="wallet-flow-annotation-kind">{name}</span>{' '}
      {annotation.icon && <span>{annotation.icon} </span>}
      {annotation.label}
    </span>
  );
}

function FlowTags({
  workspace,
  node,
  caption,
}: {
  workspace: Workspace;
  node: GraphNode;
  caption?: string;
}) {
  const tags = listTagsForNode(workspace, node);
  if (!tags.length) return null;
  return (
    <span className="wallet-flow-tags" aria-label={caption ?? 'Tags'}>
      {caption && <span className="wallet-flow-annotation-kind">{caption}</span>}
      {tags.map((tag) => (
        <span className="wallet-flow-tag" key={tag.id} title={tag.name}>
          <i style={{ backgroundColor: tag.color }} aria-hidden="true" />
          {tag.name}
        </span>
      ))}
    </span>
  );
}
