import type { Network, Transaction } from '../domain/types';

export type FetchPriority = 'navigation' | 'visible' | 'background';
export type FetchKind = 'transaction' | 'inputs' | 'refresh' | 'spending';
type State = 'active' | 'queued' | 'done' | 'failed' | 'cancelled';
export interface ActivityRow {
  kind: FetchKind;
  network: Network;
  active: number;
  queued: number;
  done: number;
  failed: number;
  cancelled: number;
}
const MAX_ACTIVE_TRANSACTIONS = 12;
const MAX_ACTIVE_PER_NETWORK = 8;
const MAX_NON_NAVIGATION_TRANSACTIONS = 10;
const MAX_NON_NAVIGATION_PER_NETWORK = 3;
export const TRANSACTION_BATCH_CONCURRENCY = 4;

const rank = { navigation: 0, visible: 1, background: 2 };
const empty: readonly ActivityRow[] = [];
const abortError = () => new DOMException('Transaction request cancelled.', 'AbortError');

/** One unlocked session owns this transient state. No transaction IDs or error payloads in activity. */
export class TransactionFetchScope {
  closed = false;
  readonly jobs = new Set<Job>();
  private recent: { kind: FetchKind; network: Network; state: State }[] = [];
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private snapshot: readonly ActivityRow[] = empty;
  constructor(readonly network?: Network) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  // Primitive summary keeps the closed-panel indicator independent of history updates.
  getSummary = () =>
    `${this.snapshot.reduce((n, r) => n + r.active, 0)}:${this.snapshot.reduce((n, r) => n + r.queued, 0)}`;
  changed() {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.publish();
    }, 80);
  }
  record(job: Job, state: State) {
    if (this.closed) return;
    this.recent.push({ kind: job.kind, network: job.network, state });
    this.recent = this.recent.slice(-30);
    this.changed();
  }
  clearRecent = () => {
    this.recent = [];
    this.publish();
  };
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.jobs.clear();
    this.recent = [];
    this.snapshot = empty;
    for (const listener of this.listeners) listener();
  }
  private publish() {
    if (this.closed) return;
    const rows = new Map<string, ActivityRow>();
    for (const item of [...this.recent, ...this.jobs]) {
      const key = `${item.network}:${item.kind}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          kind: item.kind,
          network: item.network,
          active: 0,
          queued: 0,
          done: 0,
          failed: 0,
          cancelled: 0,
        };
        rows.set(key, row);
      }
      row[item.state]++;
    }
    this.snapshot = [...rows.values()];
    for (const listener of this.listeners) listener();
  }
}
export interface TransactionFetchHints {
  scope?: TransactionFetchScope;
  priority?: FetchPriority;
  kind?: FetchKind;
  /** Unique per refresh operation. Never join a read that started before this observation. */
  observation?: object;
}
interface Consumer {
  priority: FetchPriority;
  kind: FetchKind;
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
  kind: FetchKind;
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
    const kind = hints.kind ?? 'transaction';
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
        kind,
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
          owned.scope.record(owned, 'cancelled');
          // Keep an aborted physical loader counted until it actually settles.
          if (owned.state === 'queued') this.jobs.delete(owned);
        } else this.promote(owned);
        owned.scope.changed();
        this.drain();
      };
      const consumer: Consumer = {
        priority,
        kind,
        resolve,
        reject,
        detach: () => signal?.removeEventListener('abort', cancel),
      };
      owned.consumers.add(consumer);
      signal?.addEventListener('abort', cancel, { once: true });
    });
    this.promote(owned);
    scope.changed();
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
      job.kind = first.kind;
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
        job.scope.changed();
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
      job.scope.record(job, value ? 'done' : 'failed');
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
    job.scope.changed();
    this.drain();
  }
}
export const transactionScheduler = new TransactionScheduler();
