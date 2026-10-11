import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import {
  inspectLabels,
  planLabelImport,
  applyLabelImport,
  defaultLabelImportOptions,
} from '../../../Core/Workspace/Annotations/labels';
import {
  createImportPreview,
  inspectLabelFile,
  type LabelJob,
  type LabelJobResult,
} from './labelExchange';

class PreviewWorker {
  static latest: PreviewWorker;
  constructor() {
    PreviewWorker.latest = this;
  }
  job?: LabelJob;
  onmessage?: (event: { data: LabelJobResult }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage(job: LabelJob) {
    this.job = job;
  }
  reply(data: LabelJobResult) {
    this.onmessage?.({ data: structuredClone(data) });
  }
}
afterEach(() => vi.unstubAllGlobals());

it('rebinds the worker result to the reviewed main-thread snapshot', async () => {
  vi.stubGlobal('Worker', PreviewWorker);
  const workspace = createWorkspace('Worker fixture', 'mainnet');
  const inspection = inspectLabels(
    JSON.stringify({ type: 'tx', ref: 'a'.repeat(64), label: 'A' }),
    workspace.network,
  );
  const options = defaultLabelImportOptions(workspace.network);
  const pending = createImportPreview(workspace, inspection, options, new AbortController().signal);
  const worker = PreviewWorker.latest;
  expect(worker.job?.kind).toBe('import');
  const {
    source: _source,
    next,
    ...plan
  } = planLabelImport(structuredClone(workspace), inspection, options);
  worker.reply({
    kind: 'import',
    plan,
    annotations: next.annotations,
  });
  const result = await pending;
  expect(result.source).toBe(workspace);
  expect(
    applyLabelImport(workspace, result).annotations.entities[`tx:${'a'.repeat(64)}`].label,
  ).toBe('A');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('terminates cancelled inspection and reports worker/decoding failure safely', async () => {
  vi.stubGlobal('Worker', PreviewWorker);
  const controller = new AbortController(),
    file = new File([''], 'synthetic.jsonl');
  const pending = inspectLabelFile(file, 'mainnet', controller.signal);
  controller.abort(new Error('Cancelled'));
  await expect(pending).rejects.toThrow('Cancelled');
  expect(PreviewWorker.latest.terminate).toHaveBeenCalledTimes(1);
  const decoding = inspectLabelFile(file, 'mainnet', new AbortController().signal);
  PreviewWorker.latest.reply({ kind: 'error', error: 'File could not be decoded as UTF-8.' });
  await expect(decoding).rejects.toThrow('UTF-8');
  const crash = inspectLabelFile(file, 'mainnet', new AbortController().signal);
  PreviewWorker.latest.onerror!();
  await expect(crash).rejects.toThrow("Couldn't prepare");
});
