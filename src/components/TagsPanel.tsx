import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Tag, Trash2, X } from 'lucide-react';
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
  buildWalletMatches,
  MAX_TAG_MEMBERS,
  MAX_WORKSPACE_TAGS,
} from '../domain/tags';
import { useDialogFocus } from './Dialogs';
import './tags.css';

type Change = (update: (workspace: Workspace) => Workspace) => void;
const colors = ['#65cbbb', '#e4af67', '#9c9aed', '#e888a5', '#85bce8', '#a4c977'];
function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="tag-colors" role="group" aria-label="Tag color">
      {[...new Set([...colors, value])].map((color, index) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${index + 1}`}
          aria-pressed={value === color}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        >
          {value === color && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}
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
      className="tag-form"
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
            Create tag
          </button>
        )}
        {tag && <span className="small muted">Changes apply automatically</span>}
        {onCancel && (
          <button type="button" onClick={onCancel}>
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
  graph,
  onChange,
  onManage,
  openToken,
  onOpenHandled,
}: {
  workspace: Workspace;
  selected: GraphNode;
  graph: GraphData;
  onChange: Change;
  onManage: () => void;
  openToken?: number;
  onOpenHandled?: () => void;
}) {
  const effective = listTagsForNode(workspace, selected);
  const matches = useMemo(() => buildWalletMatches(workspace, graph), [workspace, graph]);
  const match = matches.get(selected.id);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!openToken) return;
    trigger.current?.focus();
    setOpen(true);
    onOpenHandled?.();
  }, [openToken]);
  const id = useId();
  return (
    <section className="panel-section selected-tags" aria-label="Tags and wallet matches">
      {match && (
        <p className="wallet-match">
          <span className="wallet-match-dot" />
          {match.kind === 'transaction' ? 'Wallet-related transaction' : 'Wallet match'}:{' '}
          {workspace.wallets
            .filter((wallet) => match.walletIds.includes(wallet.id))
            .map((wallet) => wallet.name)
            .join(', ')}
        </p>
      )}
      <div className="selected-tag-chips">
        <Tag size={14} aria-hidden="true" />
        {effective.map((tag) => (
          <button
            type="button"
            key={tag.id}
            className="selected-tag-chip"
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
        ))}
        <button
          ref={trigger}
          type="button"
          className="selected-tag-add"
          aria-label="Add or choose tags"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(true)}
        >
          <Plus size={13} /> Add tag
        </button>
      </div>
      {open &&
        createPortal(
          <TagAssignmentPicker
            id={id}
            anchor={trigger.current!}
            workspace={workspace}
            selected={selected}
            onChange={onChange}
            onClose={() => setOpen(false)}
            onManage={() => {
              setOpen(false);
              onManage();
            }}
          />,
          document.body,
        )}
    </section>
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
  const ref = useDialogFocus(onClose);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState(colors[0]);
  const [scope, setScope] = useState<'node' | 'address'>('node');
  const [error, setError] = useState('');
  const tags = workspace.tags ?? [];
  const effective = listTagsForNode(workspace, selected);
  const target =
    scope === 'address' && selected.address ? addressNodeId(selected.address) : selected.id;
  const name = query.trim();
  const duplicate = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  const memberCount = tags.reduce((total, tag) => total + tag.nodeIds.length, 0);
  const full = memberCount >= MAX_TAG_MEMBERS;
  const [viewport, setViewport] = useState(() => ({
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
    top: window.visualViewport?.offsetTop ?? 0,
    left: window.visualViewport?.offsetLeft ?? 0,
  }));
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, viewport.width - 24);
  const left = Math.max(
    viewport.left + 12,
    Math.min(rect.left, viewport.left + viewport.width - width - 12),
  );
  const top = Math.max(
    viewport.top + 12,
    Math.min(rect.bottom + 6, viewport.top + viewport.height - 440),
  );
  useEffect(() => {
    search.current?.focus();
  }, []);
  useEffect(() => {
    // Keep the search usable when a phone keyboard changes the visible viewport.
    const update = () =>
      setViewport({
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
        top: window.visualViewport?.offsetTop ?? 0,
        left: window.visualViewport?.offsetLeft ?? 0,
      });
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  function assign(tagId: string, checked: boolean) {
    if (checked && full) {
      setError('Workspace has reached the 50,000 tag membership limit.');
      return;
    }
    onChange((current) => ({
      ...current,
      tags: (current.tags ?? []).map((tag) =>
        tag.id === tagId
          ? {
              ...tag,
              nodeIds: checked
                ? [...new Set([...tag.nodeIds, target])]
                : tag.nodeIds.filter((id) => id !== target),
            }
          : tag,
      ),
    }));
    setError('');
  }
  function create() {
    if (!name) return;
    if (duplicate) {
      if (!duplicate.nodeIds.includes(target)) assign(duplicate.id, true);
      setQuery('');
      return;
    }
    if (tags.length >= MAX_WORKSPACE_TAGS || full) {
      setError(
        full
          ? 'Workspace has reached the 50,000 tag membership limit.'
          : 'Workspace supports at most 200 tags.',
      );
      return;
    }
    onChange((current) => ({
      ...current,
      tags: [...(current.tags ?? []), { id: crypto.randomUUID(), name, color, nodeIds: [target] }],
    }));
    setError('');
    setQuery('');
    search.current?.focus();
  }
  return (
    <div
      className="tag-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        id={id}
        className="tag-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose tags"
        style={{ left, top, width, maxHeight: viewport.top + viewport.height - top - 12 }}
      >
        <div className="tags-heading">
          <strong>Tags</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Close tag picker"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
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
        <form
          className="tag-picker-search"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <input
            ref={search}
            type="search"
            aria-label="Find or create tag"
            placeholder="Find or create tag…"
            maxLength={100}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError('');
            }}
          />
        </form>
        <div className="tag-picker-options" role="group" aria-label="Existing tags">
          {tags
            .filter((tag) =>
              `${tag.name} ${tag.description ?? ''}`.toLowerCase().includes(name.toLowerCase()),
            )
            .map((tag) => {
              const direct = tag.nodeIds.includes(target);
              const viaAddress =
                selected.kind === 'output' &&
                !!selected.address &&
                tag.nodeIds.includes(addressNodeId(selected.address));
              const viaOutput = selected.kind === 'output' && tag.nodeIds.includes(selected.id);
              const inherited = !direct && effective.some((item) => item.id === tag.id);
              return (
                <label className="tag-assignment" key={tag.id}>
                  <input
                    type="checkbox"
                    checked={direct}
                    disabled={!direct && full}
                    onChange={(event) => assign(tag.id, event.target.checked)}
                  />
                  <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                  <span>
                    {tag.name}
                    {scope === 'node' && viaAddress ? (
                      <small>Applied to address too</small>
                    ) : scope === 'address' && viaOutput ? (
                      <small>Applied to this output too</small>
                    ) : inherited ? (
                      <small>Applied to selection</small>
                    ) : null}
                  </span>
                </label>
              );
            })}
          {!tags.length && !name && (
            <p className="small muted">Type a name to create your first tag.</p>
          )}
          {name &&
            !tags.some((tag) =>
              `${tag.name} ${tag.description ?? ''}`.toLowerCase().includes(name.toLowerCase()),
            ) && <p className="small muted">No matching tags.</p>}
        </div>
        {name && !duplicate && (
          <div className="tag-picker-create">
            <ColorPicker value={color} onChange={setColor} />
            <button
              type="button"
              className="primary"
              disabled={tags.length >= MAX_WORKSPACE_TAGS || full}
              onClick={create}
            >
              <Plus size={14} /> Create tag <span>“{name}”</span>
            </button>
          </div>
        )}
        {error && (
          <p className="warning small" role="alert">
            {error}
          </p>
        )}
        {tags.length >= MAX_WORKSPACE_TAGS && (
          <p className="small muted">200-tag limit reached. Existing tags can still be assigned.</p>
        )}
        {full && (
          <p className="small muted">
            Membership limit reached. Remove an assignment to add another.
          </p>
        )}
        <div className="tag-picker-footer">
          <span className="small muted" title="Manual groups do not establish ownership.">
            Applied automatically
          </span>
          <button type="button" className="text-button" onClick={onManage}>
            Manage tags
          </button>
        </div>
      </div>
    </div>
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
                  {short(workspace.annotations[id]?.label || id, 10)}
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
        <h3>Workspace tags</h3>
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
