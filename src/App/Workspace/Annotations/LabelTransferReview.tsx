import { useId, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  LabelChange,
  LabelExportPlan,
  LabelIssue,
} from '../../../Core/Workspace/Annotations/labels';

const PAGE_SIZE = 8;
const referenceNames: Record<string, string> = {
  tx: 'Transaction',
  addr: 'Address',
  out: 'Output',
  output: 'Output',
  xpub: 'Extended public key',
  input: 'Input',
  pubkey: 'Public key',
  spscan: 'Silent payment scan key',
};

function usePage(count: number) {
  const [page, setPage] = useState(0);
  const start = Math.min(
    page * PAGE_SIZE,
    Math.max(0, Math.ceil(count / PAGE_SIZE) - 1) * PAGE_SIZE,
  );
  return { start, end: Math.min(start + PAGE_SIZE, count), setPage };
}

function PageControls({
  count,
  start,
  end,
  setPage,
  noun,
}: ReturnType<typeof usePage> & { count: number; noun: string }) {
  return (
    <div className="label-page-controls">
      <span className="muted" role="status">
        {noun} {start + 1}–{end} of {count}
      </span>
      {count > PAGE_SIZE && (
        <div className="button-row">
          <button
            type="button"
            className="icon-button"
            aria-label={`Previous ${noun.toLowerCase()}`}
            disabled={!start}
            onClick={() => setPage(start / PAGE_SIZE - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Next ${noun.toLowerCase()}`}
            disabled={end === count}
            onClick={() => setPage(start / PAGE_SIZE + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Display excerpts as excerpts; the complete value is always available. */
function TextValue({ value, reference = false }: { value: string; reference?: boolean }) {
  if (!value) return <span className="muted">Empty</span>;
  const limit = reference ? 24 : 72;
  if (value.length <= limit && !value.includes('\n'))
    return <span className={reference ? 'label-reference' : 'label-preview-text'}>{value}</span>;
  const characters = Array.from(value);
  const excerpt = reference
    ? `${value.slice(0, 16)}…${value.slice(-8)}`
    : characters.slice(0, limit).join('').replaceAll('\n', ' ↵ ');
  return (
    <details className="label-full-value">
      <summary className={reference ? 'label-reference' : undefined}>
        <span className="label-value-excerpt">
          {excerpt}
          {!reference && characters.length > limit ? '…' : ''}
        </span>
      </summary>
      <span className={reference ? 'label-reference' : 'label-preview-text'}>{value}</span>
    </details>
  );
}

function EntryReference({
  id,
  recordType,
  line,
}: {
  id?: string;
  recordType?: string;
  line?: number;
}) {
  const colon = id?.indexOf(':') ?? -1;
  const type = recordType ?? id?.slice(0, colon);
  return (
    <div className="label-entry-reference">
      <span className="muted">
        {line ? `Line ${line}` : ''}
        {line && type ? ' · ' : ''}
        {type ? (referenceNames[type] ?? `${type.slice(0, 32)} label`) : ''}
      </span>
      {id && <TextValue value={id.slice(colon + 1)} reference />}
    </div>
  );
}

function ChangesTable({
  changes,
  exporting = false,
}: {
  changes: LabelChange[];
  exporting?: boolean;
}) {
  const page = usePage(changes.length);
  return (
    <>
      <div className="label-preview">
        <table
          className={`label-change-table${exporting ? '' : ' is-import'}`}
          aria-label={exporting ? 'Export text changes' : undefined}
        >
          {!exporting && <caption>Changes to apply</caption>}
          <thead>
            <tr>
              <th scope="col">Entry</th>
              <th scope="col">{exporting ? 'Original' : 'Current'}</th>
              <th scope="col">{exporting ? 'Exported' : 'After import'}</th>
            </tr>
          </thead>
          <tbody>
            {changes.slice(page.start, page.end).map((change, index) => (
              <tr key={`${change.id}:${change.target}:${page.start + index}`}>
                <td>
                  {change.target === 'walletName' ? (
                    <span>Wallet name{change.line ? ` · Line ${change.line}` : ''}</span>
                  ) : (
                    <>
                      <EntryReference id={change.id} line={change.line} />
                      {!exporting && (
                        <span className="muted">
                          {change.target === 'note'
                            ? 'Notes'
                            : change.target === 'tag'
                              ? 'Add tag'
                              : 'Label'}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="label-change-value" data-field={exporting ? 'Original' : 'Current'}>
                  <TextValue value={change.before} />
                </td>
                <td
                  className="label-change-value"
                  data-field={exporting ? 'Exported' : 'After import'}
                >
                  {change.after ? <TextValue value={change.after} /> : <span>Clear text</span>}
                  {!exporting && change.original !== change.after && (
                    <details className="label-text-source">
                      <summary>Original file text</summary>
                      <TextValue value={change.original} />
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PageControls {...page} count={changes.length} noun="Changes" />
    </>
  );
}

export function ImportChanges({ changes }: { changes: LabelChange[] }) {
  return changes.length ? <ChangesTable changes={changes} /> : null;
}

export function ExportFilePreview({
  plan,
  view,
  onViewChange,
}: {
  plan: LabelExportPlan;
  view: 'table' | 'jsonl';
  onViewChange: (view: 'table' | 'jsonl') => void;
}) {
  const id = useId();
  // This is the download's content, not a second export projection. Decode only
  // the visible page for the table; raw lines preserve their exact serialization.
  const lines = plan.content ? plan.content.split('\n') : [];
  const page = usePage(lines.length);
  if (plan.blocked || !lines.length) return null;
  const visible = lines.slice(page.start, page.end);
  return (
    <section className="label-file-preview" aria-label="Export file preview">
      <div className="label-preview-toolbar">
        <h3>File preview</h3>
        <div className="button-row label-view-switch" role="group" aria-label="Preview format">
          {(['table', 'jsonl'] as const).map((format) => (
            <button
              key={format}
              type="button"
              aria-pressed={view === format}
              aria-controls={id}
              onClick={() => onViewChange(format)}
            >
              {format === 'table' ? 'Table' : 'JSONL'}
            </button>
          ))}
        </div>
      </div>
      <div id={id} className="label-file-viewport label-preview">
        {view === 'table' ? (
          <table className="label-file-table" aria-label="Exported JSONL fields">
            <colgroup>
              <col className="label-type-column" />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                {['type', 'ref', 'label'].map((field) => (
                  <th scope="col" key={field}>
                    <code>{field}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((line, index) => {
                const record: { type: string; ref: string; label: string } = JSON.parse(line);
                return (
                  <tr key={page.start + index}>
                    <td>
                      <code>{record.type}</code>
                    </td>
                    <td>
                      <TextValue value={record.ref} reference />
                    </td>
                    <td>
                      <TextValue value={record.label} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <pre className="label-raw-preview" aria-label="Exported JSONL lines" tabIndex={0}>
            {visible.join('\n')}
          </pre>
        )}
      </div>
      <PageControls {...page} count={lines.length} noun="Records" />
      {!!plan.textChanges.length && (
        <details className="label-text-changes">
          <summary>Text changes ({plan.textChanges.length})</summary>
          <ChangesTable changes={plan.textChanges} exporting />
        </details>
      )}
    </section>
  );
}

const issueCopy: Record<LabelIssue['reason'], { title: string; hint: string }> = {
  malformed: {
    title: 'Invalid entries',
    hint: 'Fix these entries in the file, or export it again from the source app.',
  },
  unsupported: {
    title: 'Unsupported label types',
    hint: 'These label types cannot be imported with the selected source app.',
  },
  'no-label': { title: 'Missing label text', hint: 'These entries have no label text to import.' },
  'wrong-network': {
    title: 'Different Bitcoin network',
    hint: 'Use a file for this workspace’s Bitcoin network.',
  },
  scope: {
    title: 'Outside your selection',
    hint: 'Choose a broader scope or a different source account to include these entries.',
  },
  empty: {
    title: 'Empty label text',
    hint: 'These entries have no text to add. Existing text and tags are kept.',
  },
  length: {
    title: 'Text too long',
    hint: 'Enable shortening to review a shorter version, or edit the text in the source app.',
  },
  collision: {
    title: 'Names would become identical',
    hint: 'Rename these tags before importing so they stay separate.',
  },
  conflict: {
    title: 'Conflicting labels',
    hint: 'Compare the entries below, then choose a source account or which entry to use under Conflicting values.',
  },
  'tag-budget': {
    title: 'No room for more tags',
    hint: 'Remove unused tags or import fewer entries.',
  },
  kept: {
    title: 'Existing text kept',
    hint: 'Choose “Replace with imported text” above to use the file’s text instead.',
  },
  unchanged: {
    title: 'Already up to date',
    hint: 'This text or tag is already saved in your workspace.',
  },
};

function OutcomeEntries({ issues, importing }: { issues: LabelIssue[]; importing: boolean }) {
  const page = usePage(issues.length);
  return (
    <>
      <ul className="label-outcome-entries">
        {issues.slice(page.start, page.end).map((issue, index) => (
          <li key={page.start + index}>
            <EntryReference id={issue.id} recordType={issue.recordType} line={issue.line} />
            {(issue.reason === 'malformed' || issue.reason === 'length') && <p>{issue.detail}</p>}
            {issue.reason === 'conflict' && issue.source && (
              <dl className="label-conflict-text">
                <div>
                  <dt>{importing ? 'From file' : 'Exported text'}</dt>
                  <dd>
                    <TextValue value={issue.source.label} />
                  </dd>
                </div>
                {importing && (
                  <div>
                    <dt>Source account / origin</dt>
                    <dd>
                      {issue.source.origin ? (
                        <TextValue value={issue.source.origin} reference />
                      ) : (
                        <span className="muted">No origin in file</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {issue.reason === 'kept' && issue.text && (
              <dl className="label-kept-text">
                <div>
                  <dt>Current</dt>
                  <dd>
                    <TextValue value={issue.text.current} />
                  </dd>
                </div>
                <div>
                  <dt>From file</dt>
                  <dd>
                    <TextValue value={issue.text.incoming} />
                  </dd>
                </div>
              </dl>
            )}
          </li>
        ))}
      </ul>
      {issues.length > PAGE_SIZE && <PageControls {...page} count={issues.length} noun="Entries" />}
    </>
  );
}

export function TransferOutcomes({
  issues,
  ignoredFields = [],
  importing,
}: {
  issues: LabelIssue[];
  ignoredFields?: string[];
  importing: boolean;
}) {
  const [expanded, setExpanded] = useState<Partial<Record<LabelIssue['reason'], boolean>>>({});
  const groups = new Map<LabelIssue['reason'], LabelIssue[]>();
  for (const issue of issues) {
    if (!importing && issue.reason === 'scope') continue;
    const group = groups.get(issue.reason) ?? [];
    group.push(issue);
    groups.set(issue.reason, group);
  }
  if (!groups.size && !ignoredFields.length) return null;
  return (
    <section
      className="label-outcomes"
      aria-label={importing ? 'Import outcomes' : 'Values not exported'}
    >
      {[...groups].map(([reason, entries]) => (
        <details
          key={reason}
          className="label-outcome-group"
          open={expanded[reason] ?? false}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setExpanded((previous) =>
              previous[reason] === open ? previous : { ...previous, [reason]: open },
            );
          }}
        >
          <summary>
            <span>{issueCopy[reason].title}</span>
            <span className="muted">
              {entries.length}
              {reason === 'kept' || reason === 'unchanged'
                ? ''
                : importing
                  ? ' skipped'
                  : ' omitted'}
            </span>
          </summary>
          <div className="label-outcome-body">
            <p className="muted">
              {importing
                ? reason === 'unsupported' && entries.every((entry) => entry.recordType)
                  ? 'Chaingraph does not support labels for these items.'
                  : issueCopy[reason].hint
                : reason === 'unsupported'
                  ? 'The selected destination does not use these label types.'
                  : reason === 'conflict'
                    ? 'These labels share an exported reference. Give them one matching value before exporting.'
                    : reason === 'collision'
                      ? 'Rename these tags before exporting so they stay separate.'
                      : reason === 'length'
                        ? 'Enable shortening to review a shorter version for this destination.'
                        : 'These values cannot be exported. Check their references or choose another destination.'}
            </p>
            <OutcomeEntries issues={entries} importing={importing} />
          </div>
        </details>
      ))}
      {!!ignoredFields.length && (
        <details className="label-other-fields">
          <summary>Other file fields</summary>
          <p className="muted">Additional fields are not imported: {ignoredFields.join(', ')}.</p>
        </details>
      )}
    </section>
  );
}
