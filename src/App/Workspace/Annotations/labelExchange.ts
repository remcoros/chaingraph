import type { Network } from '../../../Core/Bitcoin';
import type { Workspace } from '../../../Core/Workspace/workspace';
import type {
  LabelInspection,
  LabelImportOptions,
  LabelExportOptions,
  LabelImportPlan,
  LabelExportPlan,
} from '../../../Core/Workspace/Annotations/labels';

export type LabelJob =
  | { kind: 'inspect'; file: File; network: Network }
  | {
      kind: 'import';
      workspace: Workspace;
      inspection: LabelInspection;
      options: LabelImportOptions;
    }
  | { kind: 'export'; workspace: Workspace; options: LabelExportOptions };
export type LabelJobResult =
  | { kind: 'inspect'; inspection: LabelInspection }
  | {
      kind: 'import';
      plan: Omit<LabelImportPlan, 'source' | 'next'>;
      annotations: Workspace['annotations'];
      definitions: Workspace['wallets']['definitions'];
    }
  | { kind: 'export'; plan: LabelExportPlan }
  | { kind: 'error'; error: string };

/** Each bounded review job has dialog lifetime, with no retained worker state. */
function runLabelJob(job: LabelJob, signal: AbortSignal): Promise<LabelJobResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./labelExchange.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const fail = () => {
      finish();
      reject(new Error('Could not prepare the metadata preview. Try again.'));
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    const timeout = setTimeout(fail, 30_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = (event: MessageEvent<LabelJobResult>) => {
      finish();
      if (event.data.kind === 'error') reject(new Error(event.data.error));
      else resolve(event.data);
    };
    try {
      worker.postMessage(job);
    } catch {
      fail();
    }
  });
}
export async function inspectLabelFile(
  file: File,
  network: Network,
  signal: AbortSignal,
): Promise<LabelInspection> {
  const result = await runLabelJob({ kind: 'inspect', file, network }, signal);
  if (result.kind !== 'inspect') throw new Error('Unexpected metadata inspection result.');
  return result.inspection;
}
export async function createImportPreview(
  workspace: Workspace,
  inspection: LabelInspection,
  options: LabelImportOptions,
  signal: AbortSignal,
): Promise<LabelImportPlan> {
  const result = await runLabelJob({ kind: 'import', workspace, inspection, options }, signal);
  if (result.kind !== 'import') throw new Error('Unexpected metadata import result.');
  // Retain the main-thread snapshot identity for exact reviewed application.
  return {
    ...result.plan,
    source: workspace,
    next: {
      ...workspace,
      annotations: result.annotations,
      wallets: { ...workspace.wallets, definitions: result.definitions },
    },
  };
}
export async function createExportPreview(
  workspace: Workspace,
  options: LabelExportOptions,
  signal: AbortSignal,
): Promise<LabelExportPlan> {
  const result = await runLabelJob({ kind: 'export', workspace, options }, signal);
  if (result.kind !== 'export') throw new Error('Unexpected metadata export result.');
  return result.plan;
}
