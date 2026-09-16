import { CURRENT_WORKSPACE_VERSION, type Workspace } from '../../workspace';
import { MAX_ENCRYPTED_FILE_BYTES, type EncryptedEnvelope } from './encryptedEnvelope';
import { decryptAndValidateWorkspace, validateAndEncryptWorkspace } from './workspaceEncryption';
import { operationError, operationErrorCode } from './workspaceOperationError';

const JOB_TIMEOUT_MS = 120_000;
let pending: Promise<unknown> = Promise.resolve();
type Request =
  | { type: 'encrypt-workspace'; workspace: Workspace; password: string }
  | { type: 'decrypt-workspace'; input: unknown; password: string };

function workerJob(request: Request, signal?: AbortSignal): Promise<EncryptedEnvelope | Workspace> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    let worker: Worker;
    try {
      worker = new Worker(new URL('./workspaceEncryption.worker.ts', import.meta.url), {
        type: 'module',
        name: 'chaingraph-workspace-encryption',
      });
    } catch {
      reject(operationError('worker-start'));
      return;
    }
    const id = crypto.randomUUID();
    let settled = false;
    const finish = (error?: unknown, value?: EncryptedEnvelope | Workspace) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(signal!.reason);
    const timer = setTimeout(() => finish(operationError('worker-timeout')), JOB_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(operationError('worker-stopped'));
    };
    worker.onmessageerror = () => finish(operationError('worker-unreadable'));
    worker.onmessage = (event: MessageEvent) => {
      const result = event.data;
      if (!result || result.id !== id) {
        finish(operationError('worker-unexpected'));
        return;
      }
      if (result.type === 'workspace-operation-failed') {
        finish(operationError(result.code));
        return;
      }
      if (request.type === 'encrypt-workspace') {
        const envelope = result.envelope as EncryptedEnvelope | undefined;
        if (
          result.type !== 'workspace-encrypted' ||
          !envelope ||
          envelope.format !== 'chaingraph-workspace' ||
          envelope.version !== 2 ||
          !['none', 'gzip'].includes(envelope.compression) ||
          typeof envelope.ciphertext !== 'string' ||
          envelope.ciphertext.length > MAX_ENCRYPTED_FILE_BYTES
        ) {
          finish(
            new Error(
              'Workspace validation or encryption failed. Your unlocked data remains available.',
            ),
          );
          return;
        }
        finish(undefined, envelope);
      } else {
        const workspace = result.workspace as Workspace | undefined;
        // The trusted worker performed full schema/derivation checks; do not repeat them on the UI thread.
        if (
          result.type !== 'workspace-decrypted' ||
          !workspace ||
          workspace.version !== CURRENT_WORKSPACE_VERSION ||
          typeof workspace.id !== 'string'
        ) {
          finish(operationError('worker-unexpected'));
          return;
        }
        finish(undefined, workspace);
      }
    };
    try {
      worker.postMessage({ ...request, id });
    } catch {
      finish(operationError('worker-dispatch'));
    }
  });
}

/** Cancel queued callers promptly as well as terminating active jobs. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One validation/crypto worker at a time, sharing save gesture deferral and read cancellation. */
function enqueue(request: Request, beforeStart?: () => Promise<void>, signal?: AbortSignal) {
  const operation = pending
    .catch(() => {})
    .then(async () => {
      signal?.throwIfAborted();
      await beforeStart?.();
      signal?.throwIfAborted();
      if (typeof window === 'undefined') {
        try {
          const result =
            request.type === 'encrypt-workspace'
              ? await validateAndEncryptWorkspace(request.workspace, request.password)
              : await decryptAndValidateWorkspace(request.input, request.password);
          signal?.throwIfAborted();
          return result;
        } catch (error) {
          signal?.throwIfAborted();
          throw operationError(operationErrorCode(error));
        }
      }
      if (typeof Worker === 'undefined') throw operationError('worker-unavailable');
      return workerJob(request, signal);
    });
  // Keep only a completion barrier: a resolved read promise would retain plaintext after lock.
  pending = operation.then(
    () => undefined,
    () => undefined,
  );
  return abortable(operation, signal);
}

export function encryptWorkspaceOffThread(
  workspace: Workspace,
  password: string,
  beforeStart?: () => Promise<void>,
): Promise<EncryptedEnvelope> {
  return enqueue(
    { type: 'encrypt-workspace', workspace, password },
    beforeStart,
  ) as Promise<EncryptedEnvelope>;
}

export function decryptWorkspaceOffThread(
  input: unknown,
  password: string,
  signal?: AbortSignal,
): Promise<Workspace> {
  return enqueue(
    { type: 'decrypt-workspace', input, password },
    undefined,
    signal,
  ) as Promise<Workspace>;
}
