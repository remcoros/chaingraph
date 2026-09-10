import type { Network, Transaction } from '../domain/types';

export type FetchPriority = 'navigation' | 'visible' | 'background';
const MAX_ACTIVE_TRANSACTIONS = 12;
const MAX_ACTIVE_PER_NETWORK = 8;
const MAX_NON_NAVIGATION_TRANSACTIONS = 10;
const MAX_NON_NAVIGATION_PER_NETWORK = 3;
export const TRANSACTION_BATCH_CONCURRENCY = 4;

const rank = { navigation: 0, visible: 1, background: 2 };
const abortError = () => new DOMException('Transaction request cancelled.', 'AbortError');

/** One unlocked session owns its in-flight transaction requests. */
export class TransactionFetchScope {
  closed = false;
  readonly jobs = new Set<Job>();
  constructor(readonly network?: Network) {}
  close() {
    this.closed = true;
    this.jobs.clear();
  }
}
export interface TransactionFetchHints {
  scope?: TransactionFetchScope;
  priority?: FetchPriority;
  /** Unique per refresh operation. Never join a read that started before this observation. */
  observation?: object;
}
interface Consumer {
  priority: FetchPriority;
  resolve: (value: Transaction) => void;
  reject: (reason: unknown) => void;
  detach: () => void;
}
interface Job {
  scope: TransactionFetchScope;
  network: Network;
  key: string;
  observation?: object;
  priority: FetchPriority;
  state: 'queued' | 'active';
  controller: AbortController;
  consumers: Set<Consumer>;
  load: (signal: AbortSignal) => Promise<Transaction>;
}

/** Transaction orchestration only. A job includes fallback/header RPCs, never nested scheduler work. */
export class TransactionScheduler {
  private jobs = new Set<Job>();
  private draining = false;
  private lastNetwork?: Network;
  readonly standalone = new TransactionFetchScope();

  request(
    network: Network,
    key: string,
    load: Job['load'],
    signal?: AbortSignal,
    hints: TransactionFetchHints = {},
  ): Promise<Transaction> {
    const scope = hints.scope ?? this.standalone;
    if (scope.closed || signal?.aborted) return Promise.reject(abortError());
    if (scope.network && scope.network !== network)
      return Promise.reject(new Error('Transaction request belongs to a different network.'));
    const priority = hints.priority ?? 'visible';
    let job = [...scope.jobs].find(
      (j) =>
        j.network === network &&
        j.key === key &&
        j.observation === hints.observation &&
        !j.controller.signal.aborted,
    );
    if (!job) {
      const queued = [...this.jobs].filter((j) => j.state === 'queued').length;
      // Leave admission space for navigation even when callers exceed their own bounded waves.
      if (queued >= (priority === 'navigation' ? 128 : 112))
        return Promise.reject(
          new Error('Transaction queue is full. Wait for activity to finish and retry.'),
        );
      job = {
        scope,
        network,
        key,
        observation: hints.observation,
        priority,
        state: 'queued',
        controller: new AbortController(),
        consumers: new Set(),
        load,
      };
      this.jobs.add(job);
      scope.jobs.add(job);
    }
    if (job.consumers.size >= 64)
      return Promise.reject(new Error('Too many consumers for this transaction. Retry shortly.'));
    const owned = job;
    const promise = new Promise<Transaction>((resolve, reject) => {
      const cancel = () => {
        consumer.detach();
        owned.consumers.delete(consumer);
        reject(abortError());
        if (!owned.consumers.size) {
          owned.controller.abort();
          owned.scope.jobs.delete(owned);
          // Keep an aborted physical loader counted until it actually settles.
          if (owned.state === 'queued') this.jobs.delete(owned);
        } else this.promote(owned);
        this.drain();
      };
      const consumer: Consumer = {
        priority,
        resolve,
        reject,
        detach: () => signal?.removeEventListener('abort', cancel),
      };
      owned.consumers.add(consumer);
      signal?.addEventListener('abort', cancel, { once: true });
    });
    this.promote(owned);
    this.drain();
    return promise;
  }
  dispose(scope: TransactionFetchScope) {
    scope.close();
    for (const job of this.jobs) {
      if (job.scope !== scope) continue;
      job.controller.abort();
      for (const consumer of job.consumers) {
        consumer.detach();
        consumer.reject(abortError());
      }
      job.consumers.clear();
      if (job.state === 'queued') this.jobs.delete(job);
    }
    this.drain();
  }
  private promote(job: Job) {
    const first = [...job.consumers].sort((a, b) => rank[a.priority] - rank[b.priority])[0];
    if (first) {
      job.priority = first.priority;
    }
  }
  private drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const active = [...this.jobs].filter((j) => j.state === 'active');
        if (active.length >= MAX_ACTIVE_TRANSACTIONS) break;
        const candidates = [...this.jobs]
          .filter((j) => {
            if (j.state !== 'queued') return false;
            const sameNetwork = active.filter((a) => a.network === j.network);
            if (sameNetwork.length >= MAX_ACTIVE_PER_NETWORK) return false;
            return (
              j.priority === 'navigation' ||
              (active.filter((a) => a.priority !== 'navigation').length <
                MAX_NON_NAVIGATION_TRANSACTIONS &&
                sameNetwork.filter((a) => a.priority !== 'navigation').length <
                  MAX_NON_NAVIGATION_PER_NETWORK)
            );
          })
          .sort(
            (a, b) =>
              rank[a.priority] - rank[b.priority] ||
              Number(a.network === this.lastNetwork) - Number(b.network === this.lastNetwork),
          );
        const job = candidates[0];
        if (!job) break;
        job.state = 'active';
        this.lastNetwork = job.network;
        // Promise boundary catches synchronous loaders and prevents reentrant queue deadlocks.
        void Promise.resolve()
          .then(() => {
            job.controller.signal.throwIfAborted();
            return job.load(job.controller.signal);
          })
          .then(
            (value) => this.finish(job, value),
            (error: unknown) => this.finish(job, undefined, error),
          );
      }
    } finally {
      this.draining = false;
    }
  }
  private finish(job: Job, value?: Transaction, error?: unknown) {
    this.jobs.delete(job);
    job.scope.jobs.delete(job);
    if (job.consumers.size) {
      for (const consumer of job.consumers) {
        consumer.detach();
        if (!value) consumer.reject(error);
        else {
          // Each consumer owns its result, including nested prevouts. No resolved cache or failure cache.
          try {
            consumer.resolve(structuredClone(value));
          } catch (e) {
            consumer.reject(e);
          }
        }
      }
      job.consumers.clear();
    }
    this.drain();
  }
}
export const transactionScheduler = new TransactionScheduler();
