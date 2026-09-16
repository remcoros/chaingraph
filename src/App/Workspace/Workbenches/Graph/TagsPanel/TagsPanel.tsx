import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Minus, Network, Plus, Tag, Trash2, X } from 'lucide-react';
import {
  addressNodeId,
  type GraphData,
  type GraphNode,
  type Workspace,
  type WorkspaceTag,
} from '../../../../../Domain/types';
import {
  listTagsForNode,
  tagNodeIds,
  tagsFromLabels,
  MAX_TAG_MEMBERS,
  MAX_WORKSPACE_TAGS,
} from '../../../../../Domain/Metadata/tags';
import {
  BatchTagEditor,
  ColorPicker,
  MetadataPopover,
} from '../../../../Controls/Metadata/MetadataEditors';
import { DEFAULT_TAG_COLOR } from '../../../../../Domain/Metadata/tagColors';
import './tags.css';
import { applyBatchTag } from '../../../../../Domain/Metadata/batchMetadata';
import { canonicalAddress } from '../../../../../Domain/Metadata/entityReferences';
import { Modal } from '../../../../Dialogs';
import { useDialogFocus } from '../../../../Controls/useDialogFocus';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';

type Change = (update: (workspace: Workspace) => Workspace) => void;
type TagValue = { name: string; color: string; description: string };

function TagForm({
  tag,
  onSave,
  onClose,
  onDelete,
}: {
  tag?: WorkspaceTag;
  onSave: (value: TagValue) => string | undefined;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? DEFAULT_TAG_COLOR);
  const [description, setDescription] = useState(tag?.description ?? '');
  const [error, setError] = useState('');
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const save = (value: TagValue) => {
    const issue = onSave(value);
    setError(issue ?? '');
    return !issue;
  };
  return (
    <form
      className="tag-form"
      noValidate
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (save({ name: name.trim(), color, description: tag ? description : description.trim() }))
          onClose();
        else input.current?.focus();
      }}
    >
      <label>
        Tag name
        <input
          ref={input}
          aria-label="Tag name"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          maxLength={100}
          required
          value={name}
          placeholder="Exchange, shop, savings…"
          onChange={(event) => {
            setName(event.target.value);
            if (tag) save({ name: event.target.value.trim(), color, description });
            else setError('');
          }}
        />
      </label>
      {error && (
        <p id={errorId} role="alert" className="tag-error">
          {error}
        </p>
      )}
      <div className="tag-color-field">
        <span>Color</span>
        <ColorPicker
          value={color}
          onChange={(next) => {
            setColor(next);
            if (tag) save({ name: name.trim(), color: next, description });
          }}
        />
      </div>
      <label>
        Description <span className="tag-optional">Optional</span>
        <textarea
          aria-label="Tag description"
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            if (tag) save({ name: name.trim(), color, description: event.target.value });
          }}
        />
      </label>
      {tag && <p className="small muted">Changes apply automatically.</p>}
      <div className="tag-form-actions">
        {onDelete && (
          <button
            type="button"
            className="text-button danger tag-delete-trigger"
            onClick={onDelete}
          >
            <Trash2 size={13} aria-hidden="true" /> Delete tag…
          </button>
        )}
        {!tag && (
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        )}
        <button className={tag ? undefined : 'primary'} type="submit">
          {tag ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
          {tag ? 'Done' : 'Create tag'}
        </button>
      </div>
    </form>
  );
}
export function SelectedTags({
  workspace,
  selected,
  onChange,
  onManage,
  openToken,
  onOpenHandled,
}: {
  workspace: Workspace;
  selected: GraphNode;
  onChange: Change;
  onManage: () => void;
  openToken?: number;
  onOpenHandled?: () => void;
}) {
  const effective = listTagsForNode(workspace, selected);
  const [open, setOpen] = useState(false);
  const [removal, setRemoval] = useState<{ tag: WorkspaceTag; anchor: HTMLElement } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [triggerAnchor, setTriggerAnchor] = useState<HTMLButtonElement | null>(null);
  const handleOpenHandled = useEffectEvent(() => onOpenHandled?.());
  // Adjusting during render rather than in an effect: a picker and a pending
  // removal belong to one entity in one workspace, so they close in the same
  // pass that moves to another rather than a frame later.
  const subject = `${workspace.id}:${selected.id}`;
  const [shownSubject, setShownSubject] = useState(subject);
  if (shownSubject !== subject) {
    setShownSubject(subject);
    setOpen(false);
    setRemoval(null);
  }
  useEffect(() => {
    if (!openToken) return;
    const currentTrigger = trigger.current;
    currentTrigger?.focus();
    setTriggerAnchor(currentTrigger);
    setOpen(true);
    handleOpenHandled();
  }, [openToken]);
  const id = useId();
  return (
    <section className="selected-tags" aria-label="Tags">
      <div className="selected-tags-heading">
        <span>Tags</span>
        <button
          ref={trigger}
          type="button"
          className="selected-tag-add"
          aria-label="Add or choose tags"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={(event) => {
            setTriggerAnchor(event.currentTarget);
            setOpen((current) => !current);
          }}
        >
          <Plus size={13} /> Add
        </button>
      </div>
      {effective.length > 0 && (
        <div className="selected-tag-chips">
          {effective.map((tag) => (
            <span key={tag.id} className="selected-tag-chip">
              <button
                type="button"
                className="selected-tag-edit"
                title={tag.name}
                aria-label={`Edit assignment for ${tag.name}`}
                onClick={() => {
                  const currentTrigger = trigger.current;
                  currentTrigger?.focus();
                  setTriggerAnchor(currentTrigger);
                  setOpen(true);
                }}
              >
                <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                <span>{tag.name}</span>
              </button>
              <button
                type="button"
                className="selected-tag-remove"
                title={`Remove ${tag.name} from selection`}
                aria-label={`Remove ${tag.name} from selection`}
                onClick={(event) => {
                  const addressId = selected.address
                    ? addressNodeId(canonicalAddress(selected.address))
                    : undefined;
                  if (
                    selected.kind !== 'transaction' &&
                    addressId &&
                    tag.nodeIds.includes(addressId)
                  ) {
                    setRemoval({ tag, anchor: event.currentTarget });
                  } else {
                    onChange((current) => applyBatchTag(current, [selected.id], tag.id, false));
                    trigger.current?.focus();
                  }
                }}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {open && triggerAnchor && (
        <TagAssignmentPicker
          key={selected.id}
          id={id}
          anchor={triggerAnchor}
          workspace={workspace}
          selected={selected}
          onChange={onChange}
          onClose={() => setOpen(false)}
          onManage={() => {
            setOpen(false);
            onManage();
          }}
        />
      )}
      {removal && (
        <MetadataPopover anchor={removal.anchor} onClose={() => setRemoval(null)}>
          <RemoveAddressTag
            tag={removal.tag}
            onClose={() => setRemoval(null)}
            onRemove={() => {
              const ids = [selected.id, addressNodeId(canonicalAddress(selected.address!))];
              onChange((current) => applyBatchTag(current, ids, removal.tag.id, false));
              trigger.current?.focus();
              setRemoval(null);
            }}
          />
        </MetadataPopover>
      )}
    </section>
  );
}

function RemoveAddressTag({
  tag,
  onClose,
  onRemove,
}: {
  tag: WorkspaceTag;
  onClose: () => void;
  onRemove: () => void;
}) {
  const ref = useDialogFocus(onClose, undefined, false);
  return (
    <div
      ref={ref}
      className="metadata-editor compact-controls"
      role="dialog"
      aria-modal="false"
      aria-label="Remove address tag"
    >
      <strong>Remove {tag.name}?</strong>
      <p>
        This tag is applied to the address. Removing it also affects the address’s other outputs.
      </p>
      <div className="button-row">
        <button type="button" data-autofocus onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={onRemove}>
          <Minus size={13} /> Remove from address + outputs
        </button>
      </div>
    </div>
  );
}

function TagAssignmentPicker({
  id,
  anchor,
  workspace,
  selected,
  onChange,
  onClose,
  onManage,
}: {
  id: string;
  anchor: HTMLElement;
  workspace: Workspace;
  selected: GraphNode;
  onChange: Change;
  onClose: () => void;
  onManage: () => void;
}) {
  const [scope, setScope] = useState<'node' | 'address'>('node');
  const effective = listTagsForNode(workspace, selected);
  const target =
    scope === 'address' && selected.address ? addressNodeId(selected.address) : selected.id;
  return (
    <MetadataPopover anchor={anchor} compact onClose={onClose}>
      <BatchTagEditor
        id={id}
        workspace={workspace}
        ids={[target]}
        single
        onClose={onClose}
        onApply={(_summary, update) => onChange(update)}
        membershipHint={(tag) => {
          const viaAddress =
            selected.kind === 'output' &&
            selected.address &&
            tag.nodeIds.includes(addressNodeId(selected.address));
          const viaOutput = selected.kind === 'output' && tag.nodeIds.includes(selected.id);
          return scope === 'node' && viaAddress ? (
            <small>Applied to address too</small>
          ) : scope === 'address' && viaOutput ? (
            <small>Applied to this output too</small>
          ) : !tag.nodeIds.includes(target) && effective.some((item) => item.id === tag.id) ? (
            <small>Applied through a related entity</small>
          ) : null;
        }}
        footer={
          <div className="metadata-editor-footer">
            <button type="button" onClick={onManage}>
              <Tag size={13} /> Manage tags
            </button>
          </div>
        }
      >
        {selected.kind === 'output' && selected.address && (
          <div className="tag-scope" role="group" aria-label="Tag assignment scope">
            <button type="button" aria-pressed={scope === 'node'} onClick={() => setScope('node')}>
              This output
            </button>
            <button
              type="button"
              aria-pressed={scope === 'address'}
              onClick={() => setScope('address')}
            >
              Address + outputs
            </button>
          </div>
        )}
      </BatchTagEditor>
    </MetadataPopover>
  );
}

function TagDescription({ description }: { description: string }) {
  return (
    <details className="tag-description">
      <summary title="Expand or collapse description">
        <span>{description}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
    </details>
  );
}

function TagMembers({
  tag,
  workspace,
  loadedIds,
  onChange,
  onSelect,
}: {
  tag: WorkspaceTag;
  workspace: Workspace;
  loadedIds: Set<string>;
  onChange: Change;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const summary = useRef<HTMLElement>(null);
  const pages = Math.max(1, Math.ceil(tag.nodeIds.length / 25));
  const activePage = Math.min(page, pages - 1);
  return (
    <details
      className="tag-members-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={summary}>
        <span>
          Members <span className="muted">({tag.nodeIds.length})</span>
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      {open && (
        <>
          <ul className="tag-members" aria-label={`Members of ${tag.name}`}>
            {tag.nodeIds.slice(activePage * 25, (activePage + 1) * 25).map((id) => (
              <li key={id}>
                <div className="tag-member-identity">
                  <button
                    className="text-button"
                    disabled={!loadedIds.has(id)}
                    title={id}
                    aria-label={`Inspect ${workspace.annotations[id]?.label || id}`}
                    onClick={() => onSelect(id)}
                  >
                    {workspace.annotations[id]?.label || (
                      <code>
                        <ResponsiveIdentifier value={id} />
                      </code>
                    )}
                  </button>
                  <small>
                    {workspace.annotations[id]?.label && (
                      <>
                        <code title={id}>
                          <ResponsiveIdentifier value={id} />
                        </code>{' '}
                        ·{' '}
                      </>
                    )}
                    {id.startsWith('tx:')
                      ? 'Transaction'
                      : id.startsWith('out:')
                        ? 'Output'
                        : 'Address'}
                    {!loadedIds.has(id) && ' · Unavailable in graph'}
                  </small>
                </div>
                <button
                  className="icon-button"
                  title={`Remove ${id} from ${tag.name}`}
                  aria-label={`Remove ${id} from ${tag.name}`}
                  onClick={() => {
                    onChange((current) => applyBatchTag(current, [id], tag.id, false));
                    summary.current?.focus();
                  }}
                >
                  <Minus size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {!tag.nodeIds.length && (
            <p className="small muted">
              No members. Select an entity, then choose Add to selection.
            </p>
          )}
          {tag.nodeIds.some((id) => id.startsWith('addr:')) && (
            <p className="small muted">
              Address members also tag their outputs. Removing an address removes that inherited
              tag.
            </p>
          )}
          {pages > 1 && (
            <nav className="tag-pagination" aria-label={`Members of ${tag.name}`}>
              <button
                aria-label={`Previous members of ${tag.name}`}
                disabled={!activePage}
                onClick={() => setPage(activePage - 1)}
              >
                Previous
              </button>
              <span role="status">
                {activePage + 1} / {pages}
              </span>
              <button
                aria-label={`Next members of ${tag.name}`}
                disabled={activePage + 1 >= pages}
                onClick={() => setPage(activePage + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </details>
  );
}

export default function TagsPanel({
  workspace,
  graph,
  selected,
  selectedIds,
  onChange,
  onShow,
  onSelect,
}: {
  workspace: Workspace;
  graph: GraphData;
  selected?: GraphNode;
  selectedIds?: readonly string[];
  onChange: Change;
  onShow: (tag: WorkspaceTag) => void;
  onSelect: (id: string) => void;
}) {
  const loadedIds = useMemo(() => new Set(graph.nodes.map((node) => node.id)), [graph]);
  const selectedId = selected?.id;
  const targetIds = useMemo(
    () => [...new Set(selectedIds?.length ? selectedIds : selectedId ? [selectedId] : [])],
    [selectedIds, selectedId],
  );
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [actionError, setActionError] = useState<{ id: string; message: string }>();
  const [importStatus, setImportStatus] = useState('');
  const newButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (returnFocus.current) {
      (returnFocus.current.isConnected ? returnFocus.current : search.current)?.focus();
      returnFocus.current = null;
    }
  }, [editing, creating]);
  const tags = workspace.tags ?? [];
  const visibleTags = tags.filter(
    (tag) =>
      tag.id === editing ||
      `${tag.name} ${tag.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const deletion = tags.find((tag) => tag.id === deleting);
  const closeEditor = () => {
    returnFocus.current = editing
      ? (editButtons.current.get(editing) ?? search.current)
      : newButton.current;
    setCreating(false);
    setEditing(undefined);
  };
  const save = (value: TagValue, id?: string): string | undefined => {
    if (!value.name.trim()) return 'Enter a tag name.';
    if (!id && tags.length >= MAX_WORKSPACE_TAGS)
      return 'Tag limit reached. Delete a tag before creating another.';
    if (
      !id &&
      tags.reduce((total, tag) => total + tag.nodeIds.length, 0) + targetIds.length >
        MAX_TAG_MEMBERS
    )
      return 'Member limit reached. Remove a tag assignment before adding another.';
    if (tags.some((tag) => tag.id !== id && tag.name.toLowerCase() === value.name.toLowerCase()))
      return 'A tag with this name already exists.';
    const existing = tags.find((tag) => tag.id === id);
    if (
      existing &&
      existing.name === value.name &&
      existing.color === value.color &&
      (existing.description ?? '') === value.description
    )
      return;
    onChange((current) => ({
      ...current,
      tags: id
        ? (current.tags ?? []).map((tag) => (tag.id === id ? { ...tag, ...value } : tag))
        : [...(current.tags ?? []), { ...value, id: crypto.randomUUID(), nodeIds: targetIds }],
    }));
    if (!id) setQuery('');
  };
  return (
    <div className="tags-panel compact-controls">
      <div className="panel-section tags-toolbar">
        <div className="tags-heading">
          <h2 className="panel-title">Workspace tags</h2>
          <button
            ref={newButton}
            aria-label="New tag"
            aria-expanded={creating}
            disabled={creating}
            onClick={() => {
              setCreating(true);
              setEditing(undefined);
              setActionError(undefined);
            }}
          >
            <Plus size={13} aria-hidden="true" /> New tag
          </button>
        </div>
        <div className="tags-search">
          <input
            ref={search}
            type="search"
            aria-label="Search tags"
            placeholder="Search tags…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear tag search"
              title="Clear tag search"
              onClick={() => {
                setQuery('');
                search.current?.focus();
              }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="tag-result-count" role="status">
          {query.trim()
            ? `${visibleTags.length} of ${tags.length} tags`
            : `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
        </p>
      </div>
      {creating && (
        <section className="panel-section tag-create" aria-label="New tag">
          <h3>New tag</h3>
          {targetIds.length > 0 && (
            <p className="small muted">
              Includes {targetIds.length} selected {targetIds.length === 1 ? 'entity' : 'entities'}.
            </p>
          )}
          <TagForm onSave={(value) => save(value)} onClose={closeEditor} />
        </section>
      )}
      <details className="panel-section tags-label-import">
        <summary>
          <span>Group existing labels</span>
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <p className="small muted">
          Create a tag for each distinct label. Existing tags, labels and notes stay unchanged.
        </p>
        <button
          onClick={() => {
            try {
              const proposals = tagsFromLabels(workspace);
              if (!proposals.length) {
                setImportStatus('No new tags to create from labels.');
                setActionError(undefined);
                return;
              }
              onChange((current) => ({
                ...current,
                tags: [...(current.tags ?? []), ...proposals],
              }));
              setImportStatus(
                `Created ${proposals.length} ${proposals.length === 1 ? 'tag' : 'tags'}.`,
              );
              setActionError(undefined);
              setQuery('');
            } catch {
              setImportStatus('');
              setActionError({
                id: 'import',
                message:
                  'Tag or member limit reached. Create tags individually or remove unused assignments, then try again.',
              });
            }
          }}
        >
          Create tags from labels
        </button>
        {importStatus && (
          <p role="status" className="small muted">
            {importStatus}
          </p>
        )}
        {actionError?.id === 'import' && (
          <p role="alert" className="tag-error">
            {actionError.message}
          </p>
        )}
      </details>
      <div className="tag-list">
        {visibleTags.map((tag) => {
          const ids = tagNodeIds(tag, graph);
          const members = new Set(tag.nodeIds);
          const assigned = targetIds.length > 0 && targetIds.every((id) => members.has(id));
          return (
            <article className="tag-card panel-section" key={tag.id}>
              <div className="tags-heading">
                <h3>
                  <span
                    className="tag-dot"
                    style={{ backgroundColor: tag.color }}
                    aria-hidden="true"
                  />
                  {tag.name}
                </h3>
                <button
                  ref={(button) => {
                    if (button) editButtons.current.set(tag.id, button);
                    else editButtons.current.delete(tag.id);
                  }}
                  className="text-button"
                  aria-label={`Edit tag ${tag.name}`}
                  aria-expanded={editing === tag.id}
                  disabled={creating}
                  onClick={() => {
                    if (editing === tag.id) closeEditor();
                    else {
                      setEditing(tag.id);
                      setActionError(undefined);
                    }
                  }}
                >
                  Edit
                </button>
              </div>
              {editing === tag.id ? (
                <TagForm
                  tag={tag}
                  onSave={(value) => save(value, tag.id)}
                  onClose={closeEditor}
                  onDelete={() => setDeleting(tag.id)}
                />
              ) : (
                <>
                  {tag.description && <TagDescription description={tag.description} />}
                  <p className="tag-count">
                    {ids.length} loaded {ids.length === 1 ? 'entity' : 'entities'}
                  </p>
                  <div className="tag-card-actions">
                    <button
                      disabled={!ids.length}
                      title="Show on graph"
                      onClick={() => onShow(tag)}
                    >
                      <Network size={14} aria-hidden="true" /> Show
                    </button>
                    {targetIds.length > 0 && (
                      <button
                        disabled={assigned}
                        title={
                          assigned
                            ? 'Already assigned to every selected entity'
                            : `Add tag to ${targetIds.length} selected ${targetIds.length === 1 ? 'entity' : 'entities'}`
                        }
                        onClick={() => {
                          try {
                            applyBatchTag(workspace, targetIds, tag.id, true);
                            onChange((current) => applyBatchTag(current, targetIds, tag.id, true));
                            setActionError(undefined);
                          } catch {
                            setActionError({
                              id: tag.id,
                              message:
                                'Could not add selection. Check the tag member limit and try again.',
                            });
                          }
                        }}
                      >
                        {assigned ? (
                          <>
                            <Check size={13} aria-hidden="true" /> Assigned ({targetIds.length})
                          </>
                        ) : (
                          <>
                            <Plus size={13} aria-hidden="true" /> Add to selection (
                            {targetIds.length})
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  {actionError?.id === tag.id && (
                    <p role="alert" className="tag-error">
                      {actionError.message}
                    </p>
                  )}
                  <TagMembers
                    tag={tag}
                    workspace={workspace}
                    loadedIds={loadedIds}
                    onChange={onChange}
                    onSelect={onSelect}
                  />
                </>
              )}
            </article>
          );
        })}
      </div>
      {!tags.length && !creating && (
        <div className="panel-section tag-empty">
          <Tag size={20} aria-hidden="true" />
          <h3>No tags yet</h3>
          <p>Create a tag to group transactions, outputs or addresses.</p>
        </div>
      )}
      {!!tags.length && !visibleTags.length && (
        <div className="panel-section tag-empty">
          <h3>No matching tags</h3>
          <p>Search by name or description.</p>
          <button
            onClick={() => {
              setQuery('');
              search.current?.focus();
            }}
          >
            Clear search
          </button>
        </div>
      )}
      {deletion && (
        <Modal
          title={`Delete ${deletion.name}?`}
          className="tag-delete-dialog compact-controls"
          fallbackFocusSelector=".tags-panel input[type='search']"
          onClose={() => setDeleting(undefined)}
        >
          <p>
            All tag assignments will be removed. Entities, labels and notes stay in the workspace.
          </p>
          <div className="tag-form-actions">
            <button data-autofocus onClick={() => setDeleting(undefined)}>
              Cancel
            </button>
            <button
              className="danger"
              onClick={() => {
                onChange((current) => ({
                  ...current,
                  tags: (current.tags ?? []).filter((tag) => tag.id !== deletion.id),
                }));
                setDeleting(undefined);
                setEditing(undefined);
              }}
            >
              <Trash2 size={13} aria-hidden="true" /> Delete tag
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
