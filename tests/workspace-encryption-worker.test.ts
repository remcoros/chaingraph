import { afterEach, describe, expect, it, vi } from 'vitest';
import { newWorkspace } from '../src/domain/workspace';
import { encryptWorkspaceOffThread } from '../src/lib/workspaceEncryptionClient';
import type { EncryptedEnvelope } from '../src/lib/crypto';

const envelope: EncryptedEnvelope = {
  format: 'chaingraph-workspace',
  version: 1,
  cipher: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations: 600000,
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA',
};
const workspace = newWorkspace('Worker fixture', 'mainnet');
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  request?: { type: string; id: string };
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: { type: string; id: string }) {
    this.request = request;
  }
  success() {
    this.onmessage?.({
      data: { type: 'workspace-encrypted', id: this.request!.id, envelope },
    } as MessageEvent);
  }
}
function setup() {
  FakeWorker.instances = [];
  vi.stubGlobal('window', {});
  vi.stubGlobal('Worker', FakeWorker);
}
async function latest() {
  await vi.waitFor(() => expect(FakeWorker.instances.length).toBeGreaterThan(0));
  return FakeWorker.instances.at(-1)!;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('browser encrypted-save worker lifecycle', () => {
  it('returns only an envelope and terminates the job worker', async () => {
    setup();
    const result = encryptWorkspaceOffThread(workspace, 'public fixture password');
    const worker = await latest();
    expect(worker.request?.type).toBe('encrypt-workspace');
    worker.success();
    expect(await result).toEqual(envelope);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('sanitizes worker failures, terminates and allows a fresh retry', async () => {
    setup();
    const result = encryptWorkspaceOffThread(workspace, 'public fixture password');
    const rejected = expect(result).rejects.toThrow('worker stopped');
    const worker = await latest();
    worker.onerror?.({ preventDefault() {}, message: 'secret upstream detail' } as ErrorEvent);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const retry = encryptWorkspaceOffThread(workspace, 'public fixture password');
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    FakeWorker.instances[1].success();
    await expect(retry).resolves.toEqual(envelope);
  });
  it('checks activity again when a queued job reaches the front', async () => {
    setup();
    let resume!: () => void;
    const idle = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const first = encryptWorkspaceOffThread(workspace, 'public fixture password');
    const second = encryptWorkspaceOffThread(workspace, 'public fixture password', () => idle);
    (await latest()).success();
    await first;
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(1);
    resume();
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    FakeWorker.instances[1].success();
    await second;
  });
  it('fails closed when the browser cannot start a worker', async () => {
    setup();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('private failure detail');
        }
      },
    );
    await expect(encryptWorkspaceOffThread(workspace, 'public fixture password')).rejects.toThrow(
      'could not start',
    );
  });
  it('rejects a mismatched response and terminates it', async () => {
    setup();
    const pending = encryptWorkspaceOffThread(workspace, 'public fixture password');
    const rejected = expect(pending).rejects.toThrow('unexpected result');
    const worker = await latest();
    worker.onmessage?.({
      data: { type: 'workspace-encrypted', id: 'wrong', envelope },
    } as MessageEvent);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
