import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkspaceController } from '../useWorkspace';
import { Modal } from '../../Dialogs/Modal';
import { hasPublicDemoWallet } from '../../Examples/workspaceTemplates';
import { WalletHelp as HelpTooltip } from '../../Controls/Display/WalletHelp';
import {
  LABEL_PROFILES,
  type LabelScope,
  type LabelProfile,
  type LabelImportOptions,
  type LabelExportOptions,
} from '../../../Core/Workspace/Annotations/labels';
import { ExportFilePreview, ImportChanges, TransferOutcomes } from './LabelTransferReview';
import './label-exchange.css';

const exampleProfiles: LabelProfile[] = ['sparrow', 'keeper', 'btcpay', 'bluewallet', 'generic'];

function SettingTitle({
  label,
  hint,
  htmlFor,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <span className="label-setting-title">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {hint && <HelpTooltip title={label + ' help'}>{hint}</HelpTooltip>}
    </span>
  );
}

/** Reserve the last preview's height while its replacement is being prepared. */
function PreviewRegion({ busy, children }: { busy: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const region = ref.current;
    if (busy || !region) return;
    const measure = () =>
      region.style.setProperty(
        '--label-preview-height',
        `${region.getBoundingClientRect().height}px`,
      );
    measure();
    // Native details expansion and viewport wrapping can change height without
    // a React render. Keep the placeholder in step with those changes too.
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, [busy]);
  return (
    <div ref={ref} className={`label-review${busy ? ' is-loading' : ''}`} aria-busy={busy}>
      {busy ? (
        <div className="label-preview-loading" role="status">
          <span className="muted">Updating preview…</span>
          <div className="label-preview-skeleton" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div key={row}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function ScopeField({
  workspace,
  scope,
  onChange,
  keeper,
}: {
  workspace: WorkspaceController;
  scope: LabelScope;
  onChange: (scope: LabelScope) => void;
  keeper?: boolean;
}) {
  const wallets = workspace.activeWorkspace!.wallets.definitions;
  const ids = workspace.selection.batch.ids.length
    ? workspace.selection.batch.ids
    : workspace.selection.selectedId
      ? [workspace.selection.selectedId]
      : [];
  const value = scope.kind === 'wallet' ? `wallet:${scope.walletId}` : scope.kind;
  return (
    <label>
      Scope
      <select
        value={value}
        onChange={(event) => {
          const value = event.target.value;
          onChange(
            value.startsWith('wallet:')
              ? { kind: 'wallet', walletId: value.slice(7) }
              : value === 'selection'
                ? { kind: 'selection', ids }
                : { kind: 'workspace' },
          );
        }}
      >
        {!keeper && <option value="workspace">Whole workspace</option>}
        {!keeper && (
          <option value="selection" disabled={!ids.length}>
            Selected entities ({ids.length})
          </option>
        )}
        {keeper && !wallets.length && <option value="wallet:">No wallet in this workspace</option>}
        {wallets.map((wallet) => (
          <option key={wallet.id} value={`wallet:${wallet.id}`}>
            {wallet.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfileField({
  value,
  onChange,
  network,
  label,
}: {
  value: LabelProfile;
  onChange: (value: LabelProfile) => void;
  network: string;
  label: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as LabelProfile)}>
        {LABEL_PROFILES.map((profile) => (
          <option
            key={profile.id}
            value={profile.id}
            disabled={profile.id === 'bluewallet' && network !== 'mainnet'}
          >
            {profile.name}
            {profile.id === 'bluewallet' && network !== 'mainnet' ? ' (mainnet only)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImportSettings({
  options,
  onChange,
  hasKeys,
  origins,
}: {
  options: LabelImportOptions;
  onChange: (options: Partial<LabelImportOptions>) => void;
  hasKeys: boolean;
  origins: string[];
}) {
  const id = useId();
  const notes = ['bluewallet', 'keeper'].includes(options.profile);
  return (
    <section className="label-settings" aria-label="Import mapping">
      <h3>Mapping</h3>
      {notes ? (
        <div className="label-setting-row">
          <SettingTitle
            label="Transaction memos / notes"
            htmlFor={id + '-transactions'}
            hint="Save the source wallet's transaction text in Chaingraph Notes or Labels. Notes hold longer descriptions; Labels are short names shown beside transactions."
          />
          <select
            id={id + '-transactions'}
            value={options.transactionText}
            onChange={(event) =>
              onChange({ transactionText: event.target.value as 'profile' | 'label' })
            }
          >
            <option value="profile">Save as Chaingraph Notes</option>
            <option value="label">Save as Chaingraph labels</option>
          </select>
        </div>
      ) : (
        <dl className="label-mapping-values">
          <div>
            <dt>
              <SettingTitle
                label="File label text"
                hint={
                  options.profile === 'btcpay'
                    ? 'Each BTCPay label becomes one Chaingraph tag. Repeated records add multiple tags to the same transaction, address or output.'
                    : 'Each transaction, address, output or key label is saved as a Chaingraph label. Punctuation stays part of the label; it is not split into tags.'
                }
              />
            </dt>
            <dd>
              {options.profile === 'btcpay'
                ? options.combineTagLabels
                  ? 'Save as tags and create a combined label'
                  : 'Save as Chaingraph tags'
                : 'Save as Chaingraph labels'}
            </dd>
          </div>
        </dl>
      )}
      {options.profile === 'keeper' && (
        <dl className="label-mapping-values">
          <div>
            <dt>
              <SettingTitle
                label="Address / output labels"
                hint="Keeper supports multiple labels on an address or output. Each one becomes a Chaingraph tag, keeping the collection intact."
              />
            </dt>
            <dd>
              {options.combineTagLabels
                ? 'Save as tags and create a combined label'
                : 'Save as Chaingraph tags'}
            </dd>
          </div>
        </dl>
      )}
      <div className="label-setting-row">
        <SettingTitle
          label="Existing labels / Notes"
          htmlFor={id + '-existing'}
          hint="Keep preserves nonempty text and fills empty fields. Replace uses the imported text. Tags are added to existing tags in either mode; clearing text requires the separate option below."
        />
        <select
          id={id + '-existing'}
          value={options.existingText}
          onChange={(event) => onChange({ existingText: event.target.value as 'keep' | 'replace' })}
        >
          <option value="keep">Keep existing text</option>
          <option value="replace">Replace with imported text</option>
        </select>
      </div>
      <details className="label-options">
        <summary>More options</summary>
        <div className="label-options-body">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={options.applyClears}
              onChange={(event) => onChange({ applyClears: event.target.checked })}
            />
            Clear labels / Notes when the file contains empty text
          </label>
          {['btcpay', 'keeper'].includes(options.profile) && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.combineTagLabels}
                onChange={(event) => onChange({ combineTagLabels: event.target.checked })}
              />
              Create labels from imported tags
            </label>
          )}
          {hasKeys && ['generic', 'sparrow'].includes(options.profile) && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.renameWallets}
                onChange={(event) => onChange({ renameWallets: event.target.checked })}
              />
              Rename matching wallets from key labels
            </label>
          )}
          {!!origins.length && (
            <>
              <label className="label-setting-row">
                <span>Source account</span>
                <select
                  value={options.origin ?? '*'}
                  onChange={(event) =>
                    onChange({
                      origin: event.target.value === '*' ? undefined : event.target.value,
                    })
                  }
                >
                  <option value="*">All accounts</option>
                  <option value="">Records without origin</option>
                  {origins.map((origin) => (
                    <option key={origin} value={origin}>
                      {origin.length > 90 ? origin.slice(0, 90) + '…' : origin}
                    </option>
                  ))}
                </select>
              </label>
              {options.origin && <code className="label-origin">{options.origin}</code>}
            </>
          )}
        </div>
      </details>
    </section>
  );
}

function ExportSettings({
  options,
  onChange,
}: {
  options: LabelExportOptions;
  onChange: (options: Partial<LabelExportOptions>) => void;
}) {
  const id = useId();
  const notes = ['bluewallet', 'keeper'].includes(options.profile);
  return (
    <section className="label-settings" aria-label="Export content">
      <h3>Content</h3>
      {notes ? (
        <div className="label-setting-row">
          <SettingTitle
            label="Transaction memos / notes"
            htmlFor={id + '-transactions'}
            hint="Choose which Chaingraph field supplies the destination wallet's transaction memo or note. With Notes selected, a transaction's label is used when its Note is empty."
          />
          <select
            id={id + '-transactions'}
            value={options.transactionText}
            onChange={(event) =>
              onChange({ transactionText: event.target.value as 'note' | 'label' })
            }
          >
            <option value="note">Use Notes, then labels if empty</option>
            <option value="label">Use Chaingraph labels</option>
          </select>
        </div>
      ) : (
        <dl className="label-mapping-values">
          <div>
            <dt>
              <SettingTitle
                label={options.profile === 'btcpay' ? 'BTCPay labels' : 'Labels to export'}
                hint={
                  options.profile === 'btcpay'
                    ? 'Each Chaingraph tag is exported as a separate label for BTCPay. Several tags on one transaction, address or output produce several records.'
                    : 'Export Chaingraph labels on transactions, addresses and outputs. Notes are not included. Public-key labels can be included under More options.'
                }
              />
            </dt>
            <dd>
              {options.profile === 'btcpay'
                ? options.includeEntityLabels
                  ? 'Use Chaingraph tags and labels'
                  : 'Use Chaingraph tags'
                : options.includeKeyLabels
                  ? 'Transaction, address, output and key labels'
                  : 'Transaction, address and output labels'}
            </dd>
          </div>
        </dl>
      )}
      {options.profile === 'keeper' && (
        <dl className="label-mapping-values">
          <div>
            <dt>
              <SettingTitle
                label="Address / output labels"
                hint="Each Chaingraph tag becomes one Keeper label. Multiple tags are exported as separate records for the same address or output."
              />
            </dt>
            <dd>
              {options.includeEntityLabels
                ? 'Use Chaingraph tags and labels'
                : 'Use Chaingraph tags'}
            </dd>
          </div>
        </dl>
      )}
      {options.profile !== 'btcpay' && (
        <div className="label-setting-row">
          <SettingTitle
            label={notes ? 'Add tags to memos / notes' : 'Add tags to labels'}
            htmlFor={id + '-tags'}
            hint={
              'Append tag names in brackets, for example: Shop payment [business, reviewed]. ' +
              (notes ? 'This applies to transaction memos / notes. ' : '') +
              'The destination receives one text string. Re-importing it does not recreate separate tags.'
            }
          />
          <select
            id={id + '-tags'}
            value={options.includeTagsInLabels ? 'append' : 'omit'}
            onChange={(event) => onChange({ includeTagsInLabels: event.target.value === 'append' })}
          >
            <option value="omit">No</option>
            <option value="append">Yes, append tag names</option>
          </select>
        </div>
      )}
      {options.profile !== 'bluewallet' && (
        <details className="label-options">
          <summary>More options</summary>
          <div className="label-options-body">
            {['btcpay', 'keeper'].includes(options.profile) && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={options.includeEntityLabels}
                  onChange={(event) => onChange({ includeEntityLabels: event.target.checked })}
                />
                Include labels as additional tag records
              </label>
            )}
            {['generic', 'sparrow'].includes(options.profile) && (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={options.includeKeyLabels}
                    onChange={(event) => onChange({ includeKeyLabels: event.target.checked })}
                  />
                  Include key labels and extended public keys
                </label>
                {options.includeKeyLabels && (
                  <label className="checkbox label-dependent-option">
                    <input
                      type="checkbox"
                      checked={options.walletNameFallback}
                      onChange={(event) => onChange({ walletNameFallback: event.target.checked })}
                    />
                    Use wallet names when a key label is missing
                  </label>
                )}
              </>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

export function LabelExchangeDialog({ workspace }: { workspace: WorkspaceController }) {
  const [exportView, setExportView] = useState<'table' | 'jsonl'>('table');
  const { annotations, activeWorkspace } = workspace;
  const transfer = annotations.labelTransfer;
  if (!activeWorkspace || !transfer) return null;
  const importing = transfer.kind === 'import';
  const profile = transfer.options.profile;
  const importPlan = annotations.importPlan,
    exportPlan = annotations.exportPlan;
  const issues = (importing ? importPlan?.issues : exportPlan?.issues) ?? [];
  const hasLength = issues.some((issue) => issue.reason === 'length') || transfer.options.shorten;
  const conflicts = issues.some((issue) => issue.reason === 'conflict');
  const appliedLines = new Set(importPlan?.changes.map((change) => change.line));
  const excluded = importing
    ? new Set(
        issues
          .filter(
            (issue) =>
              issue.reason !== 'kept' &&
              issue.reason !== 'unchanged' &&
              !appliedLines.has(issue.line),
          )
          .map((issue) => issue.line),
      ).size
    : issues.filter((issue) => issue.reason !== 'scope').length;
  const kept = importing
    ? new Set(issues.filter((issue) => issue.reason === 'kept').map((issue) => issue.line)).size
    : 0;
  const textChanges = importPlan?.changes.filter((change) => change.target !== 'tag').length ?? 0;
  const tagChanges = importPlan?.changes.filter((change) => change.target === 'tag').length ?? 0;
  const configureImport = annotations.configureLabelImport,
    configureExport = annotations.configureLabelExport;
  return (
    <Modal
      title={importing ? 'Import BIP329 metadata' : 'Export BIP329 metadata'}
      onClose={annotations.closeLabelTransfer}
      className="label-exchange compact-controls"
    >
      <div className="label-exchange-body">
        <section
          className="label-setup"
          aria-label={importing ? 'Import source' : 'Export destination'}
        >
          {transfer.kind === 'import' && (
            <>
              <div className="label-file-row">
                <button type="button" onClick={annotations.pickLabelFile} disabled={transfer.busy}>
                  {transfer.filename ? 'Change file' : 'Choose JSONL file'}
                </button>
                <span className={transfer.filename ? undefined : 'muted'}>
                  {transfer.filename ?? 'No file selected'}
                </span>
              </div>
              {!transfer.filename && hasPublicDemoWallet(activeWorkspace) && (
                <details className="label-examples">
                  <summary>Example files for the public demo wallet</summary>
                  <div className="label-example-files">
                    {exampleProfiles.map((exampleProfile) => (
                      <a
                        key={exampleProfile}
                        href={`/examples/bip329/${exampleProfile}.jsonl`}
                        download
                      >
                        {LABEL_PROFILES.find((item) => item.id === exampleProfile)!.name}
                      </a>
                    ))}
                    <a href="/examples/bip329/review-cases.jsonl" download>
                      Conflicts / errors
                    </a>
                  </div>
                </details>
              )}
            </>
          )}
          <div className="label-exchange-fields">
            <ProfileField
              value={profile}
              network={activeWorkspace.network}
              label={importing ? 'Source app' : 'Destination app'}
              onChange={(value) =>
                importing
                  ? configureImport({ profile: value })
                  : configureExport({ profile: value })
              }
            />
            <ScopeField
              workspace={workspace}
              scope={transfer.options.scope}
              keeper={!importing && profile === 'keeper'}
              onChange={(scope) =>
                importing ? configureImport({ scope }) : configureExport({ scope })
              }
            />
            {transfer.kind === 'import' ? (
              <label>
                <span>Source network</span>
                <select
                  value={transfer.options.sourceNetwork}
                  onChange={(event) =>
                    configureImport({ sourceNetwork: event.target.value as 'mainnet' | 'testnet4' })
                  }
                >
                  <option value="mainnet">Mainnet</option>
                  <option value="testnet4">Testnet4</option>
                </select>
              </label>
            ) : (
              <span className="label-network muted">
                {activeWorkspace.network === 'mainnet' ? 'Mainnet' : 'Testnet4'}
              </span>
            )}
          </div>
          {transfer.kind === 'import' &&
            transfer.options.sourceNetwork !== activeWorkspace.network && (
              <p className="error-text" role="alert">
                Choose {activeWorkspace.network === 'mainnet' ? 'Mainnet' : 'Testnet4'} to match
                this workspace.
              </p>
            )}
          {!importing && profile === 'keeper' && (
            <p className="muted">Import into the matching wallet in Keeper.</p>
          )}
        </section>
        {transfer.kind === 'import' ? (
          <>
            <ImportSettings
              options={transfer.options}
              onChange={configureImport}
              hasKeys={!!transfer.inspection?.records.some((row) => row.type === 'xpub')}
              origins={transfer.inspection?.origins ?? []}
            />
            {!!transfer.filename && (
              <PreviewRegion busy={!!transfer.busy || annotations.previewBusy}>
                {transfer.failure && (
                  <p className="error-text" role="alert">
                    {transfer.failure}
                  </p>
                )}
                {annotations.previewError && (
                  <p className="error-text" role="alert">
                    {annotations.previewError}
                  </p>
                )}
                {importPlan && (
                  <>
                    <p className="label-summary" role="status">
                      <strong>
                        {importPlan.changes.length
                          ? [
                              textChanges &&
                                `${textChanges} text change${textChanges === 1 ? '' : 's'}`,
                              tagChanges &&
                                `${tagChanges} tag addition${tagChanges === 1 ? '' : 's'}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : 'No changes to apply'}
                      </strong>
                      {!!kept && (
                        <span className="muted">
                          {' '}
                          · {kept} existing value{kept === 1 ? '' : 's'} kept
                        </span>
                      )}
                      {!!excluded && (
                        <span className="label-excluded">
                          {' '}
                          · {excluded} entr{excluded === 1 ? 'y' : 'ies'} skipped
                        </span>
                      )}
                    </p>
                    {!!importPlan.unmatched && (
                      <p className="muted">
                        {importPlan.unmatched} references are not loaded in this workspace.
                      </p>
                    )}
                    {(conflicts || transfer.options.conflicts !== 'exclude') && (
                      <label className="label-setting-row">
                        <span>Conflicting values</span>
                        <select
                          value={transfer.options.conflicts}
                          onChange={(event) =>
                            configureImport({
                              conflicts: event.target.value as 'exclude' | 'first' | 'last',
                            })
                          }
                        >
                          <option value="exclude">Exclude unresolved conflicts</option>
                          <option value="first">Use first source value</option>
                          <option value="last">Use last source value</option>
                        </select>
                      </label>
                    )}
                    <ImportChanges changes={importPlan.changes} />
                  </>
                )}
                {hasLength && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={transfer.options.shorten}
                      onChange={(event) => configureImport({ shorten: event.target.checked })}
                    />
                    Shorten over-limit values
                  </label>
                )}
                <TransferOutcomes
                  issues={issues}
                  ignoredFields={transfer.inspection?.ignoredFields}
                  importing
                />
              </PreviewRegion>
            )}
          </>
        ) : (
          <>
            <ExportSettings options={transfer.options} onChange={configureExport} />
            <PreviewRegion busy={annotations.previewBusy}>
              {annotations.previewError && (
                <p className="error-text" role="alert">
                  {annotations.previewError}
                </p>
              )}
              {exportPlan && (
                <>
                  <p className="label-summary" role="status">
                    <strong>{exportPlan.recordCount} records</strong>
                    <span className="muted"> · {Math.ceil(exportPlan.bytes / 1000)} KB</span>
                    {!!excluded && (
                      <span className="label-excluded">
                        {' '}
                        · {excluded} value{excluded === 1 ? '' : 's'} omitted
                      </span>
                    )}
                  </p>
                  {exportPlan.blocked && (
                    <p className="error-text" role="alert">
                      {exportPlan.blocked}
                    </p>
                  )}
                  {!exportPlan.blocked && !exportPlan.recordCount && (
                    <p className="muted">No text to export with these settings.</p>
                  )}
                  <ExportFilePreview
                    plan={exportPlan}
                    view={exportView}
                    onViewChange={setExportView}
                  />
                </>
              )}
              {hasLength && (
                <div className="label-length-option">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={transfer.options.shorten}
                      onChange={(event) => configureExport({ shorten: event.target.checked })}
                    />
                    Shorten over-limit values for this destination
                  </label>
                  <span className="muted">Full text stays in Chaingraph.</span>
                </div>
              )}
              <TransferOutcomes issues={issues} importing={false} />
            </PreviewRegion>
          </>
        )}
      </div>
      <div className="button-row label-exchange-actions">
        <button type="button" onClick={annotations.closeLabelTransfer}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            importing
              ? !importPlan?.changes.length || (transfer.kind === 'import' && transfer.busy)
              : !exportPlan?.recordCount || !!exportPlan.blocked
          }
          onClick={importing ? annotations.confirmLabelImport : annotations.downloadLabelExport}
        >
          {importing ? 'Apply import' : 'Download JSONL'}
        </button>
      </div>
    </Modal>
  );
}
