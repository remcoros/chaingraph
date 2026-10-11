import { useEffect, useRef, useState } from 'react';
import {
  type Annotation,
  parseWorkspaceTags,
} from '../../../Core/Workspace/Annotations/annotations';
import type { Workspace } from '../../../Core/Workspace/workspace';

import {
  applyLabelImport,
  defaultLabelImportOptions,
  defaultLabelExportOptions,
  planLabelImport,
  planLabelExport,
  MAX_LABEL_FILE_BYTES,
  type LabelInspection,
  type LabelImportOptions,
  type LabelExportOptions,
  type LabelScope,
} from '../../../Core/Workspace/Annotations/labels';
import { inspectLabelFile, createImportPreview, createExportPreview } from './labelExchange';

import { download } from '../../../Core/Browser/download';
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
  /** Reviewed plaintext metadata exchange; opening/inspection never edits state. */
  labelTransfer: LabelTransfer | undefined;
  importPlan: ReturnType<typeof planLabelImport> | undefined;
  exportPlan: ReturnType<typeof planLabelExport> | undefined;
  previewBusy: boolean;
  previewError: string | undefined;
  labelsInput: React.RefObject<HTMLInputElement | null>;
  openLabelImport: (scope?: LabelScope) => void;
  openLabelExport: (scope?: LabelScope) => void;
  closeLabelTransfer: () => void;
  pickLabelFile: () => void;
  importLabelFile: (file: File) => Promise<void>;
  configureLabelImport: (options: Partial<LabelImportOptions>) => void;
  configureLabelExport: (options: Partial<LabelExportOptions>) => void;
  confirmLabelImport: () => void;
  downloadLabelExport: () => void;
}

export type LabelTransfer =
  | {
      kind: 'import';
      workspaceId: string;
      options: LabelImportOptions;
      filename?: string;
      inspection?: LabelInspection;
      busy?: boolean;
      failure?: string;
    }
  | { kind: 'export'; workspaceId: string; options: LabelExportOptions };

interface Inputs {
  current: AppState['activeWorkspace'];
  sessions: AppState['workspaces'];
  edit: (fn: (data: Workspace) => Workspace, undo?: boolean) => void;
  setError: AppState['setError'];
  setNotice: AppState['setNotice'];
  context?: { walletView: boolean; walletId?: string; selectedIds: readonly string[] };
}

export function useAnnotations({
  current,
  sessions,
  edit,
  setError,
  setNotice,
  context,
}: Inputs): WorkspaceAnnotations {
  const labelsInput = useRef<HTMLInputElement>(null);
  const editRequest = useMetadataEditRequest(current?.id);
  const [transfer, setTransfer] = useState<LabelTransfer>();
  const fileRequest = useRef(0);
  const fileRead = useRef<AbortController | undefined>(undefined);
  const labelTransfer = transfer?.workspaceId === current?.id ? transfer : undefined;
  const [preview, setPreview] = useState<{
    workspace: Workspace;
    transfer: LabelTransfer;
    importPlan?: ReturnType<typeof planLabelImport>;
    exportPlan?: ReturnType<typeof planLabelExport>;
    error?: string;
  }>();
  const previewCurrent = preview?.workspace === current && preview?.transfer === labelTransfer;
  const importPlan = previewCurrent ? preview?.importPlan : undefined;
  const exportPlan = previewCurrent ? preview?.exportPlan : undefined;
  const needsPreview =
    !!current && !!labelTransfer && (labelTransfer.kind === 'export' || !!labelTransfer.inspection);
  useEffect(() => {
    if (
      !current ||
      !labelTransfer ||
      (labelTransfer.kind === 'import' && !labelTransfer.inspection)
    )
      return;
    const controller = new AbortController();
    const prepare = async () => {
      try {
        const result =
          labelTransfer.kind === 'export'
            ? {
                exportPlan: await createExportPreview(
                  current,
                  labelTransfer.options,
                  controller.signal,
                ),
              }
            : {
                importPlan: await createImportPreview(
                  current,
                  labelTransfer.inspection!,
                  labelTransfer.options,
                  controller.signal,
                ),
              };
        if (!controller.signal.aborted)
          setPreview({ workspace: current, transfer: labelTransfer, ...result });
      } catch (error) {
        if (!controller.signal.aborted)
          setPreview({
            workspace: current,
            transfer: labelTransfer,
            error: error instanceof Error ? error.message : 'Could not prepare the preview.',
          });
      }
    };
    void prepare();
    return () => {
      controller.abort();
      // A closed or switched dialog must release its decrypted source/plan.
      setPreview(undefined);
    };
  }, [current, labelTransfer]);
  useEffect(() => () => fileRead.current?.abort(), []);
  const defaultScope = (): LabelScope =>
    context?.walletView && context.walletId
      ? { kind: 'wallet', walletId: context.walletId }
      : { kind: 'workspace' };
  const closeLabelTransfer = () => {
    fileRequest.current++;
    fileRead.current?.abort();
    setTransfer(undefined);
    setPreview(undefined);
  };
  return {
    bookmarks: Object.entries(current?.annotations.entities ?? {}).filter(([, a]) => a.bookmarked),
    edit: editRequest,
    labelsInput,
    changeTags: (update) => {
      try {
        edit((workspace) => {
          const next = update(workspace);
          return {
            ...next,
            annotations: {
              ...next.annotations,
              tags: parseWorkspaceTags(next.annotations.tags ?? [], next.network),
            },
          };
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update tags.');
      }
    },
    applyBatch: (summary, update) => {
      if (!current) return undefined;
      const before = sessions.getUnlocked(current.id)?.undoRevision;
      try {
        // A single workspace update keeps one Undo step for the whole batch.
        edit(update);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : 'The batch edit could not be applied.',
        );
        return undefined;
      }
      const after = sessions.getUnlocked(current.id)?.undoRevision;
      setError('');
      if (after === undefined || after === before) {
        // Nothing changed, so no undo step exists and none is offered.
        setNotice('That batch left every selected entity unchanged.');
        return undefined;
      }
      setNotice(`${summary}. Undo restores the previous values.`);
      return after;
    },
    labelTransfer,
    importPlan,
    exportPlan,
    previewBusy: needsPreview && !previewCurrent,
    previewError: previewCurrent ? preview?.error : undefined,
    closeLabelTransfer,
    openLabelImport: (scope) => {
      if (!current) return;
      fileRequest.current++;
      setTransfer({
        kind: 'import',
        workspaceId: current.id,
        options: defaultLabelImportOptions(current.network, scope ?? defaultScope()),
      });
    },
    openLabelExport: (scope) => {
      if (!current) return;
      fileRequest.current++;
      setTransfer({
        kind: 'export',
        workspaceId: current.id,
        options: defaultLabelExportOptions(scope ?? defaultScope()),
      });
    },
    pickLabelFile: () => labelsInput.current?.click(),
    importLabelFile: async (file) => {
      if (!current || labelTransfer?.kind !== 'import') return;
      const request = ++fileRequest.current;
      fileRead.current?.abort();
      if (file.size > MAX_LABEL_FILE_BYTES) {
        setTransfer({
          ...labelTransfer,
          filename: file.name,
          inspection: undefined,
          busy: false,
          failure: 'Label file exceeds 5 MB.',
        });
        return;
      }
      const controller = new AbortController();
      fileRead.current = controller;
      setTransfer({
        ...labelTransfer,
        filename: file.name,
        inspection: undefined,
        busy: true,
        failure: undefined,
      });
      try {
        const inspection = await inspectLabelFile(file, current.network, controller.signal);
        if (request !== fileRequest.current) return;
        setTransfer((state) =>
          state?.kind === 'import' && state.workspaceId === current.id
            ? { ...state, inspection, busy: false }
            : state,
        );
      } catch (error) {
        if (request !== fileRequest.current) return;
        setTransfer((state) =>
          state?.kind === 'import' && state.workspaceId === current.id
            ? {
                ...state,
                busy: false,
                failure:
                  error instanceof TypeError
                    ? 'File is not valid UTF-8. Choose a UTF-8 JSONL file.'
                    : error instanceof Error
                      ? error.message
                      : 'Label file could not be read.',
              }
            : state,
        );
      }
    },
    configureLabelImport: (patch) =>
      setTransfer((state) =>
        state?.kind === 'import' ? { ...state, options: { ...state.options, ...patch } } : state,
      ),
    configureLabelExport: (patch) =>
      setTransfer((state) => {
        if (state?.kind !== 'export') return state;
        const options = { ...state.options, ...patch };
        if (patch.profile === 'keeper' && options.scope.kind !== 'wallet')
          options.scope = {
            kind: 'wallet',
            walletId: context?.walletId ?? current?.wallets.definitions[0]?.id ?? '',
          };
        return { ...state, options };
      }),
    confirmLabelImport: () => {
      if (!importPlan || !importPlan.changes.length) return;
      try {
        edit((workspace) => applyLabelImport(workspace, importPlan));
        closeLabelTransfer();
        setError('');
        setNotice(
          `Imported ${importPlan.changes.length} metadata changes. Undo restores the previous values.`,
        );
      } catch (error) {
        const failure = error instanceof Error ? error.message : 'Label import failed.';
        setTransfer((state) => (state?.kind === 'import' ? { ...state, failure } : state));
      }
    },
    downloadLabelExport: () => {
      if (
        !exportPlan ||
        exportPlan.blocked ||
        !exportPlan.recordCount ||
        labelTransfer?.kind !== 'export'
      )
        return;
      download(
        `labels-${labelTransfer.options.profile}.jsonl`,
        exportPlan.content,
        'application/x-ndjson',
      );
      closeLabelTransfer();
      setNotice(`Exported ${exportPlan.recordCount} BIP329 records as plaintext JSONL.`);
    },
  };
}
