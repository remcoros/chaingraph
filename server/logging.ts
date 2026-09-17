import type { Network } from './config';
import { SafeError } from './errors';

type Component = 'bitcoin-rpc' | 'electrum' | 'http-api';

interface Failure {
  readonly component: Component;
  readonly operation: string;
  readonly error: unknown;
  readonly network?: Network;
}

/**
 * Emits operational diagnostics without serializing request bodies,
 * credentials, headers, configured endpoint URLs, or upstream response bodies.
 * A Node transport message can still include the host or address reported by
 * the operating system.
 */
export function logFailure({ component, operation, error, network }: Failure) {
  const status = error instanceof SafeError ? error.status : 502;
  const errno = error as NodeJS.ErrnoException;
  const level = status >= 500 ? 'error' : 'warn';
  const record = {
    level,
    event: 'backend_request_failed',
    component,
    operation,
    ...(network ? { network } : {}),
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message : 'Unknown failure',
    ...(typeof errno.code === 'string' ? { errorCode: errno.code } : {}),
    ...(error instanceof SafeError ? { status } : {}),
  };
  if (level === 'error') console.error(JSON.stringify(record));
  else console.warn(JSON.stringify(record));
}
