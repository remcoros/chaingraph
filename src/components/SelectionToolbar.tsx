import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, CheckSquare, Eye, EyeOff, Focus, Plus, Tag, Type, Undo2, X } from 'lucide-react';
import type { Workspace } from '../domain/types';
import {
  applyBatchIcon,
  applyBatchLabel,
  applyBatchTag,
  createBatchTag,
  labelBatchPlan,
  tagBatchPlan,
} from '../domain/batchEdits';
import { AnchoredPopover } from './AnchoredPopover';
import { IconPicker } from './IconPicker';
import type { EntitySelection } from '../lib/useEntitySelection';
import './selection-toolbar.css';

const tagColors = ['#65cbbb', '#e4af67', '#9c9aed', '#e888a5', '#85bce8', '#a4c977'];

export interface SelectionToolbarProps {
  active?: boolean;
  workspace: Workspace;
  selection: EntitySelection;
  /** Selected entities currently drawn on the canvas, for an honest scope note. */
  visibleSelectedCount: number;
  hiddenSelectedCount: number;
  /** Explicit match scope offered for one-step selection, without context nodes. */
  matching?: { label: string; ids: string[] };
  /** Applies one batch and returns the undo head it created, or undefined when
   * nothing changed or the edit failed. */
  onApply: (summary: string, update: (workspace: Workspace) => Workspace) => number | undefined;
  /** Current undo head of the workspace session. */
  undoToken: number;
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
  onApply,
  undoToken,
  onSetHidden,
  onIsolate,
  onUndo,
}: SelectionToolbarProps) {
  const [editor, setEditor] = useState<'label' | 'tag'>();
  const [undoable, setUndoable] = useState<{
    summary: string;
    token: number;
    workspaceId: string;
  }>();
  const labelButton = useRef<HTMLButtonElement>(null);
  const tagButton = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const tagId = useId();
  const ids = selection.ids;
  const count = ids.length;
  // The batch action stays available only while its own edit is the undo head.
  // Any later undoable edit, an undo, a lock or a workspace change retires it, so
  // it can never discard an unrelated newer edit.
  const owned =
    undoable?.token === undoToken && undoable?.workspaceId === workspace.id ? undoable : undefined;
  useEffect(() => {
    if (undoable && !owned) setUndoable(undefined);
  }, [owned, undoable]);
  const hiddenIds = useMemo(
    () => new Set(workspace.view.hiddenNodeIds ?? []),
    [workspace.view.hiddenNodeIds],
  );
  const manuallyHidden = ids.filter((id) => hiddenIds.has(id)).length;
  const apply = (summary: string, update: (workspace: Workspace) => Workspace) => {
    const token = onApply(summary, update);
    // A batch that changed nothing, or failed, never advertises an undo step.
    setUndoable(token === undefined ? undefined : { summary, token, workspaceId: workspace.id });
    setEditor(undefined);
  };
  useEffect(() => {
    if (!active) setEditor(undefined);
  }, [active]);
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
          onClick={() => selection.replace(matching.ids)}
        >
          <Plus size={13} /> Select {matching.label}
        </button>
      )}
      {count > 0 && (
        <>
          <button
            ref={labelButton}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={editor === 'label'}
            aria-controls={editor === 'label' ? labelId : undefined}
            onClick={() => setEditor(editor === 'label' ? undefined : 'label')}
          >
            <Type size={13} /> Label
          </button>
          <button
            ref={tagButton}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={editor === 'tag'}
            aria-controls={editor === 'tag' ? tagId : undefined}
            onClick={() => setEditor(editor === 'tag' ? undefined : 'tag')}
          >
            <Tag size={13} /> Tag
          </button>
          <span className="selection-toolbar-icon">
            <IconPicker
              value=""
              caption="Icon"
              ariaLabel={`Set an icon on ${count} selected entities`}
              onChange={(icon) =>
                apply(
                  icon ? `Icon set on ${count} entities` : `Icon cleared on ${count} entities`,
                  (current) => applyBatchIcon(current, ids, icon),
                )
              }
            />
          </span>
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
          aria-label={`Undo: ${owned.summary}`}
          title={`Undo: ${owned.summary}`}
          onClick={() => {
            onUndo();
            setUndoable(undefined);
          }}
        >
          <Undo2 size={13} /> Undo
        </button>
      )}
      {editor === 'label' && labelButton.current && (
        <LabelBatchEditor
          id={labelId}
          anchor={labelButton.current}
          workspace={workspace}
          ids={ids}
          onClose={() => setEditor(undefined)}
          onApply={apply}
        />
      )}
      {editor === 'tag' && tagButton.current && (
        <TagBatchEditor
          id={tagId}
          anchor={tagButton.current}
          workspace={workspace}
          ids={ids}
          onClose={() => setEditor(undefined)}
          onApply={apply}
        />
      )}
    </div>
  );
}

interface EditorProps {
  id: string;
  anchor: HTMLElement;
  workspace: Workspace;
  ids: string[];
  onClose: () => void;
  onApply: (summary: string, update: (workspace: Workspace) => Workspace) => void;
}

function LabelBatchEditor({ id, anchor, workspace, ids, onClose, onApply }: EditorProps) {
  const [value, setValue] = useState('');
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);
  const plan = useMemo(
    () => labelBatchPlan(workspace, ids, { onlyUnlabeled }),
    [workspace, ids, onlyUnlabeled],
  );
  const targets = plan.targetIds.length;
  const trimmed = value.trim();
  return (
    <AnchoredPopover
      id={id}
      anchor={anchor}
      title="Label selected entities"
      width={306}
      onClose={onClose}
    >
      <label>
        New label
        <input
          data-autofocus
          type="text"
          aria-label={`Label for ${targets} selected entities`}
          maxLength={200}
          placeholder="Leave empty to clear labels"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !targets) return;
            event.preventDefault();
            onApply(
              trimmed
                ? `Label applied to ${targets} entities`
                : `Label cleared on ${targets} entities`,
              (current) => applyBatchLabel(current, ids, value, { onlyUnlabeled }),
            );
          }}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={onlyUnlabeled}
          onChange={(event) => setOnlyUnlabeled(event.target.checked)}
        />
        Only unlabeled ({plan.unlabeledCount.toLocaleString('en-US')})
      </label>
      <p role="status">
        Applies to {targets.toLocaleString('en-US')} of {ids.length.toLocaleString('en-US')}{' '}
        selected. {plan.replacedCount.toLocaleString('en-US')} existing{' '}
        {plan.replacedCount === 1 ? 'label' : 'labels'} would be replaced.
      </p>
      {plan.distinctLabels.length > 1 && !onlyUnlabeled && (
        <p>
          Existing labels differ: {plan.distinctLabels.join(', ')}
          {plan.labeledCount > plan.distinctLabels.length ? '…' : ''}
        </p>
      )}
      <p>Notes, icons, bookmarks and tags stay unchanged.</p>
      <div className="batch-editor-actions">
        <button
          type="button"
          className="primary"
          disabled={!targets}
          onClick={() =>
            onApply(
              trimmed
                ? `Label applied to ${targets} entities`
                : `Label cleared on ${targets} entities`,
              (current) => applyBatchLabel(current, ids, value, { onlyUnlabeled }),
            )
          }
        >
          {trimmed
            ? `Apply to ${targets.toLocaleString('en-US')}`
            : `Clear label on ${targets.toLocaleString('en-US')}`}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </AnchoredPopover>
  );
}

function TagBatchEditor({ id, anchor, workspace, ids, onClose, onApply }: EditorProps) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const tags = workspace.tags ?? [];
  const name = query.trim();
  const shown = tags.filter((tag) => tag.name.toLowerCase().includes(name.toLowerCase()));
  const duplicate = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  const run = (summary: string, update: (workspace: Workspace) => Workspace) => {
    try {
      const probe = update(workspace);
      if (probe === workspace) {
        setError('That change would not alter this selection.');
        return;
      }
      setError('');
      onApply(summary, update);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The tag change could not be applied.');
    }
  };
  return (
    <AnchoredPopover
      id={id}
      anchor={anchor}
      title="Tag selected entities"
      width={318}
      onClose={onClose}
    >
      <label>
        Find or create a tag
        <input
          data-autofocus
          type="search"
          aria-label="Find or create a tag for the selection"
          maxLength={100}
          placeholder="Exchange, shop, savings…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {name && !duplicate && (
        <button
          type="button"
          className="primary batch-tag-create"
          onClick={() =>
            run(`Tag ${name} added to ${ids.length} entities`, (current) =>
              createBatchTag(current, ids, {
                name,
                color: tagColors[(current.tags?.length ?? 0) % tagColors.length],
              }),
            )
          }
        >
          <Plus size={12} /> Create “{name}” and add {ids.length.toLocaleString('en-US')}
        </button>
      )}
      <div className="batch-tag-list">
        {shown.map((tag) => {
          const plan = tagBatchPlan(workspace, ids, tag.id);
          return (
            <div key={tag.id} className="batch-tag-row">
              <span className="batch-tag-name">
                <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                <span>{tag.name}</span>
                <small>
                  in {plan.memberCount.toLocaleString('en-US')} of{' '}
                  {plan.total.toLocaleString('en-US')}
                </small>
              </span>
              <button
                type="button"
                disabled={!plan.missingCount}
                aria-label={`Add ${plan.missingCount} selected entities to ${tag.name}`}
                onClick={() =>
                  run(`Tag ${tag.name} added to ${plan.missingCount} entities`, (current) =>
                    applyBatchTag(current, ids, tag.id, 'add'),
                  )
                }
              >
                <Plus size={12} /> Add {plan.missingCount.toLocaleString('en-US')}
              </button>
              <button
                type="button"
                disabled={!plan.memberCount}
                aria-label={`Remove ${plan.memberCount} selected entities from ${tag.name}`}
                onClick={() =>
                  run(`Tag ${tag.name} removed from ${plan.memberCount} entities`, (current) =>
                    applyBatchTag(current, ids, tag.id, 'remove'),
                  )
                }
              >
                <X size={12} /> Remove {plan.memberCount.toLocaleString('en-US')}
              </button>
            </div>
          );
        })}
        {!shown.length && !name && (
          <p>This workspace has no tags yet. Type a name to create one.</p>
        )}
        {!shown.length && name && duplicate === undefined && <p>No existing tag matches.</p>}
      </div>
      {error && (
        <p className="batch-editor-error" role="alert">
          {error}
        </p>
      )}
      <p>
        Adding or removing changes direct membership for the selected entities only. Other members
        keep their tag.
      </p>
      <div className="batch-editor-actions">
        <button type="button" onClick={onClose}>
          <Check size={12} /> Done
        </button>
      </div>
    </AnchoredPopover>
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
