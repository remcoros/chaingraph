import { SafeError } from './errors';

/** Bounded transport concurrency. Queue entries are removed on cancellation. */
export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(
    private concurrency: number,
    private maxPending: number,
    private timeoutMs: number,
  ) {}
  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new SafeError('Request cancelled', 408));
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxPending)
      return Promise.reject(new SafeError('Upstream busy; retry later', 503));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      const remove = () => {
        const index = this.queue.indexOf(start);
        if (index >= 0) this.queue.splice(index, 1);
        cleanup();
      };
      const abort = () => {
        remove();
        reject(new SafeError('Request cancelled', 408));
      };
      const start = () => {
        cleanup();
        this.active++;
        resolve();
      };
      const timer = setTimeout(() => {
        remove();
        reject(new SafeError('Upstream queue timed out', 503));
      }, this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(start);
    });
  }
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
