import type { Network } from '../Bitcoin';
import type { Transaction } from './transaction';

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
  private readonly lifetime = new AbortController();
  readonly signal = this.lifetime.signal;
  closed = false;
  readonly jobs = new Set<Job>();
  private sequence = 0;
  private readonly observationSequences = new WeakMap<object, number>();
  private readonly resultSequences = new WeakMap<object, number>();
  constructor(readonly network?: Network) {}
  /** Reserve order before I/O. Sharing a refresh also shares its observation order. */
  beginObservation(identity: object) {
    if (!this.observationSequences.has(identity))
      this.observationSequences.set(identity, ++this.sequence);
  }
  /** Attach request order without serializing runtime counters or retaining results. */
  markObservation(transaction: Transaction, identity: object): Transaction {
    if (!transaction.status) return transaction;
    this.beginObservation(identity);
    const status = {
      ...transaction.status,
      ...(transaction.status.observation && { observation: { ...transaction.status.observation } }),
    };
    this.resultSequences.set(
      status.observation ?? status,
      this.observationSequences.get(identity)!,
    );
    return { ...transaction, status };
  }
  isOlderObservation(incoming: Transaction, current: Transaction): boolean {
    const before =
      current.status && this.resultSequences.get(current.status.observation ?? current.status);
    const after =
      incoming.status && this.resultSequences.get(incoming.status.observation ?? incoming.status);
    return before !== undefined && (after === undefined || after < before);
  }
  /** Order non-transaction observations using the same session request clock. */
  markDataObservation<T extends object>(value: T, identity: object): T {
    this.beginObservation(identity);
    this.resultSequences.set(value, this.observationSequences.get(identity)!);
    return value;
  }
  isOlderDataObservation(incoming: object, current: object): boolean {
    const before = this.resultSequences.get(current);
    const after = this.resultSequences.get(incoming);
    return before !== undefined && (after === undefined || after < before);
  }
  close() {
    this.closed = true;
    this.lifetime.abort();
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
      scope.beginObservation(job.observation ?? job);
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
    let first: Consumer | undefined;
    let firstRank = Infinity;
    for (const consumer of job.consumers) {
      const consumerRank = rank[consumer.priority];
      if (consumerRank < firstRank) {
        first = consumer;
        firstRank = consumerRank;
      }
    }
    if (first) {
      job.priority = first.priority;
    }
  }
  private drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        let active = 0;
        let activeNonNavigation = 0;
        const activeByNetwork = new Map<Network, { total: number; nonNavigation: number }>();
        for (const existing of this.jobs) {
          if (existing.state !== 'active') continue;
          active++;
          const network = existing.network;
          const counts = activeByNetwork.get(network) ?? { total: 0, nonNavigation: 0 };
          counts.total++;
          if (existing.priority !== 'navigation') {
            activeNonNavigation++;
            counts.nonNavigation++;
          }
          activeByNetwork.set(network, counts);
        }
        if (active >= MAX_ACTIVE_TRANSACTIONS) break;

        let job: Job | undefined;
        let jobRank = Infinity;
        let jobLastNetwork = 0;
        const lastNetwork = this.lastNetwork;
        for (const queued of this.jobs) {
          if (queued.state !== 'queued') continue;
          const network = queued.network;
          const counts = activeByNetwork.get(network);
          if ((counts?.total ?? 0) >= MAX_ACTIVE_PER_NETWORK) continue;
          const priority = queued.priority;
          if (
            priority !== 'navigation' &&
            (activeNonNavigation >= MAX_NON_NAVIGATION_TRANSACTIONS ||
              (counts?.nonNavigation ?? 0) >= MAX_NON_NAVIGATION_PER_NETWORK)
          )
            continue;

          const queuedRank = rank[priority];
          const queuedLastNetwork = Number(network === lastNetwork);
          if (
            !job ||
            queuedRank < jobRank ||
            (queuedRank === jobRank && queuedLastNetwork < jobLastNetwork)
          ) {
            job = queued;
            jobRank = queuedRank;
            jobLastNetwork = queuedLastNetwork;
          }
        }
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
            consumer.resolve(
              job.scope.markObservation(structuredClone(value), job.observation ?? job),
            );
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
