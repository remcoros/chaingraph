import type { Workspace } from '../Workspace/workspace';

/** Load and validate snapshots away from the UI thread; cancellation terminates the job. */
export function loadTemplateWorkspace(
  id: string,
  name: string,
  description: string,
  signal: AbortSignal,
): Promise<Workspace> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./templateWorkspace.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const fail = () => {
      finish();
      reject(new Error('Could not load the example workspace. Please try again.'));
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    const timeout = setTimeout(fail, 30_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = (event: MessageEvent<{ workspace?: Workspace }>) => {
      if (!event.data.workspace) return fail();
      finish();
      resolve(event.data.workspace);
    };
    try {
      worker.postMessage({ id, name, description });
    } catch {
      fail();
    }
  });
}
