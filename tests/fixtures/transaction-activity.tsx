import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { TransactionActivity } from '../../src/components/TransactionActivity';
import { TransactionFetchScope, TransactionScheduler } from '../../src/lib/transactionScheduler';
import type { Transaction } from '../../src/domain/types';

// Exercise the real scheduler with synthetic in-memory jobs; no chain requests or storage.
const scope = new TransactionFetchScope('testnet4');
const scheduler = new TransactionScheduler();
const owner = new AbortController();
const tx: Transaction = {
  txid: 'a'.repeat(64),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
};
const scenario = new URLSearchParams(location.search).get('scenario') ?? 'idle';
let finishShared: (() => void) | undefined;
let sharedAborted = false;
declare global {
  interface Window {
    activityFixture: { finishShared: () => void; sharedAborted: () => boolean };
  }
}
window.activityFixture = {
  finishShared: () => finishShared?.(),
  sharedAborted: () => sharedAborted,
};
async function seed() {
  if (scenario === 'idle' || scenario === 'history') return;
  for (let i = 0; i < 4; i++) {
    await scheduler.request('testnet4', `done${i}`, async () => tx, undefined, {
      scope,
      priority: 'background',
      kind: 'refresh',
    });
  }
  if (scenario === 'failed') {
    await scheduler
      .request(
        'testnet4',
        'failed',
        async () => {
          throw new Error('Synthetic unavailable transaction');
        },
        undefined,
        { scope, kind: 'spending' },
      )
      .catch(() => undefined);
  }
  for (let i = 0; i < 8; i++) {
    void scheduler
      .request(
        'testnet4',
        `pending${i}`,
        (signal) =>
          new Promise<Transaction>((resolve, reject) => {
            if (i === 0) finishShared = () => resolve(tx);
            signal.addEventListener(
              'abort',
              () => {
                if (i === 0) sharedAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
        owner.signal,
        { scope, priority: 'background', kind: 'refresh' },
      )
      .catch(() => undefined);
  }
  // One visible consumer still needs the first request after the scan is cancelled.
  void scheduler.request('testnet4', 'pending0', async () => tx, undefined, {
    scope,
    priority: 'visible',
    kind: 'inputs',
  });
}
function Fixture() {
  const [operation, setOperation] = useState(
    scenario === 'idle'
      ? ''
      : scenario === 'history'
        ? 'Checking address history…'
        : scenario === 'long'
          ? `Refreshing ${'LongWalletName'.repeat(12)}…`
          : 'Refreshing sample wallet…',
  );
  const [cancelled, setCancelled] = useState(false);
  return (
    <div className="app-shell" style={{ minHeight: '100vh' }}>
      <main style={{ padding: 24 }}>
        <h1>Activity fixture</h1>
        <output aria-label="Action cancelled">{String(cancelled)}</output>
      </main>
      <footer className="statusbar" style={{ position: 'fixed', bottom: 0, width: '100%' }}>
        <span>Sample workspace</span>
        <TransactionActivity
          scope={scope}
          operation={operation}
          onCancel={() => {
            owner.abort();
            setOperation('');
            setCancelled(true);
          }}
        />
      </footer>
    </div>
  );
}
void seed().then(() => createRoot(document.getElementById('root')!).render(<Fixture />));
