import { useRef } from 'react';
import type { Annotation, Workspace } from '../../../Domain/types';
import { emptyAnnotation } from '../../../Domain/Metadata/annotations';
import { exportLabels, importLabels } from '../../../Domain/Metadata/labels';
import { parseWorkspaceTags } from '../../../Domain/Metadata/tags';
import { download } from '../../../Infra/Storage/download';
import type { AppState } from '../../useAppState';
import { useMetadataEditRequest, type MetadataEditRequest } from './useMetadataEditRequest';

/**
 * Human annotations on workspace entities: labels, descriptions, tags, icons and
 * bookmarks, plus the BIP329 label exchange.
 *
 * These are the analyst's own statements, kept distinct from observed chain data
 * and from heuristic findings.
 */
export interface WorkspaceAnnotations {
  /** Bookmarked entities, as node id and annotation pairs. */
  bookmarks: [string, Annotation][];
  /** Applies an edit that may touch tags, reparsing them so stored tags stay valid. */
  changeTags: (update: (workspace: Workspace) => Workspace) => void;
  /** A pending request to open one metadata editor on the selected entity. */
  edit: MetadataEditRequest;
  /**
   * Applies a batch annotation edit as a single undo step. Returns that step's
   * token when something changed, so a caller can offer to undo exactly it.
   */
  applyBatch: (summary: string, update: (data: Workspace) => Workspace) => number | undefined;
  /** The hidden file input the import dialog renders. */
  labelsInput: React.RefObject<HTMLInputElement | null>;
  chooseLabelFile: () => void;
  importLabelFile: (file: File) => Promise<void>;
  exportLabels: () => void;
}

interface Inputs {
  current: AppState['w'];
  sessions: AppState['ws'];
  edit: (fn: (data: Workspace) => Workspace, undo?: boolean) => void;
  setError: AppState['setError'];
  setNotice: AppState['setNotice'];
}

const MAX_LABEL_FILE_BYTES = 5_000_000;

export function useAnnotations({
  current,
  sessions,
  edit,
  setError,
  setNotice,
}: Inputs): WorkspaceAnnotations {
  const labelsInput = useRef<HTMLInputElement>(null);
  const editRequest = useMetadataEditRequest(current?.id);
  return {
    bookmarks: Object.entries(current?.annotations ?? {}).filter(([, a]) => a.bookmarked),
    edit: editRequest,
    labelsInput,
    changeTags: (update) => {
      try {
        edit((workspace) => {
          const next = update(workspace);
          return { ...next, tags: parseWorkspaceTags(next.tags ?? [], next.network) };
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update tags.');
      }
    },
    applyBatch: (summary, update) => {
      if (!current) return undefined;
      const before = sessions.getSession(current.id)?.undoRevision;
      try {
        // A single workspace update keeps one Undo step for the whole batch.
        edit(update);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : 'The batch edit could not be applied.',
        );
        return undefined;
      }
      const after = sessions.getSession(current.id)?.undoRevision;
      setError('');
      if (after === undefined || after === before) {
        // Nothing changed, so no undo step exists and none is offered.
        setNotice('That batch left every selected entity unchanged.');
        return undefined;
      }
      setNotice(`${summary}. Undo restores the previous values.`);
      return after;
    },
    chooseLabelFile: () => labelsInput.current?.click(),
    importLabelFile: async (file) => {
      if (!current) return;
      try {
        if (file.size > MAX_LABEL_FILE_BYTES) throw new Error('Label file exceeds 5 MB.');
        const result = importLabels(await file.text());
        edit((workspace) => {
          const annotations = { ...workspace.annotations };
          for (const [id, annotation] of Object.entries(result.annotations))
            annotations[id] = {
              ...(annotations[id] ?? emptyAnnotation),
              label: annotation.label,
            };
          return {
            ...workspace,
            annotations,
            wallets: workspace.wallets.map((wallet) => ({
              ...wallet,
              name: result.annotations[`xpub:${wallet.key}`]?.label.trim() || wallet.name,
            })),
          };
        });
        setNotice(
          `Imported ${Object.keys(result.annotations).length} labels. ${result.skipped} records skipped (unsupported type or no label).`,
        );
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Label import failed.');
      }
    },
    exportLabels: () => {
      if (!current) return;
      download('labels.jsonl', exportLabels(current), 'application/x-ndjson');
      setNotice(
        'BIP329 labels exported as unencrypted JSONL. Notes and graph layout use the encrypted workspace format.',
      );
    },
  };
}
