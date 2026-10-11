import { useId, useState, type ReactNode } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
  EntityLabelEditor,
  EntityNoteEditor,
  EntityTagEditor,
  MetadataPopover,
} from '../../../Controls/Metadata/MetadataEditors';
import { IconPalette } from '../../../Controls/Metadata/IconPicker';
import { ICON_PALETTE } from '../../../Controls/Metadata/iconOptions';
import { applyBatchIcon } from '../../../../Core/Workspace/Annotations/batchMetadata';
import type { WalletWorkbenchContext } from './walletWorkbenchContext';

type MetadataProps = Pick<WalletWorkbenchContext, 'workspace' | 'onChange' | 'active'> & {
  id: string;
  disabled?: boolean;
  onNotice: (message: string) => void;
};

/** One field owns its editor; values stay in the existing annotation collection. */
function MetadataField({
  field,
  label,
  value,
  review,
  ...props
}: MetadataProps & {
  field: 'label' | 'note' | 'tags';
  label: string;
  value?: ReactNode;
  review?: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement>();
  const [subject, setSubject] = useState(props.id);
  if (subject !== props.id) {
    setSubject(props.id);
    if (anchor) setAnchor(undefined);
  } else if (anchor && !props.active) setAnchor(undefined);
  const action = `Edit ${label.toLowerCase()}`;
  return (
    <div className={`wallet-inline-field wallet-inline-${field}`}>
      <dt>{label}</dt>
      <dd>
        <button
          className={`wallet-field-value${value ? '' : ' is-empty'}`}
          disabled={props.disabled}
          aria-label={action}
          title={action}
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          {!value && <Plus className="wallet-field-add-icon" size={14} aria-hidden="true" />}
          <span className="wallet-field-text">
            {value || (field === 'tags' ? 'Add tags…' : `Add a ${label.toLowerCase()}…`)}
          </span>
          {value && <Pencil className="wallet-field-edit-icon" size={14} aria-hidden="true" />}
        </button>
        {review}
        {anchor && (
          <MetadataPopover
            anchor={anchor}
            compact={field === 'tags'}
            onClose={() => setAnchor(undefined)}
          >
            {field === 'note' ? (
              <EntityNoteEditor
                workspace={props.workspace}
                id={props.id}
                onChange={props.onChange}
                onClose={() => setAnchor(undefined)}
              />
            ) : field === 'label' ? (
              <EntityLabelEditor
                workspace={props.workspace}
                entityId={props.id}
                onClose={() => setAnchor(undefined)}
                onApply={(message, update) => {
                  props.onChange(update);
                  props.onNotice(message);
                }}
              />
            ) : (
              <EntityTagEditor
                workspace={props.workspace}
                entityId={props.id}
                onClose={() => setAnchor(undefined)}
                onApply={(message, update) => {
                  props.onChange(update);
                  props.onNotice(message);
                }}
              />
            )}
          </MetadataPopover>
        )}
      </dd>
    </div>
  );
}

/** Shared reading layout for a record's editable label, associations, tags and note. */
export function WalletMetadataFields({
  label = 'Label',
  children,
  facts,
  reviews,
  ...props
}: MetadataProps & {
  label?: string;
  children?: ReactNode;
  facts?: ReactNode;
  reviews?: Partial<Record<'label' | 'note' | 'tags', ReactNode>>;
}) {
  const annotation = props.workspace.annotations.entities[props.id];
  const tags = (props.workspace.annotations.tags ?? []).filter((tag) =>
    tag.nodeIds.includes(props.id),
  );
  return (
    <>
      <dl className="wallet-inline-fields compact-controls" aria-label="Your information">
        <MetadataField
          {...props}
          field="label"
          label={label}
          value={annotation?.label}
          review={reviews?.label}
        />
        {children}
        <MetadataField
          {...props}
          field="tags"
          label="Tags"
          review={reviews?.tags}
          value={
            tags.length
              ? tags.map((tag) => (
                  <span className="wallet-inline-tag" key={tag.id}>
                    <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </span>
                ))
              : undefined
          }
        />
      </dl>
      {facts}
      <dl className="wallet-inline-fields wallet-detail-note compact-controls" aria-label="Note">
        <MetadataField
          {...props}
          field="note"
          label="Note"
          value={annotation?.note}
          review={reviews?.note}
        />
      </dl>
    </>
  );
}

/** The custom record icon is editable; transaction direction stays a chain fact. */
export function WalletIconEdit({
  workspace,
  id,
  onChange,
  disabled,
  active,
}: Omit<MetadataProps, 'onNotice'>) {
  const [anchor, setAnchor] = useState<HTMLButtonElement>();
  const [subject, setSubject] = useState(id);
  if (subject !== id) {
    setSubject(id);
    if (anchor) setAnchor(undefined);
  } else if (anchor && !active) setAnchor(undefined);
  const paletteId = useId();
  const icon = workspace.annotations.entities[id]?.icon ?? '';
  const name =
    ICON_PALETTE.find(([value]) => value === icon)?.[1] ?? (icon ? 'Imported icon' : 'None');
  return (
    <>
      <button
        className="wallet-inline-edit wallet-detail-icon-edit"
        aria-label={`Set icon: ${name}`}
        title={`Set icon: ${name}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <span aria-hidden="true">{icon || '∅'}</span>
      </button>
      {anchor && (
        <MetadataPopover anchor={anchor} compact onClose={() => setAnchor(undefined)}>
          <IconPalette
            id={paletteId}
            value={icon}
            onClose={() => setAnchor(undefined)}
            onChange={(value) => onChange((current) => applyBatchIcon(current, [id], value, true))}
          />
        </MetadataPopover>
      )}
    </>
  );
}
