import { useState } from 'react';
import { TextCursorInput, ListChecks, UsersRound } from 'lucide-react';
import { EntityLabelEditor, MetadataPopover } from '../../../../Controls/Metadata/MetadataEditors';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';
import type { WalletReviewItem } from '../../../../../Core/Workspace/Wallets/walletReview';
import { walletTransactionCounterpartySubject } from '../../../../../Core/Workspace/Counterparties/walletCounterpartySubjects';
import { CounterpartyPicker } from '../WalletCounterparties';
import type { WalletRow } from '../walletRows';
import type { WalletWorkbenchContext } from '../walletWorkbenchContext';

/** Each attention action opens the exact editor or assessment named by its label. */
export function WalletRowAttention({
  workspace,
  wallet,
  row,
  prepared,
  busy,
  onChange,
  onNotice,
  onReview,
}: {
  workspace: Workspace;
  wallet: Wallet;
  row: WalletRow;
  prepared: NonNullable<Parameters<typeof walletTransactionCounterpartySubject>[4]>;
  busy: boolean;
  onChange: WalletWorkbenchContext['onChange'];
  onNotice: (message: string) => void;
  onReview: (row: WalletRow, item: WalletReviewItem) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement>();
  const outstanding = [
    ...new Map(
      row.reviews
        .filter((item) => !item.satisfied && (item.changed || item.status === 'open'))
        .map((item) => [item.key, item]),
    ).values(),
  ];
  const context = outstanding.find(
    (item) =>
      item.nodeId === row.nodeId &&
      (item.goal === 'activity-context' ||
        item.goal === 'coin-context' ||
        item.goal === 'address-context'),
  );
  const party = outstanding.find((item) => item.goal === 'counterparty-context');
  const findings = outstanding.filter((item) => item.kind === 'finding');
  const direction =
    row.walletTransaction?.direction === 'sent' || party?.relationshipKinds?.includes('destination')
      ? 'sent'
      : 'received';
  const subject =
    row.kind !== 'transaction'
      ? { kind: 'entity' as const, subjectId: row.nodeId }
      : row.txid && (party || ['sent', 'received'].includes(row.walletTransaction?.direction ?? ''))
        ? walletTransactionCounterpartySubject(workspace, wallet, row.txid, direction, prepared)
        : undefined;
  const hasLabel = !!workspace.annotations.entities[row.nodeId]?.label;
  const label = hasLabel ? 'Edit label' : 'Add label';
  const review = findings[0] ?? outstanding[0] ?? row.reviews[0];
  return (
    <div className="wallet-row-attention compact-controls">
      {
        <button
          className={`wallet-attention-action${context ? ' needs-context' : ''}`}
          aria-label={label}
          title={label}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            setAnchor(event.currentTarget);
          }}
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
        >
          <TextCursorInput size={14} />
        </button>
      }
      {anchor && (
        <MetadataPopover anchor={anchor} compact onClose={() => setAnchor(undefined)}>
          <EntityLabelEditor
            workspace={workspace}
            entityId={row.nodeId}
            onClose={() => setAnchor(undefined)}
            onApply={(message, update) => {
              onChange(update);
              onNotice(message);
            }}
          />
        </MetadataPopover>
      )}
      {subject ? (
        <CounterpartyPicker
          workspace={workspace}
          subject={subject}
          walletScripthashes={prepared.scripthashes}
          onChange={onChange}
          onNotice={onNotice}
          disabled={busy}
          label={
            row.kind !== 'transaction'
              ? 'Edit counterparties'
              : direction === 'sent'
                ? 'Edit recipients'
                : 'Edit senders'
          }
          iconOnly
        />
      ) : (
        <button
          className="wallet-attention-action"
          disabled
          title="Counterparty unavailable"
          aria-label="Counterparty unavailable"
        >
          <UsersRound size={14} />
        </button>
      )}
      <button
        className="wallet-attention-action wallet-review-shortcut"
        disabled={!review}
        aria-label={`Review items (${outstanding.length})`}
        title={`Review items (${outstanding.length})`}
        onClick={(event) => {
          event.stopPropagation();
          if (review) onReview(row, review);
        }}
      >
        <ListChecks size={14} />
        {outstanding.length > 0 && <span>{outstanding.length}</span>}
      </button>
    </div>
  );
}
