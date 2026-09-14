import { useEffect, useId, useMemo, useState } from 'react';
import { CheckSquare, Eye, EyeOff, Focus, Plus, Tag, Type, Undo2, X } from 'lucide-react';
import type { Workspace } from '../../../Domain/types';
import { labelBatchPlan } from '../../../Domain/Metadata/batchEdits';
import { applyBatchIcon, planBatchIcon } from '../../../Domain/Metadata/batchMetadata';
import {
  BatchLabelEditor,
  BatchTagEditor,
  MetadataPopover,
} from '../../../Shared/Metadata/MetadataEditors';
import { IconPicker } from '../../../Shared/Metadata/IconPicker';
import type { EntitySelection } from './useEntitySelection';
import './selection-toolbar.css';

export interface SelectionToolbarProps {
  active?: boolean;
  workspace: Workspace;
  selection: EntitySelection;
  /** Selected entities currently drawn on the canvas, for an honest scope note. */
  visibleSelectedCount: number;
  hiddenSelectedCount: number;
  /** Explicit match scope offered for one-step selection, without context nodes. */
  matching?: { label: string; ids: string[] };
  matchingPending?: boolean;
  /** Applies one batch and returns the undo head it created, or undefined when
   * nothing changed or the edit failed. */
  onApply: (summary: string, update: (workspace: Workspace) => Workspace) => number | undefined;
  /** Current undo head of the workspace session. */
  undoToken: number;
  undoDescription?: string;
  onSetHidden: (ids: string[], hidden: boolean) => void;
  onIsolate: (ids: string[]) => void;
  onUndo: () => void;
}

export function SelectionToolbar({
  active = true,
  workspace,
  selection,
  visibleSelectedCount,
  hiddenSelectedCount,
  matching,
  matchingPending = false,
  onApply,
  undoToken,
  undoDescription,
  onSetHidden,
  onIsolate,
  onUndo,
}: SelectionToolbarProps) {
  const [editor, setEditor] = useState<'label' | 'tag'>();
  const [replaceIcons, setReplaceIcons] = useState(false);
  const [undoable, setUndoable] = useState<{
    summary: string;
    token: number;
    workspaceId: string;
  }>();
  const [labelButton, setLabelButton] = useState<HTMLButtonElement | null>(null);
  const [tagButton, setTagButton] = useState<HTMLButtonElement | null>(null);
  const labelId = useId();
  const tagId = useId();
  const ids = selection.ids;
  const count = ids.length;
  const firstIcon = workspace.annotations[ids[0]]?.icon ?? '';
  const mixedIcons = ids.some((id) => (workspace.annotations[id]?.icon ?? '') !== firstIcon);
  // The batch action stays available only while its own edit is the undo head.
  // Any later undoable edit, an undo, a lock or a workspace change retires it, so
  // it can never discard an unrelated newer edit.
  const owned =
    undoable?.token === undoToken && undoable?.workspaceId === workspace.id ? undoable : undefined;
  const hiddenIds = useMemo(
    () => new Set(workspace.view.hiddenNodeIds ?? []),
    [workspace.view.hiddenNodeIds],
  );
  const manuallyHidden = ids.filter((id) => hiddenIds.has(id)).length;
  const apply = (summary: string, update: (workspace: Workspace) => Workspace) => {
    const token = onApply(summary, (current) => {
      // Preserve the graph selection boundary's strict network/reference checks.
      labelBatchPlan(current, ids);
      return update(current);
    });
    // A batch that changed nothing, or failed, never advertises an undo step.
    setUndoable(token === undefined ? undefined : { summary, token, workspaceId: workspace.id });
    return token !== undefined || update(workspace) === workspace;
  };
  useEffect(() => {
    if (!active) setEditor(undefined);
  }, [active]);
  const scopeKey = `${workspace.id}:${ids.join('|')}`;
  useEffect(() => setEditor(undefined), [scopeKey]);
  if (!active || (!selection.mode && !count)) return null;
  return (
    <div className="selection-toolbar" role="group" aria-label="Selected entity actions">
      <span className="selection-toolbar-count" role="status">
        <CheckSquare size={13} aria-hidden="true" />
        <strong>{count.toLocaleString('en-US')} selected</strong>
        {count > 0 && hiddenSelectedCount > 0 && (
          <small title="Filters or manual hiding keep these selected entities off the canvas. Batch actions still apply to the full selection shown here.">
            {hiddenSelectedCount.toLocaleString('en-US')} not on canvas
          </small>
        )}
        {count > 0 && hiddenSelectedCount === 0 && visibleSelectedCount === count && (
          <small>all on canvas</small>
        )}
      </span>
      {matching && matching.ids.length > 0 && (
        <button
          type="button"
          className="selection-toolbar-select-matching"
          title="Replace the selection with the entities matching the current filters. Connected context entities are excluded."
          disabled={matchingPending}
          onClick={() => {
            if (!matchingPending) selection.replace(matching.ids);
          }}
        >
          <Plus size={13} /> Select {matching.label}
        </button>
      )}
      {count > 0 && (
        <>
          <button
            ref={setLabelButton}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={editor === 'label'}
            aria-controls={editor === 'label' ? labelId : undefined}
            onClick={() => setEditor(editor === 'label' ? undefined : 'label')}
          >
            <Type size={13} /> Label
          </button>
          <button
            ref={setTagButton}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={editor === 'tag'}
            aria-controls={editor === 'tag' ? tagId : undefined}
            onClick={() => setEditor(editor === 'tag' ? undefined : 'tag')}
          >
            <Tag size={13} /> Tags
          </button>
          <span
            className="selection-toolbar-icon"
            onPointerDownCapture={() => setEditor(undefined)}
            onKeyDownCapture={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setEditor(undefined);
            }}
          >
            <IconPicker
              key={scopeKey}
              value={firstIcon}
              mixed={mixedIcons}
              compact
              caption="Icon"
              ariaLabel={`Set an icon on ${count} selected entities`}
              onChange={(icon) =>
                apply(
                  icon
                    ? `Icon set on ${planBatchIcon(workspace, ids, replaceIcons).targets.length} records`
                    : `Icon cleared on ${planBatchIcon(workspace, ids, replaceIcons).targets.length} records`,
                  (current) => applyBatchIcon(current, ids, icon, replaceIcons),
                )
              }
            />
          </span>
          <label className="selection-toolbar-replace">
            <input
              type="checkbox"
              checked={replaceIcons}
              onChange={(event) => setReplaceIcons(event.target.checked)}
            />
            Replace icons
          </label>
          <button
            type="button"
            title="Hide the selected entities from the canvas. Their data and annotations remain."
            onClick={() => onSetHidden(ids, true)}
          >
            <EyeOff size={13} /> Hide
          </button>
          {manuallyHidden > 0 && (
            <button
              type="button"
              aria-label={`Show ${manuallyHidden} manually hidden selected entities`}
              onClick={() => onSetHidden(ids, false)}
            >
              <Eye size={13} /> Show {manuallyHidden}
            </button>
          )}
          <button
            type="button"
            title="Show only the selected entities on the canvas. The isolation chip clears it again."
            onClick={() => onIsolate(ids)}
          >
            <Focus size={13} /> Isolate
          </button>
          <button type="button" onClick={() => selection.clear()}>
            <X size={13} /> Clear
          </button>
        </>
      )}
      {owned && (
        <button
          type="button"
          className="selection-toolbar-undo"
          aria-label={`Undo: ${undoDescription ?? owned.summary}`}
          title={`Undo: ${undoDescription ?? owned.summary}`}
          onClick={() => {
            onUndo();
            setUndoable(undefined);
          }}
        >
          <Undo2 size={13} /> Undo
        </button>
      )}
      {editor === 'label' && labelButton && (
        <MetadataPopover anchor={labelButton} onClose={() => setEditor(undefined)}>
          <BatchLabelEditor
            id={labelId}
            workspace={workspace}
            ids={ids}
            onClose={() => setEditor(undefined)}
            onApply={apply}
          />
        </MetadataPopover>
      )}
      {editor === 'tag' && tagButton && (
        <MetadataPopover anchor={tagButton} compact onClose={() => setEditor(undefined)}>
          <BatchTagEditor
            id={tagId}
            workspace={workspace}
            ids={ids}
            onClose={() => setEditor(undefined)}
            onApply={apply}
          />
        </MetadataPopover>
      )}
    </div>
  );
}

/** Compact checkbox used by list and flow rows while selection mode is active. */
export function SelectionCheckbox({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label className="selection-checkbox" title={`Select ${label} for batch actions`}>
      <input
        type="checkbox"
        aria-label={`Select ${label} for batch actions`}
        checked={checked}
        onChange={() => onToggle(id)}
      />
    </label>
  );
}
