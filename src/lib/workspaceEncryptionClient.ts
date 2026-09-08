import type { Workspace } from '../domain/types';
import { MAX_ENCRYPTED_FILE_BYTES, type EncryptedEnvelope } from './crypto';
import { validateAndEncryptWorkspace } from './workspaceEncryption';

const JOB_TIMEOUT_MS = 120_000;
let pending: Promise<unknown> = Promise.resolve();

function workerJob(workspace: Workspace, password: string): Promise<EncryptedEnvelope> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./workspaceEncryption.worker.ts', import.meta.url), {
        type: 'module',
        name: 'chaingraph-workspace-encryption',
      });
    } catch {
      reject(
        new Error(
          'The encrypted-save worker could not start. Your unlocked data remains available. Check browser permissions and retry.',
        ),
      );
      return;
    }
    const id = crypto.randomUUID();
    let settled = false;
    const finish = (error?: Error, envelope?: EncryptedEnvelope) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(envelope!);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error('Workspace encryption took too long. Your unlocked data remains available.'),
        ),
      JOB_TIMEOUT_MS,
    );
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new Error('The encrypted-save worker stopped. Your unlocked data remains available.'));
    };
    worker.onmessageerror = () =>
      finish(new Error('The encrypted-save worker returned an unreadable result.'));
    worker.onmessage = (event: MessageEvent) => {
      const result = event.data;
      if (!result || result.id !== id) {
        finish(new Error('The encrypted-save worker returned an unexpected result.'));
        return;
      }
      const envelope = result.envelope as EncryptedEnvelope | undefined;
      if (
        result.type !== 'workspace-encrypted' ||
        !envelope ||
        envelope.format !== 'chaingraph-workspace' ||
        envelope.version !== 1 ||
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
    };
    try {
      worker.postMessage({ type: 'encrypt-workspace', id, workspace, password });
    } catch {
      finish(new Error('The workspace could not be sent to the encrypted-save worker.'));
    }
  });
}

/** Limit memory and validation CPU to one encryption worker at a time. */
export function encryptWorkspaceOffThread(
  workspace: Workspace,
  password: string,
  beforeStart?: () => Promise<void>,
): Promise<EncryptedEnvelope> {
  if (typeof window === 'undefined') return validateAndEncryptWorkspace(workspace, password);
  if (typeof Worker === 'undefined')
    return Promise.reject(
      new Error('This browser requires Web Worker support for encrypted workspace saves.'),
    );
  const operation = pending
    .catch(() => {})
    .then(async () => {
      await beforeStart?.();
      return workerJob(workspace, password);
    });
  pending = operation;
  return operation;
}
