import { formatBitcoinAmount, formatSats } from '../../../../../Core/Formatting';
import { Amount } from '../../../../Controls/Display/Amount';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type RefObject,
} from 'react';
import { Box, Wallet, CircleHelp, TriangleAlert, FileCode } from 'lucide-react';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { GraphNode } from '../../../GraphState/types';

import { listTagsForNode } from '../../../../../Core/Workspace/Annotations/tagMembership';
import type { WalletReviewContext, WalletReviewFlowEntry } from '../walletReviewContext';
import { isWalletFlowEditTarget, walletFlowVisibility } from './walletFlowVisibility';
import { transactionStatus } from '../../../../Controls/Display/transactionStatus';
import { transactionBlockTime } from '../../../../Controls/Display/transactionTime';
import { transactionFee } from '../../../../Controls/Display/transactionFee';
import { isOpReturn } from '../../../../../Core/Bitcoin';
import { OpReturnData } from '../../../../Controls/Display/OpReturnData';
import { WalletReference } from '../WalletReference';
import './wallet-review-flow.css';

const PAGE_SIZE = 20;
const MAX_VISIBLE = 100;

/** A transaction's actual edges, never a claim about which input paid an output. */
export function WalletReviewFlow({
  context,
  workspace,
  editedNodeId,
  onVisibleInputsChange,
}: {
  context: WalletReviewContext;
  workspace: Workspace;
  editedNodeId?: string;
  onVisibleInputsChange?: (inputs: readonly WalletReviewFlowEntry[]) => void;
}) {
  const columnsRef = useRef<HTMLDivElement>(null);
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
      </div>
    );
  const editingTransaction = editingId === context.transactionNodeId;
  const transactionAnnotation = context.transactionNodeId
    ? workspace.annotations.entities[context.transactionNodeId]
    : undefined;
  return (
    <figure className="wallet-review-flow" aria-label="Wallet transaction flow">
      <div className="wallet-flow-columns" ref={columnsRef}>
        <FlowConnections columnsRef={columnsRef} />
        <FlowColumn
          key={`${context.transactionNodeId}:inputs`}
          title="Inputs"
          kind="input"
          entries={context.inputs}
          workspace={workspace}
          editingId={editingId}
          onVisibleEntriesChange={onVisibleInputsChange}
        />
        <div className="wallet-flow-transaction">
          <div
            className={`wallet-flow-node wallet-flow-transaction-node${editingTransaction ? ' is-selected' : ''}`}
            role="group"
            aria-label={editingTransaction ? 'Editing transaction' : 'Transaction'}
            title={[context.transactionId, transactionAnnotation?.label]
              .filter(Boolean)
              .join(' · ')}
          >
            <div className="wallet-flow-transaction-heading">
              <Box className="wallet-flow-transaction-icon" size={16} aria-hidden="true" />
              {transactionAnnotation?.icon && (
                <span className="wallet-flow-annotation-icon">{transactionAnnotation.icon}</span>
              )}
              <WalletReference value={context.transactionId!} kind="transaction ID" />
              <span
                className="wallet-flow-io-count"
                title="Inputs / outputs"
                aria-label={`${context.inputs.length} inputs, ${context.outputs.length} outputs`}
              >
                {context.inputs.length} / {context.outputs.length}
              </span>
            </div>
            {transactionAnnotation?.label && (
              <strong title={transactionAnnotation.label}>{transactionAnnotation.label}</strong>
            )}
            <FlowTags
              workspace={workspace}
              node={{ id: context.transactionNodeId!, kind: 'transaction', label: '' }}
            />
            <FlowTransactionFacts transaction={context.transaction} workspace={workspace} />
          </div>
        </div>
        <FlowColumn
          key={`${context.transactionNodeId}:outputs`}
          title="Outputs"
          kind="output"
          entries={context.outputs}
          workspace={workspace}
          editingId={editingId}
        />
      </div>
      {context.currentOutputs.length > 0 && (
        <div className="wallet-flow-descendants">
          <FlowColumn
            key={`${context.transactionNodeId}:descendants`}
            title="Related wallet outputs"
            kind="output"
            entries={context.currentOutputs}
            workspace={workspace}
            editingId={editingId}
          />
        </div>
      )}
      {context.missingPrevouts > 0 && (
        <div className="wallet-flow-footnote">{context.missingPrevouts} inputs need details</div>
      )}
    </figure>
  );
}

/** Decorative geometry only; evidence, paging and selection retain their existing owners. */
function FlowConnections({ columnsRef }: { columnsRef: RefObject<HTMLDivElement | null> }) {
  const overlay = useRef<SVGSVGElement>(null);
  const markerId = useId();
  useEffect(() => {
    const columns = columnsRef.current;
    const svg = overlay.current;
    if (!columns || !svg) return;
    const paths = svg.querySelector<SVGGElement>('.wallet-flow-paths')!;
    const drawn = new Map<string, SVGPathElement>();
    let frame = 0;
    const measure = () => {
      frame = 0;
      const origin = svg.getBoundingClientRect();
      const transaction = columns
        .querySelector('.wallet-flow-transaction-node')
        ?.getBoundingClientRect();
      const curves: { key: string; path: string; selected: boolean; opacity: number }[] = [];
      if (origin.width && transaction?.width) {
        for (const column of columns.querySelectorAll<HTMLElement>('[data-flow-side]')) {
          const list = column.querySelector('.wallet-flow-entries')?.getBoundingClientRect();
          if (!list) continue;
          const input = column.dataset.flowSide === 'input';
          const horizontal = list.right <= transaction.left || list.left >= transaction.right;
          for (const card of column.querySelectorAll<HTMLElement>('[data-flow-entry]')) {
            const rect = card.getBoundingClientRect();
            const top = Math.max(rect.top, list.top);
            const bottom = Math.min(rect.bottom, list.bottom);
            const left = Math.max(rect.left, list.left);
            const right = Math.min(rect.right, list.right);
            if (bottom <= top || right <= left) continue;
            const inset = Math.min(3, (bottom - top) / 2);
            const cardY =
              Math.max(top + inset, Math.min(bottom - inset, (rect.top + rect.bottom) / 2)) -
              origin.top;
            const cardX = (left + right) / 2 - origin.left;
            const txX = (transaction.left + transaction.right) / 2 - origin.left;
            const txY = (transaction.top + transaction.bottom) / 2 - origin.top;
            const startX = horizontal
              ? (input ? rect.right : transaction.right) - origin.left
              : input
                ? cardX
                : txX;
            const startY = horizontal
              ? input
                ? cardY
                : txY
              : (input ? bottom : transaction.bottom) - origin.top;
            const endX = horizontal
              ? (input ? transaction.left : rect.left) - origin.left - 10
              : input
                ? txX
                : cardX;
            const endY = horizontal
              ? input
                ? txY
                : cardY
              : (input ? transaction.top : top) - origin.top - 10;
            const bend = horizontal ? (endX - startX) / 2 : (endY - startY) / 2;
            if (bend <= 0) continue;
            curves.push({
              key: `${input ? 'input' : 'output'}:${card.dataset.flowEntry}`,
              path: horizontal
                ? `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`
                : `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`,
              selected: card.classList.contains('is-selected'),
              opacity: Math.min(1, (bottom - top) / 12),
            });
          }
        }
      }
      curves.sort((a, b) => Number(a.selected) - Number(b.selected));
      const retained = new Set(curves.map((curve) => curve.key));
      for (const [key, path] of drawn)
        if (!retained.has(key)) {
          path.remove();
          drawn.delete(key);
        }
      for (const [index, curve] of curves.entries()) {
        let path = drawn.get(curve.key);
        if (!path) {
          path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.dataset.flowCurve = curve.key;
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', 'currentColor');
          path.setAttribute('stroke-width', '1.5');
          drawn.set(curve.key, path);
        }
        path.setAttribute('d', curve.path);
        path.setAttribute('opacity', String(curve.opacity));
        path.setAttribute('class', `wallet-flow-curve${curve.selected ? ' is-selected' : ''}`);
        path.setAttribute(
          'marker-end',
          `url(#${markerId}-${curve.selected ? 'selected' : 'quiet'})`,
        );
        if (paths.children[index] !== path) paths.insertBefore(path, paths.children[index] ?? null);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observed = new Set<Element>();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const observeCards = () => {
      const targets = new Set<Element>([
        columns,
        ...columns.querySelectorAll('.wallet-flow-node, .wallet-flow-entries'),
      ]);
      for (const target of observed)
        if (!targets.has(target)) {
          resize?.unobserve(target);
          observed.delete(target);
        }
      for (const target of targets)
        if (!observed.has(target)) {
          resize?.observe(target);
          observed.add(target);
        }
      schedule();
    };
    const mutations = new MutationObserver((records) => {
      // SVG paint updates must not trigger another measurement frame.
      if (
        records.some(
          (record) =>
            !(
              record.target instanceof Element ? record.target : record.target.parentElement
            )?.closest('svg'),
        )
      )
        observeCards();
    });
    mutations.observe(columns, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    columns.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    observeCards();
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      columns.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      paths.replaceChildren();
    };
  }, [columnsRef, markerId]);
  return (
    <svg ref={overlay} className="wallet-flow-connections" aria-hidden="true" focusable="false">
      <defs>
        {(['quiet', 'selected'] as const).map((tone) => (
          <marker
            key={tone}
            id={`${markerId}-${tone}`}
            className={`wallet-flow-arrowhead${tone === 'selected' ? ' is-selected' : ''}`}
            viewBox="0 0 8 6"
            refX="0"
            refY="3"
            markerWidth="8"
            markerHeight="7"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M 0 0 L 8 3 L 0 6 Z" fill="currentColor" />
          </marker>
        ))}
      </defs>
      <g className="wallet-flow-paths" />
    </svg>
  );
}

function FlowTransactionFacts({
  transaction,
  workspace,
}: {
  transaction: WalletReviewContext['transaction'];
  workspace: Workspace;
}) {
  const status = transactionStatus(transaction);
  const time = transactionBlockTime(transaction);
  const fee = transactionFee(workspace, transaction);
  return (
    <dl className="wallet-flow-transaction-facts">
      <div className="wallet-flow-placement">
        <dt className="sr-only">Block</dt>
        <dd title={status.title}>{status.label}</dd>
      </div>
      {fee && (
        <div className="wallet-flow-fee-rate">
          <dt className="sr-only">Fee rate</dt>
          <dd>{fee.feeRateSatVb.toFixed(2)} sat/vB</dd>
        </div>
      )}
      {time && (
        <div className="wallet-flow-time">
          <dt className="sr-only">Block timestamp</dt>
          <dd>
            <time dateTime={time.iso} title={`Block timestamp: ${time.exact}`}>
              {time.compact}
            </time>
          </dd>
        </div>
      )}
      {status.kind === 'confirmed' && (
        <div className="wallet-flow-fee">
          <dt className="sr-only">Fee</dt>
          <dd>{fee ? formatSats(fee.feeSats) : 'Fee unknown'}</dd>
        </div>
      )}
    </dl>
  );
}

function FlowColumn({
  title,
  kind,
  entries,
  workspace,
  editingId,
  onVisibleEntriesChange,
}: {
  title: string;
  kind: 'input' | 'output';
  entries: WalletReviewFlowEntry[];
  workspace: Workspace;
  editingId?: string;
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
    <div
      className={`wallet-flow-column${limit === 2 ? ' is-collapsed' : ''}`}
      data-flow-side={kind}
    >
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
          const annotation = workspace.annotations.entities[entry.id];
          const addressId = entry.address ? `addr:${entry.address}` : undefined;
          const addressAnnotation = addressId
            ? workspace.annotations.entities[addressId]
            : undefined;
          const addressPrimary = !!editingAddress && entry.address === editingAddress;
          const opReturn = isOpReturn(entry.scriptPubKey?.hex);
          const scriptOutput = !entry.address && !entry.missing && !!entry.scriptPubKey;
          const role = entry.coinbase
            ? 'Coinbase'
            : opReturn
              ? 'Unspendable'
              : entry.ownership === 'wallet'
                ? 'Your wallet'
                : entry.ownership === 'external'
                  ? undefined
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
              data-flow-entry={index}
              role="group"
              aria-label={
                selected
                  ? `Editing ${addressPrimary ? 'address' : kind}`
                  : kind === 'input'
                    ? 'Input'
                    : 'Output'
              }
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
              {entry.coinbase ? (
                <strong>Newly mined coins</strong>
              ) : (
                <WalletReference
                  preferFull
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
              {opReturn && <OpReturnData hex={entry.scriptPubKey?.hex} />}
              <div className="wallet-flow-node-footer">
                {role && (
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
                )}
                <Amount
                  className="wallet-flow-amount"
                  value={entry.valueSats}
                  unknown="Value not loaded"
                />
              </div>
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

function FlowTags({ workspace, node }: { workspace: Workspace; node: GraphNode }) {
  const tags = listTagsForNode(workspace, node);
  if (!tags.length) return null;
  return (
    <span className="wallet-flow-tags" aria-label="Tags">
      {tags.map((tag) => (
        <span className="wallet-flow-tag" key={tag.id} title={tag.name}>
          <i style={{ backgroundColor: tag.color }} aria-hidden="true" />
          {tag.name}
        </span>
      ))}
    </span>
  );
}
