import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Check,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Trash2,
  Unlink,
  UsersRound,
} from 'lucide-react';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import {
  counterpartySelectionLinks,
  setCounterpartySelection,
  createCounterpartyLookup,
  listCounterpartiesForEntity,
  listCounterpartiesForRelationship,
  removeCounterparty,
  removeCounterpartyLink,
  saveCounterparty,
  type Counterparty,
  type CounterpartySubject,
} from '../../../../Core/Workspace/Counterparties/counterparties';
import { counterpartyReference } from '../../../../Core/Workspace/annotationReferences';
import { walletTransactionCounterpartySubject } from '../../../../Core/Workspace/Counterparties/walletCounterpartySubjects';
import { isOpReturn } from '../../../../Core/Bitcoin';
import { indexPreviousOutputs } from '../../../../Core/ChainData';
import { walletOutputEvidence } from '../../../../Core/Workspace/Wallets/walletOutputEvidence';
import { AnchoredPopover } from '../../../Controls/AnchoredPopover';
import { WalletMetadataFields, WalletIconEdit } from './WalletMetadataFields';
import { Modal } from '../../../Dialogs/Modal';
import { Amount } from '../../../Controls/Display/Amount';
import { ResponsiveIdentifier } from '../../../Controls/Display/ResponsiveIdentifier';
import type { WalletRow } from './walletRows';
import type { WalletWorkbenchContext } from './walletWorkbenchContext';

function partyName(workspace: Workspace, party: Counterparty) {
  return (
    workspace.annotations.entities[counterpartyReference(party.id)]?.label || 'Unnamed counterparty'
  );
}

/** Exact saved relationship context; this never allocates a payment or infers identity. */
export function walletRowCounterparties(
  workspace: Workspace,
  row: WalletRow,
  lookup?: ReturnType<typeof createCounterpartyLookup>,
): Counterparty[] {
  const relevant =
    row.kind === 'output'
      ? row.reviews.filter((item) => item.goal === 'coin-context')
      : row.reviews.filter(
          (item) => item.goal === 'counterparty-context' || item.goal === 'activity-context',
        );
  const ids = new Set(
    relevant.flatMap((item) =>
      item.contextSubjects.filter((id) => id.startsWith('party:')).map((id) => id.slice(6)),
    ),
  );
  const contextual = (workspace.counterparties?.definitions ?? []).filter((party) =>
    ids.has(party.id),
  );
  const explicit =
    row.kind === 'transaction' ? [] : listCounterpartiesForEntity(workspace, row.nodeId, lookup);
  const receipt =
    row.kind === 'output' && row.txid
      ? listCounterpartiesForRelationship(
          workspace,
          { transactionId: row.txid, direction: 'received', walletOutputIds: [row.nodeId] },
          lookup,
        )
      : [];
  return [
    ...new Map([...contextual, ...receipt, ...explicit].map((party) => [party.id, party])).values(),
  ];
}

export function walletCounterpartyNames(
  workspace: Workspace,
  row: WalletRow,
  lookup?: ReturnType<typeof createCounterpartyLookup>,
): string[] {
  return walletRowCounterparties(workspace, row, lookup).map((party) =>
    partyName(workspace, party),
  );
}

/** Creating and assigning a named identity is one workspace edit. */
export function CounterpartyPicker({
  workspace,
  subject,
  onChange,
  onNotice,
  disabled,
  label = 'Add counterparty',
  onOpenChange,
  iconOnly = false,
  children,
  active = true,
}: {
  workspace: Workspace;
  subject?: CounterpartySubject;
  onChange: WalletWorkbenchContext['onChange'];
  onNotice: (message: string) => void;
  disabled?: boolean;
  label?: string;
  onOpenChange?: (open: boolean) => void;
  iconOnly?: boolean;
  children?: ReactNode;
  active?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement>();
  const id = useId();
  if (anchor && !active) setAnchor(undefined);
  return (
    <>
      <button
        className={children ? 'wallet-field-value' : 'wallet-field-edit'}
        aria-label={label}
        title={label}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
          onOpenChange?.(true);
        }}
      >
        {children || (
          <>
            {iconOnly ? <UsersRound size={14} /> : <Plus size={13} />} {!iconOnly && label}
          </>
        )}
      </button>
      {anchor && (
        <AnchoredPopover
          id={id}
          anchor={anchor}
          title={
            subject?.kind === 'wallet-transaction'
              ? subject.direction === 'received'
                ? 'Senders'
                : 'Recipients'
              : subject
                ? 'Counterparties'
                : 'Add counterparty'
          }
          width={320}
          onClose={() => {
            setAnchor(undefined);
            onOpenChange?.(false);
          }}
        >
          <CounterpartyChecklist
            workspace={workspace}
            subject={subject}
            onChange={onChange}
            onNotice={onNotice}
          />
        </AnchoredPopover>
      )}
    </>
  );
}

function CounterpartyChecklist({
  workspace,
  subject,
  onChange,
  onNotice,
}: {
  workspace: Workspace;
  subject?: CounterpartySubject;
  onChange: WalletWorkbenchContext['onChange'];
  onNotice: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [scopeFor, setScopeFor] = useState<string>();
  const [sourceSubject, setSourceSubject] = useState<CounterpartySubject>();
  const search = useRef<HTMLInputElement>(null);
  const editing = sourceSubject ?? subject;
  const definitions = workspace.counterparties?.definitions ?? [];
  const matching = definitions.filter((party) =>
    partyName(workspace, party).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const exactName = definitions.some(
    (party) => partyName(workspace, party).toLowerCase() === query.trim().toLowerCase(),
  );
  const direct = editing ? counterpartySelectionLinks(workspace, editing) : [];
  const inherited =
    editing?.kind === 'entity' && editing.subjectId.startsWith('out:')
      ? (workspace.counterparties?.links ?? []).filter(
          (link) =>
            link.kind === 'wallet-transaction' &&
            link.direction === 'received' &&
            link.walletOutputIds.includes(editing.subjectId) &&
            (!link.outputIds || link.outputIds.includes(editing.subjectId)),
        )
      : editing?.kind === 'wallet-transaction'
        ? (workspace.counterparties?.links ?? []).filter(
            (link) =>
              link.kind === 'wallet-transaction' &&
              link.transactionId === editing.transactionId &&
              link.direction === editing.direction &&
              link.walletOutputIds.some((id) => editing.walletOutputIds.includes(id)) &&
              !direct.includes(link),
          )
        : [];
  function change(partyId: string, selection: 'none' | 'all' | string[]) {
    if (!editing) return false;
    try {
      setCounterpartySelection(workspace, partyId, editing, selection);
      onChange((current) => setCounterpartySelection(current, partyId, editing, selection));
      setError('');
      search.current?.focus();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update counterparty');
      return false;
    }
  }
  function create() {
    const name = query.trim();
    if (!name) return;
    try {
      const edit = { id: crypto.randomUUID(), name };
      saveCounterparty(workspace, edit, editing);
      onChange((current) => saveCounterparty(current, edit, editing));
      onNotice('Counterparty created');
      setQuery('');
      setError('');
      search.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create counterparty');
    }
  }
  return (
    <div className="wallet-party-form compact-controls">
      {sourceSubject && (
        <button
          className="text-button"
          onClick={() => {
            setSourceSubject(undefined);
            setScopeFor(undefined);
          }}
        >
          Back to this record
        </button>
      )}
      <input
        ref={search}
        data-autofocus
        type="search"
        aria-label="Search counterparties"
        autoComplete="off"
        maxLength={200}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search or create…"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && query.trim() && !exactName) {
            event.preventDefault();
            create();
          }
        }}
      />
      {editing && (
        <div className="wallet-party-options" aria-label="Counterparties">
          {matching.map((party) => {
            const links = direct.filter((link) => link.counterpartyId === party.id);
            const source = inherited.find((link) => link.counterpartyId === party.id);
            const selected = links.length > 0;
            const whole = links.some((link) => link.kind === 'entity' || !link.outputIds);
            const scopedOutputs = [
              ...new Set(
                links.flatMap((link) =>
                  link.kind === 'wallet-transaction' ? (link.outputIds ?? []) : [],
                ),
              ),
            ];
            return (
              <div className="wallet-party-choice" key={party.id}>
                <div className="wallet-party-choice-heading">
                  <button
                    className="wallet-party-choice-toggle"
                    role="checkbox"
                    aria-checked={selected || !!source}
                    disabled={!selected && !!source}
                    onClick={() => change(party.id, selected ? 'none' : 'all')}
                  >
                    <span
                      className={`wallet-choice-check${selected || source ? ' is-checked' : ''}`}
                      aria-hidden="true"
                    >
                      {(selected || source) && <Check size={12} />}
                    </span>
                    <span>{partyName(workspace, party)}</span>
                  </button>
                  {selected && editing.kind === 'wallet-transaction' && (
                    <button
                      className="text-button"
                      aria-label={`Edit outputs for ${partyName(workspace, party)}`}
                      aria-expanded={scopeFor === party.id}
                      onClick={() => setScopeFor(scopeFor === party.id ? undefined : party.id)}
                    >
                      {whole
                        ? `${editing.direction === 'sent' ? 'Outgoing' : 'Incoming'} transaction`
                        : `${scopedOutputs.length} ${scopedOutputs.length === 1 ? 'output' : 'outputs'}`}
                    </button>
                  )}
                </div>
                {!selected && source && (
                  <div className="wallet-party-choice-hint">
                    From{' '}
                    {source.kind === 'wallet-transaction' && source.direction === 'sent'
                      ? 'outgoing transaction'
                      : 'incoming transaction'}{' '}
                    <button
                      className="text-button"
                      onClick={() => {
                        setSourceSubject(source);
                        setScopeFor(undefined);
                      }}
                    >
                      Edit{' '}
                      {source.kind === 'wallet-transaction' && source.direction === 'sent'
                        ? 'recipients'
                        : 'senders'}
                    </button>
                  </div>
                )}
                {scopeFor === party.id && editing.kind === 'wallet-transaction' && (
                  <CounterpartyOutputScope
                    key={party.id}
                    workspace={workspace}
                    subject={editing}
                    name={partyName(workspace, party)}
                    initialOutputs={whole ? undefined : scopedOutputs}
                    onCancel={() => setScopeFor(undefined)}
                    onApply={(outputs) => {
                      if (change(party.id, outputs ?? 'all')) setScopeFor(undefined);
                    }}
                  />
                )}
              </div>
            );
          })}
          {!matching.length && !query.trim() && <p className="muted">No counterparties yet</p>}
          {!matching.length && query.trim() && <p className="muted">No results</p>}
        </div>
      )}
      {((query.trim() && !exactName) || !editing) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <button type="submit" disabled={!query.trim()}>
            <Plus size={13} />
            {query.trim() ? `Create “${query.trim()}”` : 'Create counterparty'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
    </div>
  );
}

function CounterpartyOutputScope({
  workspace,
  subject,
  name,
  initialOutputs,
  onCancel,
  onApply,
}: {
  workspace: Workspace;
  subject: Extract<CounterpartySubject, { kind: 'wallet-transaction' }>;
  name: string;
  initialOutputs?: string[];
  onCancel: () => void;
  onApply: (outputs?: string[]) => void;
}) {
  const [whole, setWhole] = useState(!initialOutputs);
  const [outputs, setOutputs] = useState(initialOutputs ?? []);
  const radioName = useId();
  const transaction = workspace.chainData.transactions[subject.transactionId];
  const choices =
    transaction?.vout.filter(
      (output) =>
        subject.direction === 'sent' ||
        subject.walletOutputIds.includes(`out:${subject.transactionId}:${output.n}`),
    ) ?? [];
  return (
    <form
      className="wallet-party-output-scope"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(whole ? undefined : outputs);
      }}
    >
      <fieldset className="wallet-party-scope-options">
        <legend>Apply {name} to</legend>
        <label className="wallet-checkbox-label">
          <input type="radio" name={radioName} checked={whole} onChange={() => setWhole(true)} />
          {subject.direction === 'sent' ? 'Outgoing' : 'Incoming'} transaction
        </label>
        <label className="wallet-checkbox-label">
          <input type="radio" name={radioName} checked={!whole} onChange={() => setWhole(false)} />
          Selected outputs
        </label>
        <div className="wallet-party-scope-outputs">
          {choices.map((output) => {
            const id = `out:${subject.transactionId}:${output.n}`;
            const evidence = walletOutputEvidence(output, workspace.network);
            const address = evidence.address;
            const label =
              workspace.annotations.entities[id]?.label ||
              (address ? workspace.annotations.entities[`addr:${address}`]?.label : undefined);
            return (
              <label className="wallet-party-scope-output" key={id}>
                <input
                  type="checkbox"
                  aria-label={`Output ${output.n}`}
                  checked={outputs.includes(id)}
                  onChange={(event) => {
                    setWhole(false);
                    setOutputs((current) =>
                      event.target.checked
                        ? [...current, id]
                        : current.filter((entry) => entry !== id),
                    );
                  }}
                />
                <span className="wallet-party-output-identity">
                  <span className="small muted">Output {output.n}</span>
                  {address ? (
                    <span className="mono" title={address}>
                      <ResponsiveIdentifier value={address} />
                    </span>
                  ) : (
                    <span>
                      {isOpReturn(output.scriptPubKey.hex ?? '') ? 'OP_RETURN' : 'Script output'}
                    </span>
                  )}
                  {label && (
                    <span className="small muted" title={label}>
                      {label}
                    </span>
                  )}
                </span>
                <Amount value={Math.round(output.value * 100_000_000)} />
              </label>
            );
          })}
          {!choices.length && <p className="muted">Output details unavailable</p>}
        </div>
      </fieldset>
      <div className="button-row">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={!whole && !outputs.length}>
          Apply
        </button>
      </div>
    </form>
  );
}

function counterpartyAnswerSources(
  workspace: Workspace,
  row: WalletRow,
  lookup: ReturnType<typeof createCounterpartyLookup>,
) {
  const goals = row.reviews.filter((item) => item.goal === 'counterparty-context');
  const references = [...new Set(goals.flatMap((item) => item.contextSubjects))];
  const accepted = new Set(
    references.filter((id) => id.startsWith('party:')).map((id) => id.slice(6)),
  );
  return references
    .filter((id) => !id.startsWith('party:'))
    .flatMap((id) => {
      const parties = listCounterpartiesForEntity(workspace, id, lookup).filter((party) =>
        accepted.has(party.id),
      );
      return parties.length ? [{ id, parties }] : [];
    });
}

/** Editable associations share one field with their saved identities and scope. */
export function WalletCounterpartyContext({
  workspace,
  wallet,
  row,
  active,
  busy,
  onChange,
  onNotice,
  prepared,
  onOpenRecord,
  reviews,
}: Pick<WalletWorkbenchContext, 'workspace' | 'active' | 'busy' | 'onChange'> & {
  wallet: Wallet;
  row: WalletRow;
  onNotice: (message: string) => void;
  prepared: NonNullable<Parameters<typeof walletTransactionCounterpartySubject>[4]>;
  onOpenRecord?: (id: string) => void;
  reviews?: Partial<Record<'senders' | 'recipients' | 'counterparties', ReactNode>>;
}) {
  const lookup = useMemo(
    () => createCounterpartyLookup({ counterparties: workspace.counterparties }),
    [workspace.counterparties],
  );
  const subjects = useMemo(() => {
    if (row.kind !== 'transaction' || !row.txid)
      return [{ kind: 'entity' as const, subjectId: row.nodeId }];
    if (row.walletTransaction?.direction === 'transfer') return [];
    const directions =
      row.walletTransaction?.direction === 'received' || row.walletTransaction?.direction === 'sent'
        ? [row.walletTransaction.direction]
        : [
            ...new Set(
              row.reviews
                .filter((item) => item.goal === 'counterparty-context')
                .flatMap((item) => item.relationshipKinds ?? [])
                .map((kind) => (kind === 'source' ? ('received' as const) : ('sent' as const))),
            ),
          ];
    return directions.flatMap((direction) => {
      const subject = walletTransactionCounterpartySubject(
        workspace,
        wallet,
        row.txid!,
        direction,
        prepared,
      );
      return subject ? [subject] : [];
    });
  }, [workspace, wallet, row, prepared]);
  const sources = counterpartyAnswerSources(workspace, row, lookup).filter(
    (source) => source.id !== row.nodeId,
  );
  const inherited =
    row.kind === 'output'
      ? walletRowCounterparties(workspace, row, lookup).filter(
          (party) =>
            !listCounterpartiesForEntity(workspace, row.nodeId, lookup).some(
              (direct) => direct.id === party.id,
            ),
        )
      : [];
  const picker = (subject: CounterpartySubject, label: string, value: ReactNode) => (
    <CounterpartyPicker
      workspace={workspace}
      subject={subject}
      onChange={onChange}
      onNotice={onNotice}
      disabled={!active || busy}
      active={active}
      label={label}
    >
      {value}
    </CounterpartyPicker>
  );
  const partyValue = (
    party: Counterparty | undefined,
    subject: CounterpartySubject,
    label: string,
    scope?: ReactNode,
    key?: string,
  ) => (
    <span className="wallet-inline-party" key={key ?? party?.id ?? 'selection'}>
      {picker(
        subject,
        label,
        <>
          {party ? (
            <>
              <span className="wallet-field-text">{partyName(workspace, party)}</span>
              <Pencil className="wallet-field-edit-icon" size={14} aria-hidden="true" />
            </>
          ) : (
            <>
              <Plus className="wallet-field-add-icon" size={14} aria-hidden="true" />
              <span className="wallet-field-text muted">
                {subject.kind === 'entity'
                  ? 'Add a counterparty…'
                  : subject.direction === 'received'
                    ? 'Add a sender…'
                    : 'Add a recipient…'}
              </span>
            </>
          )}
          {scope && <small className="muted">{scope}</small>}
        </>,
      )}
      {party && onOpenRecord && (
        <a
          className="wallet-counterparty-open"
          href="#wallet-record-detail"
          aria-label={partyName(workspace, party)}
          title={`Open ${partyName(workspace, party)}`}
          data-wallet-reference={counterpartyReference(party.id)}
          onClick={(event) => {
            event.preventDefault();
            onOpenRecord(counterpartyReference(party.id));
          }}
        >
          <ArrowUpRight size={13} />
        </a>
      )}
    </span>
  );
  const unavailable =
    row.kind === 'transaction'
      ? [
          ...new Set(
            row.reviews
              .filter((item) => item.goal === 'counterparty-context')
              .flatMap((item) => item.relationshipKinds ?? []),
          ),
        ].filter(
          (kind) =>
            !subjects.some(
              (subject) =>
                subject.kind === 'wallet-transaction' &&
                subject.direction === (kind === 'source' ? 'received' : 'sent'),
            ),
        )
      : [];
  return (
    <>
      {subjects.map((subject) => {
        const parties =
          subject.kind === 'entity'
            ? listCounterpartiesForEntity(workspace, subject.subjectId, lookup)
            : listCounterpartiesForRelationship(workspace, subject, lookup);
        const noun =
          subject.kind === 'entity'
            ? 'counterparties'
            : subject.direction === 'received'
              ? 'senders'
              : 'recipients';
        const label =
          subject.kind === 'entity'
            ? 'Counterparties'
            : subject.direction === 'received'
              ? 'Sender'
              : 'Recipient';
        const links =
          subject.kind === 'entity' ? [] : counterpartySelectionLinks(workspace, subject);
        return (
          <div
            className="wallet-inline-field wallet-inline-counterparties"
            role="region"
            aria-label="Counterparties"
            key={subject.kind === 'entity' ? subject.subjectId : subject.direction}
          >
            <dt>{label}</dt>
            <dd>
              {(parties.length || inherited.length
                ? [...parties, ...inherited]
                : !sources.length
                  ? [undefined]
                  : []
              ).map((party, index) =>
                partyValue(
                  party,
                  subject,
                  `Edit ${noun}`,
                  links
                    .filter(
                      (link) =>
                        link.counterpartyId === party?.id &&
                        link.kind === 'wallet-transaction' &&
                        link.outputIds,
                    )
                    .map((link) =>
                      link.kind === 'wallet-transaction' && link.outputIds
                        ? `${link.outputIds.length === 1 ? 'Output' : 'Outputs'} ${link.outputIds.map((id) => id.split(':').at(-1)).join(', ')}`
                        : '',
                    )
                    .join(' · '),
                  index === 0 ? 'selection' : party?.id,
                ),
              )}
              {sources.map((source) => (
                <span className="wallet-inline-source-association" key={source.id}>
                  {source.parties.map((party) =>
                    partyValue(party, { kind: 'entity', subjectId: source.id }, 'Edit association'),
                  )}
                  <span className="wallet-inline-source small muted">
                    {source.id.startsWith('addr:') ? 'Address' : 'Output'}{' '}
                    <code title={source.id}>
                      <ResponsiveIdentifier value={source.id.slice(source.id.indexOf(':') + 1)} />
                    </code>
                  </span>
                </span>
              ))}
              {reviews?.[noun]}
            </dd>
          </div>
        );
      })}
      {unavailable.map((kind) => (
        <div className="wallet-inline-field wallet-inline-counterparties" key={kind}>
          <dt>{kind === 'source' ? 'Sender' : 'Recipient'}</dt>
          <dd>
            <span className="muted">Unknown</span>
            {reviews?.[kind === 'source' ? 'senders' : 'recipients']}
          </dd>
        </div>
      ))}
    </>
  );
}

/** Shared identities remain browsable while another record is open in the detail panel. */
export function WalletCounterpartyList({
  workspace,
  active,
  busy,
  onChange,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  children,
}: Pick<WalletWorkbenchContext, 'workspace' | 'active' | 'busy' | 'onChange'> & {
  selectedId?: string;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  children?: ReactNode;
}) {
  const [notice, setNotice] = useState('');
  const definitions = workspace.counterparties?.definitions ?? [];
  const matching = definitions.filter((item) =>
    `${partyName(workspace, item)} ${item.category ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="wallet-review-body wallet-counterparties" aria-label="Named counterparties">
      <div className="wallet-record-filters compact-controls">
        <label className="wallet-record-search">
          Search
          <input
            type="search"
            aria-label="Find counterparties"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find counterparties"
          />
        </label>
        <CounterpartyPicker
          workspace={workspace}
          onChange={onChange}
          onNotice={setNotice}
          disabled={!active || busy}
        />
      </div>
      <div className="wallet-review-grid">
        <div
          className="wallet-review-list wallet-review-records"
          role="list"
          aria-label="Counterparty records"
        >
          <div className="wallet-list-header small muted" role="listitem">
            <span>
              {matching.length === definitions.length
                ? `${matching.length} ${matching.length === 1 ? 'counterparty' : 'counterparties'}`
                : `${matching.length}/${definitions.length} shown`}
            </span>
            {notice && (
              <span role="status" className="wallet-review-notice">
                {notice}
              </span>
            )}
          </div>
          {matching.map((item) => (
            <div
              className={`wallet-review-item wallet-review-record ${item.id === selectedId ? 'current' : ''}`}
              role="listitem"
              key={item.id}
            >
              <div className="wallet-row-content" onClick={() => onSelect(item.id)}>
                <div className="wallet-row-heading">
                  <a
                    href="#wallet-record-detail"
                    className="wallet-row-link"
                    aria-label={`${partyName(workspace, item)}${item.category ? ` · ${item.category}` : ''}`}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    onClick={(event) => event.preventDefault()}
                  >
                    <strong className="wallet-item-title">
                      {workspace.annotations.entities[counterpartyReference(item.id)]?.icon && (
                        <span aria-hidden="true">
                          {workspace.annotations.entities[counterpartyReference(item.id)].icon}
                        </span>
                      )}
                      {partyName(workspace, item)}
                    </strong>
                    {item.category && <span className="wallet-row-label">{item.category}</span>}
                  </a>
                  {workspace.annotations.entities[counterpartyReference(item.id)]?.bookmarked && (
                    <Bookmark size={13} aria-label="Bookmarked" className="muted" />
                  )}
                </div>
              </div>
            </div>
          ))}
          {!definitions.length && <p className="wallet-empty-note">No counterparties yet</p>}
          {definitions.length > 0 && !matching.length && (
            <p className="wallet-empty-note">No results</p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

type CounterpartyDetailProps = Pick<
  WalletWorkbenchContext,
  'workspace' | 'active' | 'busy' | 'onChange' | 'onShowInGraph'
> & {
  partyId: string;
  activityRows: WalletRow[];
  onOpenRecord: (canonicalReference: string) => void;
  canOpenRecord?: (canonicalReference: string) => boolean;
  onShowRelatedTransactions: (transactionIds: string[]) => void;
  onRemoved?: () => void;
};

/** The panel owns navigation. A changed identity resets only its local editors. */
export function WalletCounterpartyDetail(props: CounterpartyDetailProps) {
  return <CounterpartyDetail key={props.partyId} {...props} />;
}

function CounterpartyDetail({
  workspace,
  active,
  busy,
  onChange,
  partyId,
  activityRows,
  onOpenRecord,
  canOpenRecord,
  onShowInGraph,
  onShowRelatedTransactions,
  onRemoved,
}: CounterpartyDetailProps) {
  const [notice, setNotice] = useState('');
  const [category, setCategory] = useState<string>();
  const categoryId = useId();
  const [categoryAnchor, setCategoryAnchor] = useState<HTMLButtonElement>();
  const closeCategory = () => {
    setCategory(undefined);
    queueMicrotask(() => categoryAnchor?.focus());
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const actionsId = useId();
  const menu = active && menuOpen;
  useEffect(() => {
    if (!menu) return;
    const items = () => [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('.dropdown button:not(:disabled)') ??
        []),
    ];
    items()[0]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        menuTrigger.current?.focus({ preventScroll: true });
      }
      const buttons = items();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  const party = workspace.counterparties?.definitions.find((item) => item.id === partyId);
  const reference = counterpartyReference(partyId);
  const annotation = workspace.annotations.entities[reference];
  const links = useMemo(
    () => (workspace.counterparties?.links ?? []).filter((link) => link.counterpartyId === partyId),
    [workspace.counterparties, partyId],
  );
  const transactions = [
    ...new Set(
      activityRows.flatMap((row) =>
        row.txid &&
        row.reviews.some(
          (item) =>
            (item.goal === 'activity-context' || item.goal === 'counterparty-context') &&
            item.contextSubjects.includes(reference),
        )
          ? [row.txid]
          : [],
      ),
    ),
  ];
  const addresses = useMemo(() => {
    const result = new Map<string, Set<string>>();
    const previousOutputs = indexPreviousOutputs({
      network: workspace.network,
      transactions: workspace.chainData.transactions,
    });
    function add(address: string, context: string) {
      const contexts = result.get(address) ?? new Set<string>();
      contexts.add(context);
      result.set(address, contexts);
    }
    function addOutput(id: string, context: string) {
      const output = previousOutputs.get(id.slice(4));
      if (output?.status !== 'loaded' && output?.status !== 'attached') return;
      const evidence = walletOutputEvidence(output.output, workspace.network);
      if (evidence.address) add(evidence.address, context);
    }
    for (const link of links) {
      if (link.kind === 'entity') {
        if (link.subjectId.startsWith('addr:'))
          add(link.subjectId.slice(5), 'Explicit address association');
        else addOutput(link.subjectId, 'Explicit output association');
      } else {
        // A broad payment relationship does not identify any destination address.
        // Receipt anchors are wallet outputs, never addresses attributed to the sender.
        const outputIds =
          link.outputIds ?? (link.direction === 'received' ? link.walletOutputIds : []);
        for (const id of outputIds)
          addOutput(id, link.direction === 'received' ? 'Received output' : 'Sent output');
      }
    }
    return [...result].map(([address, contexts]) => ({ address, contexts: [...contexts] }));
  }, [links, workspace.chainData.transactions, workspace.network]);
  if (!party) return <p className="wallet-empty-note">Counterparty removed</p>;
  const recordLink = (id: string) => {
    const value = id.slice(id.indexOf(':') + 1);
    const identity = (
      <>
        <code title={value}>
          <ResponsiveIdentifier value={value} />
        </code>
        {workspace.annotations.entities[id]?.label && (
          <span className="wallet-related-label">{workspace.annotations.entities[id].label}</span>
        )}
      </>
    );
    return canOpenRecord?.(id) !== false ? (
      <a
        className="wallet-related-record-link"
        href="#wallet-record-detail"
        data-wallet-reference={id}
        aria-label={value}
        onClick={(event) => {
          event.preventDefault();
          onOpenRecord(id);
        }}
      >
        {identity}
      </a>
    ) : (
      <div className="wallet-reference-actions">
        <span className="wallet-related-record-link">{identity}</span>
        <button
          className="icon-button"
          aria-label={`Show ${value} on graph`}
          title="Show on graph"
          onClick={() => onShowInGraph(id)}
        >
          <Network size={13} />
        </button>
      </div>
    );
  };
  return (
    <section
      className="wallet-counterparty-detail compact-controls"
      aria-label="Counterparty details"
    >
      <header className="wallet-subject-header wallet-detail-heading">
        <div className="wallet-detail-topline">
          <span className="wallet-detail-type">Counterparty</span>
        </div>
        <div className="wallet-detail-identity">
          <div className="wallet-subject-title-row">
            <WalletIconEdit
              workspace={workspace}
              id={reference}
              active={active}
              onChange={onChange}
              disabled={!active || busy}
            />
            <h2 className="wallet-item-title" tabIndex={-1}>
              {partyName(workspace, party)}
            </h2>{' '}
            <div
              className="workspace-menu wallet-actions-menu wallet-counterparty-menu"
              ref={menuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
              }}
            >
              <button
                ref={menuTrigger}
                className="icon-button"
                aria-label="Counterparty actions"
                title="Counterparty actions"
                aria-haspopup="menu"
                aria-expanded={menu}
                aria-controls={menu ? actionsId : undefined}
                disabled={!active || busy}
                onClick={() => setMenuOpen(!menu)}
              >
                <MoreHorizontal size={16} />
              </button>
              {menu && (
                <div
                  className="dropdown"
                  id={actionsId}
                  role="menu"
                  aria-label="Counterparty actions"
                >
                  <button
                    role="menuitemcheckbox"
                    aria-checked={annotation?.bookmarked ?? false}
                    disabled={busy}
                    onClick={() => {
                      const bookmarked = !annotation?.bookmarked;
                      onChange((current) => ({
                        ...current,
                        annotations: {
                          ...current.annotations,
                          entities: {
                            ...current.annotations.entities,
                            [reference]: { ...current.annotations.entities[reference], bookmarked },
                          },
                        },
                      }));
                      setMenuOpen(false);
                    }}
                  >
                    <Bookmark size={14} /> Bookmark
                  </button>
                  <button
                    role="menuitem"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 size={14} /> Remove counterparty
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      {active && category !== undefined && categoryAnchor && (
        <AnchoredPopover
          id={categoryId}
          anchor={categoryAnchor}
          title="Category"
          onClose={closeCategory}
          className="compact-controls"
        >
          <form
            className="wallet-party-form"
            onSubmit={(event) => {
              event.preventDefault();
              onChange((current) =>
                saveCounterparty(current, {
                  id: party.id,
                  name: partyName(current, party),
                  category,
                }),
              );
              closeCategory();
              setNotice('Category saved.');
            }}
          >
            <label htmlFor={`${categoryId}-input`}>Category</label>
            <input
              id={`${categoryId}-input`}
              data-autofocus
              value={category}
              maxLength={100}
              onChange={(event) => setCategory(event.target.value)}
            />
            <div className="button-row">
              <button className="primary" disabled={!active || busy} type="submit">
                Save category
              </button>
              <button type="button" onClick={closeCategory}>
                Cancel
              </button>
            </div>
          </form>
        </AnchoredPopover>
      )}
      <section
        className="wallet-detail-fields wallet-counterparty-fields"
        aria-label="Identity details"
      >
        <WalletMetadataFields
          workspace={workspace}
          id={reference}
          active={active}
          label="Name"
          disabled={!active || busy}
          onChange={onChange}
          onNotice={setNotice}
        >
          <div className="wallet-inline-field" role="region" aria-label="Category field">
            <dt>Category</dt>
            <dd>
              <button
                className={`wallet-field-value${party.category ? '' : ' is-empty'}`}
                aria-label="Edit category"
                title="Edit category"
                aria-haspopup="dialog"
                aria-expanded={category !== undefined}
                disabled={!active || busy}
                onClick={(event) => {
                  setCategoryAnchor(event.currentTarget);
                  setCategory(party.category ?? '');
                }}
              >
                {party.category || 'Add a category…'}
              </button>
            </dd>
          </div>
        </WalletMetadataFields>
      </section>
      <details className="wallet-related-records" open>
        <summary>Transactions ({transactions.length})</summary>
        {transactions.length > 0 && (
          <button
            className="text-button"
            aria-label="Show related transactions"
            disabled={busy}
            onClick={() => onShowRelatedTransactions(transactions)}
          >
            Show in Transactions
          </button>
        )}
        <section aria-label="Related wallet activity">
          {transactions.length ? (
            transactions.map((txid) => (
              <div className="wallet-party-activity" key={txid}>
                {recordLink(`tx:${txid}`)}
              </div>
            ))
          ) : (
            <p className="wallet-empty-note">No transactions in this wallet</p>
          )}
        </section>
      </details>
      {addresses.length > 0 && (
        <details className="wallet-related-records">
          <summary>Addresses ({addresses.length})</summary>
          <section aria-label="Contextual address evidence">
            {addresses.map(({ address, contexts }) => (
              <div className="wallet-party-address" key={address}>
                {recordLink(`addr:${address}`)}
                <span className="small muted">{contexts.join(' · ')}</span>
              </div>
            ))}
          </section>
        </details>
      )}
      {links.length > 0 && (
        <details className="wallet-related-records">
          <summary>Linked records ({links.length})</summary>
          {links.map((link, index) => {
            const id = link.kind === 'entity' ? link.subjectId : `tx:${link.transactionId}`;
            return (
              <div className="wallet-party-link" key={index}>
                {recordLink(id)}
                <div className="wallet-row-footer">
                  <span className="small muted">
                    <span>
                      {link.kind === 'entity'
                        ? 'Record'
                        : link.direction === 'received'
                          ? 'Received'
                          : 'Sent'}
                    </span>
                    {link.kind === 'wallet-transaction' && link.outputIds && (
                      <>
                        {' '}
                        · Outputs{' '}
                        {link.outputIds
                          .map((outputId) => outputId.slice(outputId.lastIndexOf(':') + 1))
                          .join(', ')}
                      </>
                    )}
                  </span>
                  <button
                    className="icon-button"
                    title="Remove association"
                    aria-label="Remove association"
                    disabled={!active || busy}
                    onClick={() => {
                      onChange((current) => removeCounterpartyLink(current, party.id, link));
                      setNotice('Counterparty association removed.');
                    }}
                  >
                    <Unlink size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </details>
      )}
      {confirmDelete && active && (
        <Modal
          title="Remove counterparty"
          className="compact-controls"
          fallbackFocusSelector='[aria-label="Counterparty actions"]'
          onClose={() => setConfirmDelete(false)}
        >
          <p>Remove {partyName(workspace, party)} and its associations?</p>
          <div className="button-row">
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                onChange((current) => removeCounterparty(current, party.id));
                onRemoved?.();
                setConfirmDelete(false);
                setNotice('Counterparty removed.');
              }}
            >
              Remove counterparty
            </button>
            <button onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </Modal>
      )}
      {notice && (
        <span role="status" className="wallet-review-notice">
          {notice}
        </span>
      )}
    </section>
  );
}
