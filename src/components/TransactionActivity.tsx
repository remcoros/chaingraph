import { memo, useRef, useState, useSyncExternalStore } from 'react';
import { Activity } from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
import type { TransactionFetchScope, FetchKind } from '../lib/transactionScheduler';
import './transaction-activity.css';

const labels: Record<FetchKind, string> = {
  transaction: 'Loading transactions',
  inputs: 'Loading input details',
  refresh: 'Wallet / address refresh',
  spending: 'Checking spending transactions',
};
function ActivityDetails({ scope }: { scope: TransactionFetchScope }) {
  const rows = useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const failed = rows.some((row) => row.failed > 0);
  return (
    <>
      <p>
        Transaction fetching only. History discovery, UTXO checks, analysis and encryption are not
        counted.
      </p>
      {rows.length ? (
        <ul className="transaction-activity-list">
          {rows.map((row) => (
            <li key={`${row.network}:${row.kind}`}>
              <strong>{labels[row.kind]}</strong>
              <small>{row.network}</small>
              <span>
                {row.active} active · {row.queued} queued
              </span>
              <span>
                {row.done} done · {row.failed} failed · {row.cancelled} cancelled
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No transaction fetch activity in this session.</p>
      )}
      <p>
        Up to 6 active requests, with room for navigation. Shared requests count once. Recent
        results cover the last 30 requests.
      </p>
      {failed && (
        <p role="status">
          Some transactions could not load. Check the connection, then retry from the original view.
          A failure is not an empty result.
        </p>
      )}
      <button
        type="button"
        onClick={scope.clearRecent}
        disabled={!rows.some((r) => r.done + r.failed + r.cancelled)}
      >
        Clear recent results
      </button>
    </>
  );
}
export const TransactionActivity = memo(function TransactionActivity({
  scope,
  operation,
  onCancel,
}: {
  scope: TransactionFetchScope;
  operation?: string;
  onCancel: () => void;
}) {
  const summary = useSyncExternalStore(scope.subscribe, scope.getSummary);
  const [active, queued] = summary.split(':');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        className="transaction-activity-trigger"
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'transaction-activity' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Activity size={13} /> Activity{' '}
        <span>
          {active} active · {queued} queued
        </span>
      </button>
      {open && trigger.current && (
        <AnchoredPopover
          id="transaction-activity"
          anchor={trigger.current}
          title="Transaction activity"
          width={350}
          className="transaction-activity"
          onClose={() => setOpen(false)}
        >
          <ActivityDetails scope={scope} />
          {operation && (
            <div className="transaction-activity-cancel">
              <button type="button" onClick={onCancel}>
                Cancel current action
              </button>
              <p>
                Cancels the action shown in the statusbar. Other views can still need a shared
                request. Completed work is retained.
              </p>
            </div>
          )}
        </AnchoredPopover>
      )}
    </>
  );
});
