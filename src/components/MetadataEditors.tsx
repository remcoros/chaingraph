import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, Plus, X } from 'lucide-react';
import { useDialogFocus } from './Dialogs';
import {
  applyEntityNote,
  applyBatchLabel,
  applyBatchTag,
  createBatchTag,
  planBatchLabel,
  planBatchTag,
} from '../domain/batchMetadata';
import { canonicalTagNodeId } from '../domain/tags';
import type { Workspace, WorkspaceTag } from '../domain/types';
import { DEFAULT_TAG_COLOR, TAG_COLORS } from '../domain/tagColors';
import './metadata-editors.css';

export interface MetadataEditorProps {
  workspace: Workspace;
  ids: string[];
  single?: boolean;
  id?: string;
  onClose: () => void;
  /** Return false when the owner could not apply the update. */
  onApply: (summary: string, update: (workspace: Workspace) => Workspace) => boolean | void;
}

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

export function BatchLabelEditor({
  workspace,
  ids,
  single = false,
  id,
  onClose,
  onApply,
}: MetadataEditorProps) {
  const ref = useDialogFocus(onClose, undefined, false);
  const [value, setValue] = useState(single ? (workspace.annotations[ids[0]]?.label ?? '') : '');
  const [replace, setReplace] = useState(single);
  const [error, setError] = useState('');
  const plan = planBatchLabel(workspace, ids, replace);
  return (
    <div
      ref={ref}
      className="metadata-editor compact-controls"
      role="dialog"
      aria-modal="false"
      id={id}
      aria-label="Label selected records"
    >
      <div className="metadata-editor-heading">
        <strong>{single ? 'Edit label' : `Label ${ids.length} records`}</strong>
        <button className="icon-button" aria-label="Close label editor" onClick={onClose}>
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
              `Labelled ${count} record${count === 1 ? '' : 's'}.${
                plan.preserved
                  ? ` ${plan.preserved} existing label${plan.preserved === 1 ? '' : 's'} kept.`
                  : ''
              }`,
              update,
            );
            if (applied === false) {
              setError('Could not apply this label. Try again.');
              return;
            }
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not apply this label.');
            return;
          }
          onClose();
        }}
      >
        <label>
          Label
          <input
            data-autofocus
            aria-label="Batch label"
            maxLength={200}
            value={value}
            placeholder="Exchange A withdrawal, shop payment…"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {!single && (
          <label className="metadata-replace">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
            />
            Replace existing labels
          </label>
        )}
        <p className="small muted">
          {single
            ? 'Saves automatically after applying.'
            : `${plan.targets.length} of ${ids.length} records change.`}
          {plan.preserved ? ` ${plan.preserved} already labelled and kept as they are.` : ''}
        </p>
        <div className="button-row">
          <button className="primary" disabled={!plan.targets.length}>
            <Check size={14} /> Apply label
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

export function BatchTagEditor({
  workspace,
  ids,
  id,
  onClose,
  onApply,
  children,
  footer,
  membershipHint,
}: MetadataEditorProps & {
  children?: ReactNode;
  footer?: ReactNode;
  membershipHint?: (tag: WorkspaceTag) => ReactNode;
}) {
  const ref = useDialogFocus(onClose, undefined, false);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_TAG_COLOR);
  const [error, setError] = useState('');
  const tags = workspace.tags ?? [];
  const name = query.trim();
  const matching = tags.filter((tag) =>
    `${tag.name} ${tag.description ?? ''}`.toLowerCase().includes(name.toLowerCase()),
  );
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
      // Add/Remove becomes disabled after applying. Keep keyboard focus usable.
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
      className="metadata-editor compact-controls"
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
          maxLength={100}
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
        {matching.map((tag) => {
          const plan = planBatchTag(workspace, ids, tag.id, true);
          const assigned = ids.length - plan.targets.length;
          return (
            <div className="metadata-tag-option" key={tag.id}>
              <span className="metadata-tag-dot" style={{ backgroundColor: tag.color }} />
              <span className="metadata-tag-name">
                {tag.name}
                <small className="muted">
                  {assigned} of {ids.length} selected
                </small>
                {membershipHint?.(tag)}
              </span>
              <div className="metadata-tag-actions">
                <button
                  disabled={assigned === ids.length}
                  aria-label={`Add ${tag.name} to selected records`}
                  onClick={() => assign(tag.id, true)}
                >
                  <Plus size={13} /> Add
                </button>
                <button
                  disabled={!assigned}
                  aria-label={`Remove ${tag.name} from selected records`}
                  onClick={() => assign(tag.id, false)}
                >
                  <Minus size={13} /> Remove
                </button>
              </div>
            </div>
          );
        })}
        {!matching.length && (
          <p className="small muted">
            {tags.length ? 'No matching tags.' : 'Type a name to create your first tag.'}
          </p>
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
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const position = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      element.style.width = `${Math.max(0, Math.min(380, width - 24))}px`;
      element.style.maxHeight = `${height - 24}px`;
      const trigger = anchor.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      element.style.left = `${Math.max(left + 12, Math.min(trigger.left, left + width - box.width - 12))}px`;
      const preferredTop =
        trigger.bottom + 6 + box.height > top + height - 12
          ? trigger.top - box.height - 6
          : trigger.bottom + 6;
      element.style.top = `${Math.max(top + 12, Math.min(preferredTop, top + height - box.height - 12))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('scroll', position);
    window.visualViewport?.addEventListener('resize', position);
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
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('scroll', position);
      window.visualViewport?.removeEventListener('resize', position);
      document.removeEventListener('pointerdown', outside);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div className="metadata-popover" ref={ref}>
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
  const canonicalId = canonicalTagNodeId(id, workspace.network);
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
        maxLength={10000}
        value={workspace.annotations[canonicalId]?.note ?? ''}
        onChange={(event) => {
          const note = event.target.value;
          onChange((current) => applyEntityNote(current, canonicalId, note), group);
        }}
      />
      <p className="small muted">Saves automatically, encrypted. Undo restores edits.</p>
      <button onClick={onClose}>Done</button>
    </div>
  );
}
