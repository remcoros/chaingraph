import { runConnectionScan, ScanBudgetExceeded, type ScanNeighbors } from './connectionScan';
import type { ScanWorkerInput, ScanWorkerOutput } from './connectionScanProtocol';
const controller = new AbortController();
let started = false;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: Extract<ScanWorkerInput, { type: 'neighbors' }>) => void;
    reject: (error: unknown) => void;
  }
>();
const send = (message: ScanWorkerOutput) => self.postMessage(message);
self.onmessage = (event: MessageEvent<ScanWorkerInput>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    controller.abort();
    return;
  }
  if (message.type === 'neighbors') {
    pending.get(message.id)?.resolve(message);
    return;
  }
  if (started) return;
  started = true;
  void runConnectionScan({
    ...message.request,
    resolverOwnsTransactionBudget: true,
    signal: controller.signal,
    onProgress: (run) => send({ type: 'progress', run }),
    resolveNeighbors: async (nodeId, direction, budget, signal): Promise<ScanNeighbors> => {
      signal.throwIfAborted();
      const id = ++sequence;
      const response = await new Promise<Extract<ScanWorkerInput, { type: 'neighbors' }>>(
        (resolve, reject) => {
          const abort = () => {
            pending.delete(id);
            reject(new DOMException('Scan cancelled.', 'AbortError'));
          };
          pending.set(id, {
            resolve: (value) => {
              signal.removeEventListener('abort', abort);
              pending.delete(id);
              resolve(value);
            },
            reject,
          });
          signal.addEventListener('abort', abort, { once: true });
          send({ type: 'resolve', id, nodeId, direction, examinedTxids: budget.examinedTxids });
        },
      );
      for (const txid of response.examinedTxids) budget.examine(txid);
      if (
        response.error === 'transactions' ||
        response.error === 'time' ||
        response.error === 'cancelled'
      )
        throw new ScanBudgetExceeded(response.error);
      if (response.error) throw new Error('Scan evidence unavailable.');
      return response.neighbors ?? { nodeIds: [], stopReason: 'unknown' };
    },
  }).then(
    (run) => send({ type: 'complete', run }),
    () => send({ type: 'error' }),
  );
};
