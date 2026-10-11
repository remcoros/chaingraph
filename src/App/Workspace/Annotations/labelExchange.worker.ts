import {
  inspectLabels,
  MAX_LABEL_FILE_BYTES,
  planLabelImport,
  planLabelExport,
} from '../../../Core/Workspace/Annotations/labels';
import type { LabelJob, LabelJobResult } from './labelExchange';

self.onmessage = async (event: MessageEvent<LabelJob>) => {
  const job = event.data;
  let result: LabelJobResult;
  try {
    if (job.kind === 'inspect') {
      if (job.file.size > MAX_LABEL_FILE_BYTES) throw new Error('Label file exceeds 5 MB.');
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(await job.file.arrayBuffer());
      } catch {
        throw new Error('File could not be decoded as UTF-8. Choose a UTF-8 JSONL file.');
      }
      result = { kind: 'inspect', inspection: inspectLabels(content, job.network) };
    } else if (job.kind === 'import') {
      const {
        source: _source,
        next,
        ...plan
      } = planLabelImport(job.workspace, job.inspection, job.options);
      result = {
        kind: 'import',
        plan,
        annotations: next.annotations,
      };
    } else result = { kind: 'export', plan: planLabelExport(job.workspace, job.options) };
  } catch (error) {
    result = {
      kind: 'error',
      error: error instanceof Error ? error.message : 'Could not prepare metadata preview.',
    };
  }
  self.postMessage(result);
};
