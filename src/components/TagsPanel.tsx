import { useMemo, useState } from 'react';
import { Check, Plus, Tag, Trash2 } from 'lucide-react';
import {
  addressNodeId,
  short,
  type GraphData,
  type GraphNode,
  type Workspace,
  type WorkspaceTag,
} from '../domain/types';
import { listTagsForNode, tagNodeIds, tagsFromLabels, buildWalletMatches } from '../domain/tags';
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
        if (name.trim()) onSave({ name: name.trim(), color, description: description.trim() });
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
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <ColorPicker value={color} onChange={setColor} />
      <label>
        Description
        <textarea
          aria-label="Tag description"
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="tag-form-actions">
        <button className="primary" disabled={!name.trim()}>
          {tag ? 'Save tag' : 'Create tag'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
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
}: {
  workspace: Workspace;
  selected: GraphNode;
  graph: GraphData;
  onChange: Change;
  onManage: () => void;
}) {
  const tags = workspace.tags ?? [];
  const effective = listTagsForNode(workspace, selected);
  const matches = useMemo(() => buildWalletMatches(workspace, graph), [workspace, graph]);
  const match = matches.get(selected.id);
  const [scope, setScope] = useState<'node' | 'address'>('node');
  const target =
    scope === 'address' && selected.address ? addressNodeId(selected.address) : selected.id;
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
      <details>
        <summary>
          <Tag size={14} /> Tags {effective.length > 0 && <span>{effective.length}</span>}
        </summary>
        <p className="small muted">
          Manual groups for known sources and destinations. Tags do not establish ownership.
        </p>
        {selected.kind === 'output' && selected.address && (
          <label>
            Apply to
            <select
              aria-label="Tag assignment scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="node">This output</option>
              <option value="address">This address and its outputs</option>
            </select>
          </label>
        )}
        {tags.map((tag) => {
          const direct = tag.nodeIds.includes(target);
          const inherited = !direct && effective.some((value) => value.id === tag.id);
          return (
            <label className="tag-assignment" key={tag.id}>
              <input
                type="checkbox"
                checked={direct}
                onChange={(event) => {
                  const checked = event.target.checked;
                  onChange((current) => ({
                    ...current,
                    tags: (current.tags ?? []).map((item) =>
                      item.id === tag.id
                        ? {
                            ...item,
                            nodeIds: checked
                              ? [...new Set([...item.nodeIds, target])]
                              : item.nodeIds.filter((id) => id !== target),
                          }
                        : item,
                    ),
                  }));
                }}
              />
              <span className="tag-dot" style={{ backgroundColor: tag.color }} />
              <span>
                {tag.name}
                {inherited && <small>Also applied through address</small>}
              </span>
            </label>
          );
        })}
        {!tags.length && (
          <p className="small muted">Create a tag, then apply it to this selection.</p>
        )}
        <button className="text-button" onClick={onManage}>
          Manage workspace tags
        </button>
      </details>
      {!!effective.length && (
        <div className="tag-badges">
          {effective.map((tag) => (
            <span key={tag.id}>
              <i style={{ backgroundColor: tag.color }} />
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </section>
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
    setCreating(false);
    setEditing(undefined);
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
                    onCancel={() => setEditing(undefined)}
                  />
                ) : (
                  <>
                    {tag.description && <p className="small">{tag.description}</p>}
                    <p className="small muted">
                      {ids.length} loaded entities · {tag.nodeIds.length} assigned references
                    </p>
                    <div className="tag-form-actions">
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
