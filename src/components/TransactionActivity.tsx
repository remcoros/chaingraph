import { memo, useRef, useState, useSyncExternalStore } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
import type { TransactionFetchScope, FetchKind } from '../lib/transactionScheduler';
import './transaction-activity.css';

const labels: Record<FetchKind, string> = {
  transaction: 'Transactions',
  inputs: 'Input details',
  refresh: 'Wallet / address refresh',
  spending: 'Spending search',
};
function ActivityDetails({
  scope,
  operation,
  onCancel,
}: {
  scope: TransactionFetchScope;
  operation?: string;
  onCancel: () => void;
}) {
  const rows = useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const [recentOpen, setRecentOpen] = useState(false);
  const current = rows.filter((row) => row.active + row.queued > 0);
  const recent = rows.filter((row) => row.done + row.failed + row.cancelled > 0);
  const failed = rows.reduce((count, row) => count + row.failed, 0);
  const multipleNetworks = new Set(rows.map((row) => row.network)).size > 1;
  return (
    <>
      {operation && (
        <div className="transaction-activity-action">
          <span>{operation}</span>
          <button type="button" aria-label="Cancel current action" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {current.length ? (
        <table className="transaction-activity-current" aria-label="Current transaction loads">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Loading</th>
              <th scope="col">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {current.map((row) => (
              <tr key={`${row.network}:${row.kind}`}>
                <th scope="row">
                  {labels[row.kind]}
                  {multipleNetworks && <small>{row.network}</small>}
                </th>
                <td>{row.active}</td>
                <td>{row.queued}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="transaction-activity-empty">No transactions loading.</p>
      )}
      <div role="status" aria-atomic="true" className="transaction-activity-failure">
        {failed > 0 && (
          <>
            <strong>
              {failed} {failed === 1 ? 'load failed' : 'loads failed'}
            </strong>
            <span>Retry from the original view.</span>
          </>
        )}
      </div>
      {recent.length > 0 && (
        <div className="transaction-activity-recent">
          <button
            type="button"
            className="transaction-activity-disclosure"
            aria-expanded={recentOpen}
            aria-controls="transaction-activity-recent"
            onClick={() => setRecentOpen((value) => !value)}
          >
            <ChevronDown size={13} aria-hidden="true" />
            Recent results
          </button>
          {recentOpen && (
            <div id="transaction-activity-recent">
              <ul className="transaction-activity-results">
                {recent.map((row) => (
                  <li key={`${row.network}:${row.kind}`}>
                    <span>
                      {labels[row.kind]}
                      {multipleNetworks && <small>{row.network}</small>}
                    </span>
                    <span className="transaction-activity-outcomes">
                      {row.done > 0 && <span>{row.done} loaded</span>}
                      {row.failed > 0 && (
                        <span className="transaction-activity-error">{row.failed} failed</span>
                      )}
                      {row.cancelled > 0 && <span>{row.cancelled} cancelled</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="transaction-activity-history-footer">
                <span>Last 30 results</span>
                <button
                  type="button"
                  aria-label="Clear recent results"
                  onClick={(event) => {
                    // The history controls disappear after clearing; retain focus in the dialog.
                    event.currentTarget
                      .closest('[role="dialog"]')
                      ?.querySelector<HTMLButtonElement>('button')
                      ?.focus();
                    scope.clearRecent();
                    setRecentOpen(false);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
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
  const [active, queued] = summary.split(':').map(Number);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const counts = [active > 0 ? `${active} loading` : '', queued > 0 ? `${queued} waiting` : '']
    .filter(Boolean)
    .join(' · ');
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
        <Activity size={13} aria-hidden="true" /> Activity
        {(counts || operation) && <span>{counts || 'Working'}</span>}
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
          <ActivityDetails scope={scope} operation={operation} onCancel={onCancel} />
        </AnchoredPopover>
      )}
    </>
  );
});
