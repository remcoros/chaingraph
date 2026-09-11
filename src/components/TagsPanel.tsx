import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Minus, Plus, Tag, Trash2, X } from 'lucide-react';
import {
  addressNodeId,
  short,
  type GraphData,
  type GraphNode,
  type Workspace,
  type WorkspaceTag,
} from '../domain/types';
import {
  listTagsForNode,
  tagNodeIds,
  tagsFromLabels,
  MAX_TAG_MEMBERS,
  MAX_WORKSPACE_TAGS,
} from '../domain/tags';
import {
  BatchTagEditor,
  ColorPicker,
  MetadataPopover,
  TAG_COLORS as colors,
} from './MetadataEditors';
import './tags.css';
import { applyBatchTag } from '../domain/batchMetadata';
import { canonicalAddress } from '../domain/entityReferences';
import { useDialogFocus } from './Dialogs';

type Change = (update: (workspace: Workspace) => Workspace) => void;
function TagForm({
  tag,
  onSave,
  onCancel,
}: {
  tag?: WorkspaceTag;
  onSave: (value: { name: string; color: string; description: string }) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? colors[0]);
  const [description, setDescription] = useState(tag?.description ?? '');
  return (
    <form
      className="tag-form compact-controls"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tag && name.trim())
          onSave({ name: name.trim(), color, description: description.trim() });
      }}
    >
      <label>
        Tag name
        <input
          aria-label="Tag name"
          maxLength={100}
          required
          value={name}
          placeholder="Exchange, shop, savings…"
          onChange={(event) => {
            setName(event.target.value);
            if (tag) onSave({ name: event.target.value.trim(), color, description });
          }}
        />
      </label>
      <ColorPicker
        value={color}
        onChange={(next) => {
          setColor(next);
          if (tag) onSave({ name: name.trim(), color: next, description });
        }}
      />
      <label>
        Description
        <textarea
          aria-label="Tag description"
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            if (tag) onSave({ name: name.trim(), color, description: event.target.value });
          }}
        />
      </label>
      <div className="tag-form-actions">
        {!tag && (
          <button className="primary" disabled={!name.trim()}>
            <Plus size={13} /> Create tag
          </button>
        )}
        {tag && <span className="small muted">Changes apply automatically</span>}
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {tag ? <Check size={13} /> : <X size={13} />}
            {tag ? 'Done' : 'Cancel'}
          </button>
        )}
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
  useEffect(() => {
    setOpen(false);
    setRemoval(null);
  }, [workspace.id, selected.id]);
  useEffect(() => {
    if (!openToken) return;
    trigger.current?.focus();
    setOpen(true);
    onOpenHandled?.();
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
          onClick={() => setOpen((current) => !current)}
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
                  trigger.current?.focus();
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
      {open && trigger.current && (
        <TagAssignmentPicker
          key={selected.id}
          id={id}
          anchor={trigger.current}
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
    <MetadataPopover anchor={anchor} onClose={onClose}>
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
  const pages = Math.max(1, Math.ceil(tag.nodeIds.length / 25));
  const activePage = Math.min(page, pages - 1);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Members</summary>
      {open && (
        <>
          <div className="tag-members">
            {tag.nodeIds.slice(activePage * 25, (activePage + 1) * 25).map((id) => (
              <div key={id}>
                <button
                  className="text-button"
                  disabled={!loadedIds.has(id)}
                  title={id}
                  onClick={() => onSelect(id)}
                >
                  {workspace.annotations[id]?.label || short(id)}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove ${id} from ${tag.name}`}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      tags: (current.tags ?? []).map((item) =>
                        item.id === tag.id
                          ? {
                              ...item,
                              nodeIds: item.nodeIds.filter((member) => member !== id),
                            }
                          : item,
                      ),
                    }))
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          {!tag.nodeIds.length && <p className="small muted">No assigned entities yet.</p>}
          {pages > 1 && (
            <div className="tag-form-actions">
              <button
                aria-label={`Previous members of ${tag.name}`}
                disabled={!activePage}
                onClick={() => setPage(activePage - 1)}
              >
                Previous
              </button>
              <span className="small">
                {activePage + 1} / {pages}
              </span>
              <button
                aria-label={`Next members of ${tag.name}`}
                disabled={activePage + 1 >= pages}
                onClick={() => setPage(activePage + 1)}
              >
                Next
              </button>
            </div>
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
  onChange,
  onShow,
  onSelect,
}: {
  workspace: Workspace;
  graph: GraphData;
  selected?: GraphNode;
  onChange: Change;
  onShow: (tag: WorkspaceTag) => void;
  onSelect: (id: string) => void;
}) {
  const loadedIds = useMemo(() => new Set(graph.nodes.map((node) => node.id)), [graph]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState('');
  const tags = workspace.tags ?? [];
  const save = (value: { name: string; color: string; description: string }, id?: string) => {
    if (!value.name.trim()) {
      setError('Tag name cannot be empty. The previous name is kept.');
      return;
    }
    if (!id && tags.length >= MAX_WORKSPACE_TAGS) {
      setError('Workspace supports at most 200 tags.');
      return;
    }
    if (
      !id &&
      selected &&
      tags.reduce((total, tag) => total + tag.nodeIds.length, 0) >= MAX_TAG_MEMBERS
    ) {
      setError('Workspace has reached the 50,000 tag membership limit.');
      return;
    }
    if (tags.some((tag) => tag.id !== id && tag.name.toLowerCase() === value.name.toLowerCase())) {
      setError('A tag with this name already exists.');
      return;
    }
    onChange((current) => ({
      ...current,
      tags: id
        ? (current.tags ?? []).map((tag) => (tag.id === id ? { ...tag, ...value } : tag))
        : [
            ...(current.tags ?? []),
            { ...value, id: crypto.randomUUID(), nodeIds: selected ? [selected.id] : [] },
          ],
    }));
    if (!id) setCreating(false);
    setError('');
  };
  return (
    <div className="tags-panel">
      <div className="tags-heading">
        <h2 className="panel-title">Workspace tags</h2>
        <button
          className="icon-button"
          aria-label="New tag"
          disabled={tags.length >= 200}
          onClick={() => {
            setCreating(true);
            setEditing(undefined);
          }}
        >
          <Plus size={16} />
        </button>
      </div>
      <p className="small muted">
        Group related transactions, outputs and addresses. Labels and notes stay independent.
      </p>
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      {creating && (
        <>
          <p className="small muted">
            {selected
              ? `Includes the selected ${selected.kind}.`
              : 'Create a group, then add a graph selection.'}
          </p>
          <TagForm onSave={(value) => save(value)} onCancel={() => setCreating(false)} />
        </>
      )}
      <input
        type="search"
        aria-label="Search tags"
        placeholder="Find a tag…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <details className="tags-label-import">
        <summary>Group existing labels</summary>
        <p className="small muted">
          Create groups from matching nonempty labels, including imported BIP329 labels. Review them
          here before treating them as known entities.
        </p>
        <button
          disabled={
            tags.length >= 200 ||
            !Object.values(workspace.annotations).some((annotation) => annotation.label.trim())
          }
          onClick={() => {
            try {
              const proposals = tagsFromLabels(workspace);
              if (!proposals.length) {
                setError('No new label groups to create.');
                return;
              }
              if (tags.length + proposals.length > 200) {
                setError('Too many label groups. Create selected tags individually.');
                return;
              }
              onChange((current) => ({
                ...current,
                tags: [...(current.tags ?? []), ...proposals],
              }));
              setError('');
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not group labels.');
            }
          }}
        >
          Create tags from labels
        </button>
      </details>
      <div className="tag-list">
        {tags
          .filter((tag) =>
            `${tag.name} ${tag.description ?? ''}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((tag) => {
            const ids = tagNodeIds(tag, graph);
            return (
              <article className="tag-card" key={tag.id}>
                <div className="tags-heading">
                  <h4>
                    <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </h4>
                  <button
                    className="text-button"
                    aria-label={`Edit tag ${tag.name}`}
                    onClick={() => {
                      setEditing(editing === tag.id ? undefined : tag.id);
                      setCreating(false);
                    }}
                  >
                    Edit
                  </button>
                </div>
                {editing === tag.id ? (
                  <TagForm
                    key={tag.id}
                    tag={tag}
                    onSave={(value) => save(value, tag.id)}
                    onCancel={() => {
                      setEditing(undefined);
                      setError('');
                    }}
                  />
                ) : (
                  <>
                    {tag.description && <p className="small">{tag.description}</p>}
                    <p className="small muted">
                      {ids.length} loaded {ids.length === 1 ? 'entity' : 'entities'} ·{' '}
                      {tag.nodeIds.length} assigned{' '}
                      {tag.nodeIds.length === 1 ? 'reference' : 'references'}
                    </p>
                    <div className="tag-form-actions tag-card-actions">
                      <button disabled={!ids.length} onClick={() => onShow(tag)}>
                        Show on graph
                      </button>
                      <button
                        disabled={!selected || tag.nodeIds.includes(selected.id)}
                        onClick={() =>
                          selected &&
                          onChange((current) => ({
                            ...current,
                            tags: (current.tags ?? []).map((item) =>
                              item.id === tag.id
                                ? { ...item, nodeIds: [...new Set([...item.nodeIds, selected.id])] }
                                : item,
                            ),
                          }))
                        }
                      >
                        Add selection
                      </button>
                    </div>
                    <TagMembers
                      tag={tag}
                      workspace={workspace}
                      loadedIds={loadedIds}
                      onChange={onChange}
                      onSelect={onSelect}
                    />
                    {deleting === tag.id ? (
                      <div className="tag-form-actions">
                        <button
                          className="danger"
                          onClick={() => {
                            onChange((current) => ({
                              ...current,
                              tags: (current.tags ?? []).filter((item) => item.id !== tag.id),
                            }));
                            setDeleting(undefined);
                          }}
                        >
                          Delete tag
                        </button>
                        <button onClick={() => setDeleting(undefined)}>Keep tag</button>
                      </div>
                    ) : (
                      <button className="text-button" onClick={() => setDeleting(tag.id)}>
                        Remove tag…
                      </button>
                    )}
                  </>
                )}
              </article>
            );
          })}
      </div>
      {!tags.length && !creating && (
        <div className="empty-panel">
          <Tag size={24} />
          <h3>Keep track of counterparties</h3>
          <p>
            Create tags such as Exchange or Shop, then apply them from any selected transaction,
            output or address.
          </p>
          <button onClick={() => setCreating(true)}>Create your first tag</button>
        </div>
      )}
    </div>
  );
}
