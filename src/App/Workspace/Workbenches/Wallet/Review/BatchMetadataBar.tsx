import { useState, type ComponentType, type ReactNode } from 'react';
import { Tag, TextCursorInput } from 'lucide-react';
import { IconPicker } from '../../../../Controls/Metadata/IconPicker';
import {
  BatchLabelEditor,
  EntityLabelEditor,
  BatchTagEditor,
  EntityNoteEditor,
  MetadataPopover,
  type MetadataEditorProps,
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

/** A single entity always replaces its own metadata and can edit notes. */
export function SingleMetadataBar({
  id,
  scopeLabel = '',
  ...props
}: MetadataBarProps & { id: string; scopeLabel?: string }) {
  return (
    <MetadataBar
      {...props}
      ids={[id]}
      scope={scopeLabel}
      className="single-metadata-bar"
      groupLabel="Edit entity metadata"
      LabelEditor={SingleLabelForBar}
      noteId={id}
      replaceIcons
    />
  );
}

/** The private frame receives one ID only from SingleMetadataBar. */
function SingleLabelForBar({ ids, ...props }: MetadataEditorProps) {
  return <EntityLabelEditor {...props} entityId={ids[0]} />;
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
      className="batch-selection-bar"
      groupLabel="Batch metadata editing"
      LabelEditor={BatchLabelEditor}
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
  className,
  groupLabel,
  LabelEditor,
  noteId,
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
  className: string;
  groupLabel: string;
  LabelEditor: ComponentType<MetadataEditorProps>;
  noteId?: string;
  replaceIcons: boolean;
  replacementControl?: ReactNode;
}) {
  const [openState, setOpen] = useState<'label' | 'tags' | 'notes' | undefined>();
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
  const firstIcon = workspace.annotations.entities[ids[0]]?.icon ?? '';
  const mixedIcons = ids.some(
    (id) => (workspace.annotations.entities[id]?.icon ?? '') !== firstIcon,
  );
  return (
    <div className={`batch-bar ${className}`} role="group" aria-label={groupLabel}>
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
              <LabelEditor
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
        {noteId && (
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
                  id={noteId}
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
