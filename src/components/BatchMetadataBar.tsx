import { useEffect, useRef, useState } from 'react';
import { Tag, TextCursorInput } from 'lucide-react';
import { IconPicker } from './IconPicker';
import {
  BatchLabelEditor,
  BatchTagEditor,
  EntityNoteEditor,
  MetadataPopover,
} from './MetadataEditors';
import { applyBatchIcon, planBatchIcon } from '../domain/batchMetadata';
import type { Workspace } from '../domain/types';

export interface BatchMetadataBarProps {
  workspace: Workspace;
  /** Explicitly selected records. Filters never widen this set. */
  ids: string[];
  scopeLabel: string;
  single?: boolean;
  active?: boolean;
  disabled?: boolean;
  guidance?: string;
  onChange: (update: (workspace: Workspace) => Workspace, group?: string) => void;
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
  single = false,
  active = true,
  disabled,
  guidance,
  onChange,
  onNotice,
  onClear,
}: BatchMetadataBarProps) {
  const [open, setOpen] = useState<'label' | 'tags' | 'notes' | undefined>();
  const [replaceIcons, setReplaceIcons] = useState(false);
  const labelTrigger = useRef<HTMLButtonElement>(null);
  const noteTrigger = useRef<HTMLButtonElement>(null);
  const tagTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) setOpen(undefined);
  }, [active]);
  const scopeKey = `${workspace.id}:${ids.join('|')}`;
  useEffect(() => setOpen(undefined), [scopeKey]);
  if (!active || !ids.length) return null;
  const firstIcon = workspace.annotations[ids[0]]?.icon ?? '';
  const mixedIcons = ids.some((id) => (workspace.annotations[id]?.icon ?? '') !== firstIcon);
  return (
    <div
      className={`batch-bar ${single ? 'single-metadata-bar' : 'batch-selection-bar'}`}
      role="group"
      aria-label={single ? 'Edit entity metadata' : 'Batch metadata editing'}
    >
      <span className="batch-scope">
        {single ? (
          scopeLabel
        ) : (
          <>
            <strong>{ids.length}</strong> {scopeLabel}
          </>
        )}
      </span>
      <div className="batch-actions">
        <div className="batch-popover-anchor">
          <button
            ref={labelTrigger}
            aria-haspopup="dialog"
            aria-expanded={open === 'label'}
            disabled={disabled}
            onClick={() => setOpen(open === 'label' ? undefined : 'label')}
          >
            <TextCursorInput size={14} /> Label
          </button>
          {open === 'label' && (
            <MetadataPopover anchor={labelTrigger.current!} onClose={() => setOpen(undefined)}>
              <BatchLabelEditor
                workspace={workspace}
                ids={ids}
                single={single}
                onClose={() => setOpen(undefined)}
                onApply={(summary, update) => {
                  onChange(update);
                  onNotice(summary);
                }}
              />
            </MetadataPopover>
          )}
        </div>
        <div className="batch-popover-anchor">
          <button
            ref={tagTrigger}
            aria-haspopup="dialog"
            aria-expanded={open === 'tags'}
            disabled={disabled}
            onClick={() => setOpen(open === 'tags' ? undefined : 'tags')}
          >
            <Tag size={14} /> Tags
          </button>
          {open === 'tags' && (
            <MetadataPopover anchor={tagTrigger.current!} onClose={() => setOpen(undefined)}>
              <BatchTagEditor
                workspace={workspace}
                ids={ids}
                onClose={() => setOpen(undefined)}
                onApply={(summary, update) => {
                  onChange(update);
                  onNotice(summary);
                }}
              />
            </MetadataPopover>
          )}
        </div>
        {single && ids.length === 1 && (
          <div className="batch-popover-anchor">
            <button
              ref={noteTrigger}
              aria-haspopup="dialog"
              aria-expanded={open === 'notes'}
              disabled={disabled}
              onClick={() => setOpen(open === 'notes' ? undefined : 'notes')}
            >
              Notes
            </button>
            {open === 'notes' && (
              <MetadataPopover anchor={noteTrigger.current!} onClose={() => setOpen(undefined)}>
                <EntityNoteEditor
                  key={scopeKey}
                  workspace={workspace}
                  id={ids[0]}
                  onChange={onChange}
                  onClose={() => setOpen(undefined)}
                />
              </MetadataPopover>
            )}
          </div>
        )}
        <div
          className="batch-icon"
          // The icon palette is a batch editor too: opening it closes the others
          // instead of stacking a second focus trap over this bar.
          onPointerDownCapture={() => setOpen(undefined)}
          onKeyDownCapture={(event) => {
            if (event.key === 'Enter' || event.key === ' ') setOpen(undefined);
          }}
        >
          <IconPicker
            key={scopeKey}
            value={firstIcon}
            mixed={mixedIcons}
            compact
            disabled={disabled}
            fieldLabel="Set icon"
            onChange={(icon) => {
              const plan = planBatchIcon(workspace, ids, single || replaceIcons);
              if (!plan.targets.length) {
                onNotice(
                  'Every selected record already has an icon. Enable Replace to change them.',
                );
                return;
              }
              onChange((current) => applyBatchIcon(current, ids, icon, single || replaceIcons));
              onNotice(
                `${icon ? 'Icon set on' : 'Icon cleared on'} ${plan.targets.length} record${
                  plan.targets.length === 1 ? '' : 's'
                }.${plan.preserved ? ` ${plan.preserved} kept an existing icon.` : ''}`,
              );
            }}
          />
        </div>
        {!single && (
          <label className="batch-replace">
            <input
              type="checkbox"
              checked={replaceIcons}
              onChange={(event) => setReplaceIcons(event.target.checked)}
            />
            Replace icons
          </label>
        )}
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
