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
      reject(new Error("Couldn't prepare the preview. Retry with the same settings."));
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
  const entities = Object.fromEntries(
    Object.entries(result.annotations.entities).map(([id, value]) => {
      const original = workspace.annotations.entities[id];
      return [
        id,
        original &&
        original.label === value.label &&
        original.note === value.note &&
        original.icon === value.icon &&
        original.bookmarked === value.bookmarked
          ? original
          : value,
      ];
    }),
  );
  const entitiesUnchanged =
    Object.keys(entities).length === Object.keys(workspace.annotations.entities).length &&
    Object.entries(entities).every(([id, value]) => value === workspace.annotations.entities[id]);
  const originalTags = workspace.annotations.tags;
  const tags = result.annotations.tags?.map((tag) => {
    const original = originalTags?.find((value) => value.id === tag.id);
    return original &&
      original.name === tag.name &&
      original.color === tag.color &&
      original.description === tag.description &&
      original.nodeIds.length === tag.nodeIds.length &&
      original.nodeIds.every((id, index) => id === tag.nodeIds[index])
      ? original
      : tag;
  });
  const tagsUnchanged =
    (tags?.length ?? 0) === (originalTags?.length ?? 0) &&
    (tags ?? []).every((tag, index) => tag === originalTags?.[index]);
  const names = new Map(
    result.plan.changes
      .filter((change) => change.target === 'walletName')
      .map((change) => [change.id, change.after]),
  );
  const definitions = names.size
    ? workspace.wallets.definitions.map((wallet) => {
        const name = names.get(wallet.id);
        return name === undefined || name === wallet.name ? wallet : { ...wallet, name };
      })
    : workspace.wallets.definitions;
  // Retain the main-thread snapshot identity for exact reviewed application.
  return {
    ...result.plan,
    source: workspace,
    next: {
      ...workspace,
      annotations:
        entitiesUnchanged && tagsUnchanged
          ? workspace.annotations
          : {
              ...workspace.annotations,
              entities: entitiesUnchanged ? workspace.annotations.entities : entities,
              tags: tagsUnchanged ? originalTags : tags,
            },
      wallets:
        definitions === workspace.wallets.definitions
          ? workspace.wallets
          : { ...workspace.wallets, definitions },
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
