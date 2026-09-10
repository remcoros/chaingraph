import {
  ScanBudgetExceeded,
  validateScanSettings,
  type ScanBudget,
  type ScanRun,
} from '../domain/connectionScan';
import type { Transaction } from '../domain/types';
import { createConnectionScanFetch, type ConnectionScanFetchOptions } from './connectionScanFetch';
import type {
  ConnectionScanRequest,
  ScanWorkerInput,
  ScanWorkerOutput,
} from './connectionScanProtocol';
export type { ConnectionScanRequest } from './connectionScanProtocol';
export interface ConnectionScanRunnerOptions extends Omit<ConnectionScanFetchOptions, 'signal'> {
  request: ConnectionScanRequest;
  signal?: AbortSignal;
  onProgress?: (run: ScanRun) => void;
  /** Captured workspace/session ownership, checked before any accepted reply. */
  isCurrent?: () => boolean;
  workerFactory?: () => Worker;
}
export interface ConnectionScanOutcome {
  run: ScanRun;
  evidence: Record<string, Transaction>;
}

/** One worker and transient evidence pool per explicit run; never resumes saved work. */
export function runConnectionScanInWorker(
  options: ConnectionScanRunnerOptions,
): Promise<ConnectionScanOutcome> {
  const settings = validateScanSettings(options.request.settings);
  if (options.scope.closed || options.isCurrent?.() === false)
    return Promise.reject(new DOMException('Scan session closed.', 'AbortError'));
  const request = structuredClone({ ...options.request, settings });
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const adapter = createConnectionScanFetch({ ...options, signal, fanOut: settings.fanOut });
  const deadline = Date.now() + settings.maxMilliseconds;
  let worker: Worker;
  try {
    worker =
      options.workerFactory?.() ??
      new Worker(new URL('./connectionScan.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.reject(new Error('Could not start the scan worker. Retry the scan.'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastRequest = 0;
    let lastProgress = 0;
    let examinedCount = 0;
    const send = (message: ScanWorkerInput) => {
      if (!settled) worker.postMessage(message);
    };
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      controller.abort();
      worker.terminate();
      options.signal?.removeEventListener('abort', cancel);
      options.scope.signal.removeEventListener('abort', close);
    };
    const fail = (error: Error) => {
      if (!settled) {
        cleanup();
        reject(error);
      }
    };
    const close = () => fail(new DOMException('Scan session closed.', 'AbortError'));
    const current = () => {
      if (settled) return false;
      if (options.scope.closed || options.isCurrent?.() === false) {
        close();
        return false;
      }
      return true;
    };
    const cancel = () => {
      send({ type: 'cancel' });
    };
    // Stop leaf RPCs on the deadline even if a transport has yet to reply.
    const timer = setTimeout(() => controller.abort(), settings.maxMilliseconds);
    options.signal?.addEventListener('abort', cancel, { once: true });
    options.scope.signal.addEventListener('abort', close, { once: true });
    worker.onerror = () => fail(new Error('Scan worker stopped unexpectedly. Retry the scan.'));
    worker.onmessage = (event: MessageEvent<ScanWorkerOutput>) => {
      if (!current()) return;
      const message = event.data;
      if (message.type === 'error') {
        fail(new Error('Could not complete the scan. Retry with smaller limits.'));
        return;
      }
      if (message.type === 'progress') {
        if (Date.now() - lastProgress >= 100 || message.run.status !== 'running') {
          lastProgress = Date.now();
          options.onProgress?.({
            ...message.run,
            examined: Math.max(examinedCount, message.run.examined),
          });
        }
        return;
      }
      if (message.type === 'complete') {
        const ids = new Set(
          message.run.results.flatMap((result) => result.path.map((id) => id.split(':')[1]!)),
        );
        const evidence = Object.fromEntries(
          [...ids].flatMap((id) => (adapter.evidence[id] ? [[id, adapter.evidence[id]]] : [])),
        );
        cleanup();
        resolve({
          run: { ...message.run, examined: Math.max(examinedCount, message.run.examined) },
          evidence,
        });
        return;
      }
      if (!Number.isSafeInteger(message.id) || message.id <= lastRequest) return;
      lastRequest = message.id;
      const examined = new Set(message.examinedTxids);
      examinedCount = Math.max(examinedCount, examined.size);
      const initial = new Set(examined);
      const budget: ScanBudget = {
        get examined() {
          return examined.size;
        },
        get examinedTxids() {
          return [...examined];
        },
        checkpoint() {
          if (Date.now() >= deadline) throw new ScanBudgetExceeded('time');
          if (signal.aborted) throw new ScanBudgetExceeded('cancelled');
          if (!current()) throw new ScanBudgetExceeded('cancelled');
        },
        examine(txid) {
          this.checkpoint();
          if (examined.has(txid)) return;
          if (examined.size >= settings.maxTransactions)
            throw new ScanBudgetExceeded('transactions');
          examined.add(txid);
          examinedCount = Math.max(examinedCount, examined.size);
        },
      };
      const examinedTxids = () => [...examined].filter((id) => !initial.has(id));
      void adapter.resolveNeighbors(message.nodeId, message.direction, budget).then(
        (neighbors) => {
          if (current())
            send({ type: 'neighbors', id: message.id, neighbors, examinedTxids: examinedTxids() });
        },
        (error: unknown) => {
          if (current())
            send({
              type: 'neighbors',
              id: message.id,
              examinedTxids: examinedTxids(),
              error:
                error instanceof ScanBudgetExceeded
                  ? error.reason
                  : signal.aborted
                    ? Date.now() >= deadline
                      ? 'time'
                      : 'cancelled'
                    : 'failure',
            });
        },
      );
    };
    try {
      send({ type: 'start', request });
      if (options.signal?.aborted) cancel();
    } catch {
      fail(new Error('Could not dispatch the scan. Retry the scan.'));
    }
  });
}
