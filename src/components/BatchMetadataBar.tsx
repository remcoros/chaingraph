import { useState } from 'react';
import { Check, Tag, TextCursorInput, X } from 'lucide-react';
import { IconPicker } from './IconPicker';
import { useDialogFocus } from './Dialogs';
import {
  applyBatchIcon,
  applyBatchLabel,
  applyBatchTag,
  createBatchTag,
  planBatchIcon,
  planBatchLabel,
  planBatchTag,
} from '../domain/batchMetadata';
import type { Workspace } from '../domain/types';

const colors = ['#65cbbb', '#e4af67', '#9c9aed', '#e888a5', '#85bce8', '#a4c977'];

export interface BatchMetadataBarProps {
  workspace: Workspace;
  /** Explicitly selected records. Filters never widen this set. */
  ids: string[];
  scopeLabel: string;
  disabled?: boolean;
  guidance?: string;
  onChange: (update: (workspace: Workspace) => Workspace) => void;
  onNotice: (message: string) => void;
  onClear?: () => void;
}

/** Direct label, tag and icon editing for a chosen set of records. Each action is
 * one workspace update, so autosave and Undo treat the batch as a single step.
 */
export function BatchMetadataBar({
  workspace,
  ids,
  scopeLabel,
  disabled,
  guidance,
  onChange,
  onNotice,
  onClear,
}: BatchMetadataBarProps) {
  const [open, setOpen] = useState<'label' | 'tags' | undefined>();
  const [replaceIcons, setReplaceIcons] = useState(false);
  if (!ids.length) return null;
  return (
    <div className="batch-bar" role="group" aria-label="Batch metadata editing">
      <span className="batch-scope">
        <strong>{ids.length}</strong> {scopeLabel}
      </span>
      <div className="batch-actions">
        <div className="batch-popover-anchor">
          <button
            aria-haspopup="dialog"
            aria-expanded={open === 'label'}
            disabled={disabled}
            onClick={() => setOpen(open === 'label' ? undefined : 'label')}
          >
            <TextCursorInput size={14} /> Label
          </button>
          {open === 'label' && (
            <BatchLabelEditor
              workspace={workspace}
              ids={ids}
              onClose={() => setOpen(undefined)}
              onChange={onChange}
              onNotice={onNotice}
            />
          )}
        </div>
        <div className="batch-popover-anchor">
          <button
            aria-haspopup="dialog"
            aria-expanded={open === 'tags'}
            disabled={disabled}
            onClick={() => setOpen(open === 'tags' ? undefined : 'tags')}
          >
            <Tag size={14} /> Tag
          </button>
          {open === 'tags' && (
            <BatchTagEditor
              workspace={workspace}
              ids={ids}
              onClose={() => setOpen(undefined)}
              onChange={onChange}
              onNotice={onNotice}
            />
          )}
        </div>
        <IconPicker
          value=""
          fieldLabel="Set icon"
          onChange={(icon) => {
            const plan = planBatchIcon(workspace, ids, replaceIcons);
            if (!plan.targets.length) {
              onNotice('Every selected record already has an icon. Enable Replace to change them.');
              return;
            }
            onChange((current) => applyBatchIcon(current, ids, icon, replaceIcons));
            onNotice(
              `${icon ? 'Icon set on' : 'Icon cleared on'} ${plan.targets.length} record${
                plan.targets.length === 1 ? '' : 's'
              }.${plan.preserved ? ` ${plan.preserved} kept an existing icon.` : ''}`,
            );
          }}
        />
        <label className="batch-replace">
          <input
            type="checkbox"
            checked={replaceIcons}
            onChange={(event) => setReplaceIcons(event.target.checked)}
          />
          Replace icons
        </label>
        {onClear && (
          <button className="text-button" onClick={onClear}>
            Clear selection
          </button>
        )}
      </div>
      {guidance && (
        <p className="batch-guidance" role="note">
          {guidance}
        </p>
      )}
    </div>
  );
}

function BatchLabelEditor({
  workspace,
  ids,
  onClose,
  onChange,
  onNotice,
}: Pick<BatchMetadataBarProps, 'workspace' | 'ids' | 'onChange' | 'onNotice'> & {
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose);
  const [value, setValue] = useState('');
  const [replace, setReplace] = useState(false);
  const plan = planBatchLabel(workspace, ids, replace);
  return (
    <div
      ref={ref}
      className="batch-popover"
      role="dialog"
      aria-modal="false"
      aria-label="Label selected records"
    >
      <div className="batch-popover-heading">
        <strong>Label {ids.length} records</strong>
        <button className="icon-button" aria-label="Close label editor" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!plan.targets.length) return;
          const count = plan.targets.length;
          onChange((current) => applyBatchLabel(current, ids, value.trim(), replace));
          onNotice(
            `Labelled ${count} record${count === 1 ? '' : 's'}.${
              plan.preserved
                ? ` ${plan.preserved} existing label${plan.preserved === 1 ? '' : 's'} kept.`
                : ''
            }`,
          );
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
        <label className="batch-replace">
          <input
            type="checkbox"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          Replace existing labels
        </label>
        <p className="small muted">
          {plan.targets.length} of {ids.length} records change.
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
    </div>
  );
}

function BatchTagEditor({
  workspace,
  ids,
  onClose,
  onChange,
  onNotice,
}: Pick<BatchMetadataBarProps, 'workspace' | 'ids' | 'onChange' | 'onNotice'> & {
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState(colors[0]);
  const [error, setError] = useState('');
  const tags = workspace.tags ?? [];
  const name = query.trim();
  const matching = tags.filter((tag) => tag.name.toLowerCase().includes(name.toLowerCase()));
  const duplicate = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  function assign(tagId: string, add: boolean) {
    const plan = planBatchTag(workspace, ids, tagId, add);
    if (!plan.targets.length) return;
    try {
      onChange((current) => applyBatchTag(current, ids, tagId, add));
      onNotice(
        `${add ? 'Tagged' : 'Removed the tag from'} ${plan.targets.length} record${
          plan.targets.length === 1 ? '' : 's'
        }.`,
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this tag.');
    }
  }
  return (
    <div
      ref={ref}
      className="batch-popover"
      role="dialog"
      aria-modal="false"
      aria-label="Tag selected records"
    >
      <div className="batch-popover-heading">
        <strong>Tag {ids.length} records</strong>
        <button className="icon-button" aria-label="Close tag editor" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name) return;
          if (duplicate) {
            assign(duplicate.id, true);
            setQuery('');
            return;
          }
          try {
            onChange((current) => createBatchTag(current, { name, color }, ids));
            onNotice(
              `Created tag ${name} with ${ids.length} record${ids.length === 1 ? '' : 's'}.`,
            );
            setQuery('');
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not create this tag.');
          }
        }}
      >
        <input
          data-autofocus
          type="search"
          aria-label="Find or create tag"
          placeholder="Find or create tag…"
          maxLength={100}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {name && !duplicate && (
          <div className="batch-tag-create">
            <div className="tag-colors" role="group" aria-label="Tag color">
              {colors.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Color ${index + 1}`}
                  aria-pressed={color === option}
                  style={{ backgroundColor: option }}
                  onClick={() => setColor(option)}
                >
                  {color === option && <Check size={13} />}
                </button>
              ))}
            </div>
            <button className="primary">Create and assign</button>
          </div>
        )}
      </form>
      <div className="batch-tag-options" role="group" aria-label="Existing tags">
        {matching.map((tag) => {
          const plan = planBatchTag(workspace, ids, tag.id, true);
          const assigned = ids.length - plan.targets.length;
          return (
            <div className="batch-tag-option" key={tag.id}>
              <span className="tag-dot" style={{ backgroundColor: tag.color }} />
              <span className="batch-tag-name">
                {tag.name}
                <small className="muted">
                  {assigned} of {ids.length} selected
                </small>
              </span>
              <button
                disabled={assigned === ids.length}
                aria-label={`Add ${tag.name} to selected records`}
                onClick={() => assign(tag.id, true)}
              >
                Add
              </button>
              <button
                disabled={!assigned}
                aria-label={`Remove ${tag.name} from selected records`}
                onClick={() => assign(tag.id, false)}
              >
                Remove
              </button>
            </div>
          );
        })}
        {!matching.length && (
          <p className="small muted">
            {tags.length ? 'No matching tags.' : 'Type a name to create your first tag.'}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="small warning">
          {error}
        </p>
      )}
    </div>
  );
}
