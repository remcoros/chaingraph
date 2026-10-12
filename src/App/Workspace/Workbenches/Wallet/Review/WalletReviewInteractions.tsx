import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Circle, CircleCheck, Clock3, Plus, TriangleAlert, Undo2 } from 'lucide-react';
import { AnchoredPopover } from '../../../../Controls/AnchoredPopover';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';
import { WalletHelp } from '../../../../Controls/Display/WalletHelp';
import { transactionFee } from '../../../../Controls/Display/transactionFee';
import { formatSats } from '../../../../../Core/Formatting';
import {
  isCompletedReview,
  reviewKey,
  type WalletReviewItem,
} from '../../../../../Core/Workspace/Wallets/walletReview';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { WalletRow } from '../walletRows';

export type WalletDecisionAction =
  'reviewed' | 'later' | 'reopen' | 'cannot-identify' | 'not-needed';

export function WalletDecisionButtons({
  items,
  busy,
  onDecide,
  presentation = 'buttons',
  children,
}: {
  presentation?: 'buttons' | 'contextual' | 'inline';
  children?: ReactNode;
  items: readonly WalletReviewItem[];
  busy: boolean;
  onDecide: (items: readonly WalletReviewItem[], action: WalletDecisionAction) => void;
}) {
  const compact = presentation !== 'buttons';
  const actionable = items.filter((item) => !item.legacyOutputReview && !item.satisfied);
  if (!actionable.length) return null;
  const completed = actionable.every(
    (item) =>
      !item.changed &&
      item.status !== 'open' &&
      item.status !== 'resolved' &&
      isCompletedReview({ status: item.status }),
  );
  const later = actionable.every((item) => !item.changed && item.status === 'later');
  const findings = actionable.filter((item) => item.kind === 'finding');
  const goals = actionable.filter((item) => item.kind === 'annotation-goal');
  const choices = completed ? (
    <button disabled={busy} onClick={() => onDecide(actionable, 'reopen')}>
      {!compact && <Undo2 size={14} />} Reopen
    </button>
  ) : later ? (
    <button disabled={busy} onClick={() => onDecide(actionable, 'reopen')}>
      {!compact && <Clock3 size={14} />}
      {compact ? 'Reopen' : 'Return to review'}
    </button>
  ) : (
    <>
      {findings.length > 0 && (
        <button
          className={
            presentation === 'inline' ? 'wallet-review-confirm' : compact ? undefined : 'primary'
          }
          disabled={busy}
          onClick={() => onDecide(findings, 'reviewed')}
        >
          {presentation === 'inline' && (
            <Check className="wallet-review-confirm-icon" size={14} aria-hidden="true" />
          )}
          {items.length === 1 ? 'Mark reviewed' : 'Mark findings reviewed'}
        </button>
      )}
      {goals.length > 0 && (
        <>
          <button disabled={busy} onClick={() => onDecide(goals, 'cannot-identify')}>
            {compact ? 'Unknown' : 'Cannot identify'}
          </button>
          <button disabled={busy} onClick={() => onDecide(goals, 'not-needed')}>
            {compact ? 'Not needed' : 'No annotation needed'}
          </button>
        </>
      )}
      <button
        className="wallet-review-defer"
        disabled={busy}
        onClick={() => onDecide(actionable, 'later')}
      >
        {!compact && <Clock3 size={14} />}
        {compact ? 'Later' : 'Review later'}
      </button>
    </>
  );
  return (
    <div
      className={`button-row wallet-review-decisions compact-controls${presentation === 'inline' ? ' wallet-review-inline-actions' : ''}`}
    >
      {presentation === 'contextual' ? (
        <>
          {children && <div className="wallet-review-preferred-action">{children}</div>}
          <div className="wallet-review-alternatives">{choices}</div>
        </>
      ) : (
        <>
          {children}
          {choices}
        </>
      )}
    </div>
  );
}

function reviewStateLabel(item: WalletReviewItem) {
  if (item.changed) return 'Evidence changed';
  if (item.satisfied) return 'Complete';
  switch (item.status) {
    case 'cannot-identify':
      return 'Unknown';
    case 'not-needed':
      return 'Not needed';
    case 'later':
      return 'Later';
    case 'reviewed':
      return 'Reviewed';
    case 'unknown':
      return 'Recorded unknown';
    default:
      return item.goal === 'counterparty-context'
        ? 'Not identified'
        : item.kind === 'finding'
          ? 'Needs review'
          : 'Not described';
  }
}

type ReviewInteractionProps = {
  active: boolean;
  busy: boolean;
  row: WalletRow;
  onDecide: (items: readonly WalletReviewItem[], action: WalletDecisionAction) => void;
  onOpenReviewItem?: (row: WalletRow, item: WalletReviewItem) => void;
};

function ReviewStateIcon({ item }: { item: WalletReviewItem }) {
  const Icon = item.changed
    ? TriangleAlert
    : item.satisfied || isCompletedReview(item)
      ? CircleCheck
      : item.status === 'later'
        ? Clock3
        : Circle;
  return <Icon size={14} aria-hidden="true" />;
}

function ReviewContext({
  item,
  row,
  onOpenReviewItem,
}: Pick<ReviewInteractionProps, 'row' | 'onOpenReviewItem'> & { item: WalletReviewItem }) {
  return (
    <>
      {item.kind === 'finding' ? (
        item.detail && <p>{item.detail}</p>
      ) : (
        <p>
          {item.goal === 'counterparty-context'
            ? item.title
            : item.goal === 'coin-context'
              ? 'What is this coin for?'
              : item.goal === 'address-context'
                ? 'What is this address for?'
                : 'What was this transaction for?'}
        </p>
      )}
      {item.nodeId !== row.nodeId && item.txid && (
        <div className="wallet-review-context-target">
          <span className="muted">Transaction</span>
          {onOpenReviewItem ? (
            <button className="text-button" onClick={() => onOpenReviewItem(row, item)}>
              <code>
                <ResponsiveIdentifier value={item.txid} />
              </code>
            </button>
          ) : (
            <code>
              <ResponsiveIdentifier value={item.txid} />
            </code>
          )}
        </div>
      )}
    </>
  );
}

/** Annotation review separates the editing shortcut from alternative resolutions. */
function AnnotationReviewPopover({
  anchor,
  title,
  items,
  onClose,
  editor,
  label,
  ...props
}: ReviewInteractionProps & {
  anchor: HTMLButtonElement;
  title: string;
  label: string;
  items: readonly WalletReviewItem[];
  onClose: () => void;
  editor?: HTMLButtonElement | null;
}) {
  const id = useId();
  const editLabel = label.toLowerCase();
  return (
    <AnchoredPopover
      id={id}
      anchor={anchor}
      title={title}
      width={300}
      className="wallet-review-popover compact-controls"
      onClose={onClose}
    >
      <div className="wallet-field-review-context">
        {items.map((item) => (
          <section key={item.key} aria-label={item.title}>
            <ReviewContext item={item} row={props.row} onOpenReviewItem={props.onOpenReviewItem} />
            <WalletDecisionButtons
              items={[item]}
              busy={props.busy}
              presentation="contextual"
              onDecide={(items, action) => {
                props.onDecide(items, action);
                onClose();
              }}
            >
              {editor && (
                <button
                  className="primary"
                  data-autofocus
                  disabled={props.busy || editor.disabled}
                  onClick={() => {
                    onClose();
                    // Let the review dialog return focus before opening the existing field editor.
                    requestAnimationFrame(() => {
                      if (!editor.isConnected || editor.disabled) return;
                      editor.focus({ preventScroll: true });
                      editor.click();
                    });
                  }}
                >
                  <Plus size={14} /> Add {editLabel}
                </button>
              )}
            </WalletDecisionButtons>
          </section>
        ))}
      </div>
    </AnchoredPopover>
  );
}

/** Annotation review belongs to its field; decisions still use canonical review keys. */
export function WalletFieldReview({
  items,
  label,
  focusedReviewKey,
  ...props
}: ReviewInteractionProps & {
  items: readonly WalletReviewItem[];
  label: string;
  focusedReviewKey?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement>();
  const [lastFocus, setLastFocus] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const visible = items.filter((item) => !item.satisfied && !item.legacyOutputReview);
  const targeted = !!focusedReviewKey && visible.some((item) => item.key === focusedReviewKey);
  useLayoutEffect(() => {
    if (props.active && targeted && focusedReviewKey !== lastFocus && trigger.current) {
      setLastFocus(focusedReviewKey);
      setAnchor(trigger.current);
    }
  }, [props.active, targeted, focusedReviewKey, lastFocus]);
  if (anchor && !props.active) setAnchor(undefined);
  if (!visible.length) return null;
  const pending = visible.some(
    (item) => item.changed || (item.status !== 'later' && !isCompletedReview(item)),
  );
  const deferred = !pending && visible.some((item) => item.status === 'later');
  const state = pending
    ? 'Needs review'
    : deferred
      ? 'Later'
      : visible.length === 1
        ? reviewStateLabel(visible[0])
        : 'Resolved';
  // The field remains the editor owner. Use its ordinary trigger, including an exact source association.
  const editor = anchor
    ?.closest('.wallet-inline-field')
    ?.querySelector<HTMLButtonElement>('button.wallet-field-value');
  return (
    <>
      <button
        ref={trigger}
        className={`wallet-review-indicator ${pending ? 'is-pending' : deferred ? 'is-deferred' : 'is-decided'}`}
        data-tour="wallet-review-goals"
        aria-label={`${label} review`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        disabled={!props.active}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {deferred && <Clock3 size={11} />}
        {state}
        {visible.length > 1 && <span>({visible.length})</span>}
      </button>
      {anchor && (
        <AnnotationReviewPopover
          {...props}
          anchor={anchor}
          title={`${label} ${pending ? 'needs review' : 'review'}`}
          label={label}
          items={visible}
          editor={editor}
          onClose={() => setAnchor(undefined)}
        />
      )}
    </>
  );
}

/** Independent findings expose decisions directly; explanation stays secondary. */
export function WalletReviewChecklist({
  items,
  workspace,
  walletId,
  ...props
}: ReviewInteractionProps & {
  items: readonly WalletReviewItem[];
  workspace: Workspace;
  walletId: string;
}) {
  return (
    <ul className="wallet-review-checklist">
      {items.map((item) => {
        const finding =
          item.kind === 'finding'
            ? workspace.analysis.findings.find(
                (finding) => reviewKey(walletId, 'link', finding.id) === item.key,
              )
            : undefined;
        // Value-flow v2 observation findings are reconciled fees, with their scan-time threshold result.
        const feeFinding = finding?.algorithm === 'value-flow-v2' && finding.kind === 'observation';
        const fee =
          (feeFinding || finding?.reviewRule === 'fee-threshold') && item.txid
            ? transactionFee(workspace, workspace.chainData.transactions[item.txid])
            : undefined;
        const title = feeFinding ? 'Network fee' : item.title;
        const pending =
          item.changed || (item.status !== 'later' && !isCompletedReview(item) && !item.satisfied);
        const threshold =
          feeFinding && fee && !item.changed && !finding.stale
            ? finding.reviewRule === 'fee-threshold'
              ? 'Threshold reached'
              : 'Below threshold'
            : undefined;
        const scriptSummary =
          finding?.algorithm === 'script-types-v2'
            ? finding.kind === 'incomplete'
              ? 'Script data incomplete'
              : 'Different script types detected'
            : undefined;
        const explanation = finding?.details || item.detail;
        return (
          <li key={item.key}>
            <section
              className={`wallet-independent-review${pending ? ' is-pending' : ''}`}
              aria-label={item.title}
            >
              <ReviewStateIcon item={item} />
              <div className="wallet-review-item-content">
                <div className="wallet-review-item-heading">
                  {props.onOpenReviewItem ? (
                    <button
                      className="wallet-review-item-link"
                      disabled={!props.active}
                      onClick={() => props.onOpenReviewItem?.(props.row, item)}
                    >
                      {title}
                    </button>
                  ) : (
                    <span>{title}</span>
                  )}
                  {(!pending || item.changed) && <small>{reviewStateLabel(item)}</small>}
                  {explanation && (
                    <WalletHelp title={`${title} details`} active={props.active}>
                      {explanation}
                    </WalletHelp>
                  )}
                </div>
                {fee ? (
                  <span className="wallet-review-fact muted">
                    {formatSats(fee.feeSats)} · {fee.feeRateSatVb.toFixed(2)} sat/vB
                    {threshold && <span className="wallet-review-threshold">{threshold}</span>}
                  </span>
                ) : feeFinding ? (
                  <span className="wallet-review-fact muted">Fee data unavailable</span>
                ) : (
                  scriptSummary && <span className="wallet-review-fact muted">{scriptSummary}</span>
                )}
              </div>
              <WalletDecisionButtons
                items={[item]}
                busy={!props.active || props.busy}
                presentation="inline"
                onDecide={props.onDecide}
              />
            </section>
          </li>
        );
      })}
    </ul>
  );
}
