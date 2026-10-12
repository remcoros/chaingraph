import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, X } from 'lucide-react';
import { useDialogFocus } from '../useDialogFocus';
import {
  applyEntityNote,
  applyBatchLabel,
  applyBatchTag,
  createBatchTag,
  planBatchLabel,
  planBatchTag,
} from '../../../Core/Workspace/Annotations/batchMetadata';
import { canonicalAnnotationReference } from '../../../Core/Workspace/annotationReferences';
import type { Workspace } from '../../../Core/Workspace/workspace';
import {
  MAX_ANNOTATION_LABEL_LENGTH,
  MAX_ANNOTATION_NOTE_LENGTH,
  MAX_TAG_NAME_LENGTH,
  type WorkspaceTag,
} from '../../../Core/Workspace/Annotations/annotations';

import { DEFAULT_TAG_COLOR, TAG_COLORS } from './tagColors';
import './metadata-editors.css';

export interface MetadataEditorProps {
  workspace: Workspace;
  ids: string[];
  id?: string;
  onClose: () => void;
  /** Return false when the owner could not apply the update. */
  onApply: (summary: string, update: (workspace: Workspace) => Workspace) => boolean | void;
}

type EntityEditorProps = Omit<MetadataEditorProps, 'ids'> & { entityId: string };

type TagEditorProps = MetadataEditorProps & {
  children?: ReactNode;
  footer?: ReactNode;
  membershipHint?: (tag: WorkspaceTag) => ReactNode;
};

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="metadata-colors" role="group" aria-label="Tag color">
      {[...new Set([...TAG_COLORS, value])].map((option, index) => (
        <button
          key={option}
          type="button"
          aria-label={`Color ${index + 1}`}
          aria-pressed={value === option}
          style={{ backgroundColor: option }}
          onClick={() => onChange(option)}
        >
          {value === option && <Check size={13} />}
        </button>
      ))}
    </div>
  );
}

export function EntityLabelEditor({ entityId, ...props }: EntityEditorProps) {
  const fieldName = entityId.startsWith('party:') ? 'Name' : 'Label';
  return (
    <LabelEditor
      {...props}
      ids={[entityId]}
      initialValue={props.workspace.annotations.entities[entityId]?.label ?? ''}
      replace
      heading={`Edit ${fieldName.toLowerCase()}`}
      fieldName={fieldName}
    />
  );
}

export function BatchLabelEditor(props: MetadataEditorProps) {
  const [replace, setReplace] = useState(false);
  return (
    <LabelEditor
      {...props}
      initialValue=""
      replace={replace}
      heading={`Label ${props.ids.length} records`}
    >
      <label className="metadata-replace">
        <input
          type="checkbox"
          checked={replace}
          onChange={(event) => setReplace(event.target.checked)}
        />
        Replace existing labels
      </label>
    </LabelEditor>
  );
}

function LabelEditor({
  workspace,
  ids,
  id,
  onClose,
  onApply,
  initialValue,
  replace,
  heading,
  fieldName = 'Label',
  children,
}: MetadataEditorProps & {
  initialValue: string;
  replace: boolean;
  heading: string;
  fieldName?: 'Label' | 'Name';
  children?: ReactNode;
}) {
  const ref = useDialogFocus(onClose, undefined, false);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const plan = planBatchLabel(workspace, ids, replace);
  return (
    <div
      ref={ref}
      className="metadata-editor compact-controls"
      role="dialog"
      aria-modal="false"
      id={id}
      aria-label={fieldName === 'Name' ? 'Name' : 'Label selected records'}
    >
      <div className="metadata-editor-heading">
        <strong>{heading}</strong>
        <button
          className="icon-button"
          aria-label={`Close ${fieldName.toLowerCase()} editor`}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!plan.targets.length) return;
          const count = plan.targets.length;
          const update = (current: Workspace) =>
            applyBatchLabel(current, ids, value.trim(), replace);
          try {
            update(workspace);
            const applied = onApply(
              fieldName === 'Name'
                ? 'Name saved.'
                : `Labelled ${count} record${count === 1 ? '' : 's'}.${
                    plan.preserved
                      ? ` ${plan.preserved} existing label${plan.preserved === 1 ? '' : 's'} kept.`
                      : ''
                  }`,
              update,
            );
            if (applied === false) {
              setError(`Could not apply this ${fieldName.toLowerCase()}. Try again.`);
              return;
            }
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : `Could not apply this ${fieldName.toLowerCase()}.`,
            );
            return;
          }
          onClose();
        }}
      >
        <label>
          {fieldName}
          <input
            data-autofocus
            aria-label={fieldName === 'Name' ? 'Name' : 'Batch label'}
            maxLength={MAX_ANNOTATION_LABEL_LENGTH}
            value={value}
            placeholder={
              fieldName === 'Name'
                ? 'Person or organization…'
                : 'Exchange A withdrawal, shop payment…'
            }
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {children}
        {ids.length > 1 && (
          <p className="small muted">
            {plan.targets.length} of {ids.length} records
            {plan.preserved ? ` · ${plan.preserved} existing labels kept` : ''}
          </p>
        )}
        <div className="button-row">
          <button className="primary" disabled={!plan.targets.length}>
            <Check size={14} /> Apply {fieldName.toLowerCase()}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="small warning">
          {error}
        </p>
      )}
    </div>
  );
}

export function EntityTagEditor({
  entityId,
  ...props
}: Omit<TagEditorProps, 'ids'> & { entityId: string }) {
  return <TagEditor {...props} ids={[entityId]} />;
}

export function BatchTagEditor(props: TagEditorProps) {
  return (
    <TagEditor
      {...props}
      membershipCount={(assigned, total) => (
        <small className="muted">
          {assigned} of {total} selected
        </small>
      )}
    />
  );
}

function TagEditor({
  workspace,
  ids,
  id,
  onClose,
  onApply,
  children,
  footer,
  membershipHint,
  membershipCount,
}: TagEditorProps & {
  membershipCount?: (assigned: number, total: number) => ReactNode;
}) {
  const ref = useDialogFocus(onClose, undefined, false);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_TAG_COLOR);
  const [error, setError] = useState('');
  const tags = workspace.annotations.tags ?? [];
  const name = query.trim();
  const matching = tags
    .filter((tag) =>
      `${tag.name} ${tag.description ?? ''}`.toLowerCase().includes(name.toLowerCase()),
    )
    .map((tag, index) => {
      const plan = planBatchTag(workspace, ids, tag.id, true);
      return { tag, assigned: ids.length - plan.targets.length, index };
    })
    .sort((a, b) => Number(b.assigned > 0) - Number(a.assigned > 0) || a.index - b.index);
  const duplicate = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  function assign(tagId: string, add: boolean) {
    const plan = planBatchTag(workspace, ids, tagId, add);
    if (!plan.targets.length) return true;
    try {
      const update = (current: Workspace) => applyBatchTag(current, ids, tagId, add);
      update(workspace);
      const applied = onApply(
        `${add ? 'Tagged' : 'Removed the tag from'} ${plan.targets.length} record${
          plan.targets.length === 1 ? '' : 's'
        }.`,
        update,
      );
      if (applied === false) {
        setError('Could not update this tag. Try again.');
        return false;
      }
      setError('');
      // Return focus to search after the workspace update reorders assigned tags.
      search.current?.focus({ preventScroll: true });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this tag.');
      return false;
    }
  }
  return (
    <div
      ref={ref}
      className="metadata-editor metadata-tag-editor compact-controls"
      role="dialog"
      aria-modal="false"
      id={id}
      aria-label="Tag selected records"
    >
      <div className="metadata-editor-heading">
        <strong>
          Tag {ids.length} {ids.length === 1 ? 'record' : 'records'}
        </strong>
        <button className="icon-button" aria-label="Close tag editor" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {children}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name) return;
          if (duplicate) {
            if (assign(duplicate.id, true)) setQuery('');
            return;
          }
          try {
            const update = (current: Workspace) => createBatchTag(current, { name, color }, ids);
            update(workspace);
            const applied = onApply(
              `Created tag ${name} with ${ids.length} record${ids.length === 1 ? '' : 's'}.`,
              update,
            );
            if (applied === false) {
              setError('Could not create this tag. Try again.');
              return;
            }
            setQuery('');
            setError('');
            // The batch is applied, so close and return focus to the Tag control.
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not create this tag.');
          }
        }}
      >
        <input
          ref={search}
          data-autofocus
          type="search"
          aria-label="Find or create tag"
          placeholder="Find or create tag…"
          maxLength={MAX_TAG_NAME_LENGTH}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {name && !duplicate && (
          <div className="metadata-tag-create">
            <ColorPicker value={color} onChange={setColor} />
            <button className="primary">
              <Plus size={13} /> Create and assign
            </button>
          </div>
        )}
      </form>
      <div className="metadata-tag-options" role="group" aria-label="Existing tags">
        {matching.map(({ tag, assigned }) => {
          const fullyAssigned = assigned === ids.length;
          return (
            <button
              type="button"
              className={`metadata-tag-option ${assigned > 0 ? 'has-assignment' : ''}`}
              key={tag.id}
              aria-pressed={fullyAssigned}
              aria-label={`${fullyAssigned ? 'Remove' : 'Add'} ${tag.name} ${
                fullyAssigned ? 'from' : 'to'
              } selected records`}
              onClick={() => assign(tag.id, !fullyAssigned)}
            >
              <span className="metadata-tag-dot" style={{ backgroundColor: tag.color }} />
              <span className="metadata-tag-name">
                {tag.name}
                {membershipCount?.(assigned, ids.length)}
                {membershipHint?.(tag)}
              </span>
              {fullyAssigned && (
                <Check className="metadata-tag-state" size={14} aria-hidden="true" />
              )}
            </button>
          );
        })}
        {!matching.length && (
          <p className="small muted">{tags.length ? 'No results' : 'No tags yet'}</p>
        )}
      </div>
      {footer}
      {error && (
        <p role="alert" className="small warning">
          {error}
        </p>
      )}
    </div>
  );
}

/** Portal keeps editors out of the scrolling workbench's clipping boundary. */
export function MetadataPopover({
  anchor,
  onClose,
  children,
  compact = false,
  point,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  compact?: boolean;
  point?: { x: number; y: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    let frame = 0;
    const position = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const gutter = compact ? 8 : 12;
      const anchorGap = compact ? 4 : 6;
      element.style.width = `${Math.max(0, Math.min(compact ? 320 : 380, width - gutter * 2))}px`;
      element.style.maxHeight = `${height - gutter * 2}px`;
      const trigger = anchor.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const preferredLeft = point
        ? point.x + anchorGap + box.width > left + width - gutter
          ? point.x - box.width - anchorGap
          : point.x + anchorGap
        : trigger.left;
      element.style.left = `${Math.max(left + gutter, Math.min(preferredLeft, left + width - box.width - gutter))}px`;
      const anchorBottom = point?.y ?? trigger.bottom;
      const anchorTop = point?.y ?? trigger.top;
      const preferredTop =
        anchorBottom + anchorGap + box.height > top + height - gutter
          ? anchorTop - box.height - anchorGap
          : anchorBottom + anchorGap;
      element.style.top = `${Math.max(top + gutter, Math.min(preferredTop, top + height - box.height - gutter))}px`;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !element.contains(event.target) &&
        !anchor.contains(event.target)
      )
        onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.removeEventListener('pointerdown', outside);
    };
  }, [anchor, compact, onClose, point]);
  return createPortal(
    <div className={`metadata-popover ${compact ? 'is-compact' : ''}`} ref={ref}>
      {children}
    </div>,
    document.body,
  );
}

export function EntityNoteEditor({
  workspace,
  id,
  onChange,
  onClose,
}: {
  workspace: Workspace;
  id: string;
  onChange: (update: (workspace: Workspace) => Workspace, group?: string) => void;
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose, undefined, false);
  const [group] = useState(() => `note:${crypto.randomUUID()}`);
  const canonicalId = canonicalAnnotationReference(id, workspace.network);
  return (
    <div
      ref={ref}
      className="metadata-editor compact-controls"
      role="dialog"
      aria-modal="false"
      aria-label="Edit notes"
    >
      <div className="metadata-editor-heading">
        <strong>Notes</strong>
        <button className="icon-button" aria-label="Close notes editor" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <textarea
        data-autofocus
        aria-label="Entity notes"
        rows={5}
        maxLength={MAX_ANNOTATION_NOTE_LENGTH}
        value={workspace.annotations.entities[canonicalId]?.note ?? ''}
        onChange={(event) => {
          const note = event.target.value;
          onChange((current) => applyEntityNote(current, canonicalId, note), group);
        }}
      />
      <button onClick={onClose}>Done</button>
    </div>
  );
}
