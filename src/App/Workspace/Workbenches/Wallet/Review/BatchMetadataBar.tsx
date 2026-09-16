import { useState } from 'react';
import { Tag, TextCursorInput } from 'lucide-react';
import { IconPicker } from '../../../../Controls/Metadata/IconPicker';
import {
  BatchLabelEditor,
  BatchTagEditor,
  EntityNoteEditor,
  MetadataPopover,
} from '../../../../Controls/Metadata/MetadataEditors';
import { applyBatchIcon, planBatchIcon } from '../../../Annotations/batchMetadata';
import type { Workspace } from '../../../../../Domain/Workspace/workspaceTypes';

export interface BatchMetadataBarProps {
  workspace: Workspace;
  /** Explicitly selected records. Filters never widen this set. */
  ids: string[];
  scopeLabel: string;
  single?: boolean;
  active?: boolean;
  disabled?: boolean;
  guidance?: string;
  guidedActions?: readonly ('label' | 'tags')[];
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
  guidedActions,
  onChange,
  onNotice,
  onClear,
}: BatchMetadataBarProps) {
  const [openState, setOpen] = useState<'label' | 'tags' | 'notes' | undefined>();
  const [replaceIcons, setReplaceIcons] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const scopeKey = `${workspace.id}:${ids.join('|')}`;
  const [previousScopeKey, setPreviousScopeKey] = useState(scopeKey);
  const open = active && previousScopeKey === scopeKey ? openState : undefined;
  if (previousScopeKey !== scopeKey) {
    setPreviousScopeKey(scopeKey);
    if (openState !== undefined) setOpen(undefined);
  } else if (!active && openState !== undefined) {
    setOpen(undefined);
  }
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
            className={guidedActions?.includes('label') ? 'wallet-guided-action' : undefined}
            aria-haspopup="dialog"
            aria-expanded={open === 'label'}
            disabled={disabled}
            onClick={(event) => {
              setTrigger(event.currentTarget);
              setOpen(open === 'label' ? undefined : 'label');
            }}
          >
            <TextCursorInput size={14} /> Label
          </button>
          {open === 'label' && trigger && (
            <MetadataPopover anchor={trigger} onClose={() => setOpen(undefined)}>
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
            className={guidedActions?.includes('tags') ? 'wallet-guided-action' : undefined}
            aria-haspopup="dialog"
            aria-expanded={open === 'tags'}
            disabled={disabled}
            onClick={(event) => {
              setTrigger(event.currentTarget);
              setOpen(open === 'tags' ? undefined : 'tags');
            }}
          >
            <Tag size={14} /> Tags
          </button>
          {open === 'tags' && trigger && (
            <MetadataPopover anchor={trigger} compact onClose={() => setOpen(undefined)}>
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
              aria-haspopup="dialog"
              aria-expanded={open === 'notes'}
              disabled={disabled}
              onClick={(event) => {
                setTrigger(event.currentTarget);
                setOpen(open === 'notes' ? undefined : 'notes');
              }}
            >
              Notes
            </button>
            {open === 'notes' && trigger && (
              <MetadataPopover anchor={trigger} onClose={() => setOpen(undefined)}>
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
