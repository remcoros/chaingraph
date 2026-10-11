import { useState, type ReactNode } from 'react';
import { Tag, TextCursorInput } from 'lucide-react';
import { IconPickerControl } from '../../../../Controls/Metadata/IconPicker';
import {
  BatchLabelEditor,
  BatchTagEditor,
  MetadataPopover,
} from '../../../../Controls/Metadata/MetadataEditors';
import {
  applyBatchIcon,
  planBatchIcon,
} from '../../../../../Core/Workspace/Annotations/batchMetadata';
import type { Workspace } from '../../../../../Core/Workspace/workspace';

interface MetadataBarProps {
  workspace: Workspace;
  active?: boolean;
  disabled?: boolean;
  guidance?: string;
  guidedActions?: readonly ('label' | 'tags')[];
  onChange: (update: (workspace: Workspace) => Workspace, group?: string) => void;
  onNotice: (message: string) => void;
  onClear?: () => void;
}

export interface BatchMetadataBarProps extends MetadataBarProps {
  /** Explicitly selected records. Filters never widen this set. */
  ids: string[];
  scopeLabel: string;
}

/** Direct label, tag and icon editing for a chosen set of records. Each action is
 * one workspace update, so autosave and Undo treat the batch as a single step.
 */
export function BatchMetadataBar(props: BatchMetadataBarProps) {
  const [replaceIcons, setReplaceIcons] = useState(false);
  return (
    <MetadataBar
      {...props}
      scope={
        <>
          <strong>{props.ids.length}</strong> {props.scopeLabel}
        </>
      }
      replaceIcons={replaceIcons}
      replacementControl={
        <label className="batch-replace">
          <input
            type="checkbox"
            checked={replaceIcons}
            onChange={(event) => setReplaceIcons(event.target.checked)}
          />
          Replace icons
        </label>
      }
    />
  );
}

function MetadataBar({
  workspace,
  ids,
  scope,
  replaceIcons,
  replacementControl,
  active = true,
  disabled,
  guidance,
  guidedActions,
  onChange,
  onNotice,
  onClear,
}: MetadataBarProps & {
  ids: string[];
  scope: ReactNode;
  replaceIcons: boolean;
  replacementControl?: ReactNode;
}) {
  const [openState, setOpen] = useState<'label' | 'tags' | 'icon' | undefined>();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const scopeKey = `${workspace.id}:${ids.join('|')}`;
  const [previousScopeKey, setPreviousScopeKey] = useState(scopeKey);
  const iconDisabled = disabled && openState === 'icon';
  const open = active && previousScopeKey === scopeKey && !iconDisabled ? openState : undefined;
  if (previousScopeKey !== scopeKey) {
    setPreviousScopeKey(scopeKey);
    if (openState !== undefined) setOpen(undefined);
  } else if ((!active || iconDisabled) && openState !== undefined) {
    setOpen(undefined);
  }
  if (!active || !ids.length) return null;
  const firstIcon = workspace.annotations.entities[ids[0]]?.icon ?? '';
  const mixedIcons = ids.some(
    (id) => (workspace.annotations.entities[id]?.icon ?? '') !== firstIcon,
  );
  return (
    <div className="batch-bar batch-selection-bar" role="group" aria-label="Batch metadata editing">
      <span className="batch-scope">{scope}</span>
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
        <div className="batch-icon">
          <IconPickerControl
            open={open === 'icon'}
            onOpenChange={(open) => setOpen(open ? 'icon' : undefined)}
            value={firstIcon}
            mixed={mixedIcons}
            compact
            disabled={disabled}
            fieldLabel="Set icon"
            onChange={(icon) => {
              const plan = planBatchIcon(workspace, ids, replaceIcons);
              if (!plan.targets.length) {
                onNotice(
                  'Every selected record already has an icon. Enable Replace to change them.',
                );
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
        </div>
        {replacementControl}
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
