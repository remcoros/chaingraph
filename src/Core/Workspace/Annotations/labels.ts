import {
  MAX_ANNOTATION_LABEL_LENGTH,
  MAX_ANNOTATION_NOTE_LENGTH,
  MAX_TAG_NAME_LENGTH,
  MAX_TAG_MEMBERS,
  MAX_WORKSPACE_TAGS,
  parseWorkspaceTags,
} from './annotations';
import { emptyAnnotation } from './emptyAnnotation';
import type { Workspace } from '../workspace';
import { canonicalEntityReference } from '../entityReferences';
import type { Network } from '../../Bitcoin';
import { MAX_WALLET_NAME_LENGTH } from '../Wallets/wallets';
import {
  inspectLabelRecords,
  MAX_LABEL_FILE_BYTES,
  MAX_LABEL_RECORDS,
  shortenLabel,
  type LabelInspection,
  type LabelIssue,
  type LabelRecord,
} from './labelRecords';
import {
  knownLabelReference,
  labelScopeIds,
  createLabelKeyMatcher,
  type LabelScope,
} from './labelScope';

export { MAX_LABEL_FILE_BYTES, MAX_LABEL_RECORDS } from './labelRecords';
export type { LabelInspection, LabelIssue } from './labelRecords';
export type { LabelScope } from './labelScope';
export const inspectLabels = inspectLabelRecords;
export type LabelProfile = 'generic' | 'sparrow' | 'btcpay' | 'bluewallet' | 'keeper';
export const LABEL_PROFILES: { id: LabelProfile; name: string; mapping: string }[] = [
  { id: 'generic', name: 'Generic BIP329', mapping: 'Literal entity labels' },
  { id: 'sparrow', name: 'Sparrow', mapping: 'Literal entity labels' },
  { id: 'btcpay', name: 'BTCPay Server', mapping: 'Labels become tags' },
  { id: 'bluewallet', name: 'BlueWallet', mapping: 'Transaction memos become Notes' },
  { id: 'keeper', name: 'Bitcoin Keeper', mapping: 'Transaction Notes; address/output tags' },
];
export interface LabelImportOptions {
  profile: LabelProfile;
  scope: LabelScope;
  sourceNetwork: Network;
  existingText: 'keep' | 'replace';
  conflicts: 'exclude' | 'first' | 'last';
  applyClears: boolean;
  shorten: boolean;
  origin?: string;
  transactionText: 'profile' | 'label';
  combineTagLabels: boolean;
  renameWallets: boolean;
}
export interface LabelExportOptions {
  profile: LabelProfile;
  scope: LabelScope;
  includeKeyLabels: boolean;
  walletNameFallback: boolean;
  includeEntityLabels: boolean;
  includeTagsInLabels: boolean;
  transactionText: 'note' | 'label';
  shorten: boolean;
}
export function defaultLabelImportOptions(
  network: Network,
  scope: LabelScope = { kind: 'workspace' },
): LabelImportOptions {
  return {
    profile: 'generic',
    scope,
    sourceNetwork: network,
    existingText: 'keep',
    conflicts: 'exclude',
    applyClears: false,
    shorten: false,
    transactionText: 'profile',
    combineTagLabels: false,
    renameWallets: false,
  };
}
export function defaultLabelExportOptions(
  scope: LabelScope = { kind: 'workspace' },
): LabelExportOptions {
  return {
    profile: 'generic',
    scope,
    includeKeyLabels: false,
    walletNameFallback: false,
    includeEntityLabels: false,
    includeTagsInLabels: false,
    transactionText: 'note',
    shorten: false,
  };
}
export interface LabelChange {
  id: string;
  target: 'label' | 'note' | 'tag' | 'walletName';
  before: string;
  after: string;
  original: string;
  line?: number;
}
export interface LabelImportPlan {
  source: Workspace;
  next: Workspace;
  changes: LabelChange[];
  issues: LabelIssue[];
  recordCount: number;
  unmatched: number;
}
export interface LabelExportPlan {
  content: string;
  recordCount: number;
  bytes: number;
  byteLimit: number;
  issues: LabelIssue[];
  textChanges: LabelChange[];
  blocked?: string;
}
function supported(profile: LabelProfile, type: string): boolean {
  if (profile === 'bluewallet') return type === 'tx';
  return !(['btcpay', 'keeper'].includes(profile) && type === 'xpub');
}
function tagMapping(profile: LabelProfile, type: string): boolean {
  return profile === 'btcpay' || (profile === 'keeper' && (type === 'addr' || type === 'output'));
}
function importTarget(options: LabelImportOptions, type: string): 'label' | 'note' | 'tag' {
  if (tagMapping(options.profile, type)) return 'tag';
  return options.transactionText !== 'label' &&
    type === 'tx' &&
    ['bluewallet', 'keeper'].includes(options.profile)
    ? 'note'
    : 'label';
}
function keyAnnotationResolver(
  workspace: Workspace,
  keys: ReturnType<typeof createLabelKeyMatcher>,
) {
  const annotations = new Map<string, { id: string; policy: string | undefined }[]>();
  for (const id of Object.keys(workspace.annotations.entities)) {
    if (!id.startsWith('xpub:')) continue;
    try {
      const stored = keys.parse(id.slice(5)),
        group = annotations.get(stored.bip32Key) ?? [];
      group.push({ id, policy: stored.encoding.script });
      annotations.set(stored.bip32Key, group);
    } catch {
      /* Invalid legacy annotations do not establish key identity. */
    }
  }
  const resolved = new Map<string, string>();
  return (key: string) => {
    let id = resolved.get(key);
    if (id) return id;
    const incoming = keys.parse(key),
      wallets = keys.matching(key);
    const policy = incoming.encoding.script ?? wallets[0]?.scriptType;
    id =
      new Set(wallets.map((wallet) => wallet.scriptType)).size > 1
        ? `xpub:${key}`
        : (annotations
            .get(incoming.bip32Key)
            ?.find((annotation) => !annotation.policy || !policy || annotation.policy === policy)
            ?.id ?? `xpub:${wallets[0]?.key ?? key}`);
    resolved.set(key, id);
    return id;
  };
}

/** Plan the entire annotation/tag/wallet edit without touching live state. */
export function planLabelImport(
  workspace: Workspace,
  inspection: LabelInspection,
  options: LabelImportOptions,
): LabelImportPlan {
  const issues = [...inspection.issues];
  const changes: LabelChange[] = [];
  const unchanged = (): LabelImportPlan => ({
    source: workspace,
    next: workspace,
    changes,
    issues,
    recordCount: inspection.recordCount,
    unmatched: 0,
  });
  if (
    inspection.network !== workspace.network ||
    options.sourceNetwork !== workspace.network ||
    (options.profile === 'bluewallet' && workspace.network !== 'mainnet')
  ) {
    issues.push(
      ...inspection.records.map((row) => ({
        line: row.line,
        reason: 'wrong-network' as const,
        detail: 'Source profile/network does not match this workspace.',
      })),
    );
    return unchanged();
  }
  const keys = createLabelKeyMatcher(workspace),
    keyId = keyAnnotationResolver(workspace, keys);
  const scoped = labelScopeIds(
    workspace,
    inspection.records.map((row) => row.id),
    options.scope,
    keys,
  );
  const rows: LabelRecord[] = [];
  const sourceIds = new Map<number, string>();
  for (const row of inspection.records) {
    sourceIds.set(row.line, row.id);
    if (!supported(options.profile, row.type))
      issues.push({
        line: row.line,
        id: row.id,
        reason: 'unsupported',
        detail: 'This profile does not exchange this record type.',
      });
    else if (
      !scoped.has(row.id) ||
      (options.origin !== undefined && (row.origin ?? '') !== options.origin)
    )
      issues.push({
        line: row.line,
        id: row.id,
        reason: 'scope',
        detail: 'Outside the selected scope or account/origin.',
      });
    else if (
      !row.label.trim() &&
      (!options.applyClears || importTarget(options, row.type) === 'tag')
    )
      issues.push({
        line: row.line,
        id: row.id,
        reason: 'empty',
        detail:
          'Empty value skipped. Text clears are explicit; empty tags cannot clear memberships.',
      });
    else rows.push({ ...row, id: row.type === 'xpub' ? keyId(row.id.slice(5)) : row.id });
  }
  const entities = { ...workspace.annotations.entities };
  const tags = (workspace.annotations.tags ?? []).map((tag) => ({
    ...tag,
    nodeIds: [...tag.nodeIds],
  }));
  let wallets = workspace.wallets.definitions;
  const textRows = new Map<string, LabelRecord[]>();
  const tagRows: LabelRecord[] = [];
  for (const row of rows) {
    if (importTarget(options, row.type) === 'tag') tagRows.push(row);
    else {
      const group = textRows.get(row.id) ?? [];
      group.push(row);
      textRows.set(row.id, group);
    }
  }
  const writeText = (row: LabelRecord, target: 'label' | 'note', original: string) => {
    const limit = target === 'note' ? MAX_ANNOTATION_NOTE_LENGTH : MAX_ANNOTATION_LABEL_LENGTH;
    if (original.length > limit && !options.shorten) {
      issues.push({
        line: row.line,
        id: row.id,
        reason: 'length',
        detail: `${target === 'note' ? 'Note' : 'Label'} is longer than ${limit.toLocaleString('en-US')} characters.`,
      });
      return;
    }
    const after = options.shorten ? shortenLabel(original, limit) : original;
    const annotation = entities[row.id] ?? emptyAnnotation;
    const before = annotation[target];
    if (before === after || (after.trim() && before.trim() && options.existingText === 'keep')) {
      issues.push({
        line: row.line,
        id: row.id,
        reason: before === after ? 'unchanged' : 'kept',
        detail: before === after ? 'Value already matches.' : 'Existing text preserved.',
        text: { current: before, incoming: after },
      });
      return;
    }
    entities[row.id] = { ...annotation, [target]: after };
    changes.push({ id: row.id, target, before, after, original, line: row.line });
  };
  for (const group of textRows.values()) {
    if (new Set(group.map((row) => row.label)).size > 1 && options.conflicts === 'exclude') {
      issues.push(
        ...group.map((row) => ({
          line: row.line,
          id: row.id,
          reason: 'conflict' as const,
          detail: 'Several source values. Select an account/origin or choose first/last.',
        })),
      );
      continue;
    }
    const row = options.conflicts === 'last' ? group[group.length - 1] : group[0];
    const target = importTarget(options, row.type);
    if (target !== 'tag') writeText(row, target, row.label);
    if (row.type === 'xpub' && options.renameWallets && row.label.trim()) {
      // Annotation identity may use an equivalent encoding. The source key's
      // explicit script policy still governs which wallets may be renamed.
      const matches = keys.matching(sourceIds.get(row.line)!.slice(5));
      if (new Set(matches.map((wallet) => wallet.scriptType)).size > 1) {
        issues.push({
          line: row.line,
          id: row.id,
          reason: 'conflict',
          detail: 'Key matches several wallet script policies; names are kept.',
        });
        continue;
      }
      if (row.label.trim().length > MAX_WALLET_NAME_LENGTH && !options.shorten) continue;
      const after = options.shorten
        ? shortenLabel(row.label.trim(), MAX_WALLET_NAME_LENGTH)
        : row.label.trim();
      wallets = wallets.map((wallet) => {
        if (!matches.some((match) => match.id === wallet.id) || wallet.name === after)
          return wallet;
        changes.push({
          id: wallet.id,
          target: 'walletName',
          before: wallet.name,
          after,
          original: row.label,
          line: row.line,
        });
        return { ...wallet, name: after };
      });
    }
  }
  const names = new Map<string, Set<string>>();
  for (const row of tagRows) {
    const original = row.label.trim();
    const name = (
      options.shorten ? shortenLabel(original, MAX_TAG_NAME_LENGTH) : original
    ).toLowerCase();
    const originals = names.get(name) ?? new Set<string>();
    originals.add(original.toLowerCase());
    names.set(name, originals);
  }
  let memberships = tags.reduce((count, tag) => count + tag.nodeIds.length, 0);
  const combined = new Map<string, LabelRecord[]>();
  for (const row of tagRows) {
    const original = row.label.trim();
    const name = options.shorten ? shortenLabel(original, MAX_TAG_NAME_LENGTH) : original;
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (original.length > MAX_TAG_NAME_LENGTH && !options.shorten) {
      issues.push({
        line: row.line,
        id: row.id,
        reason: 'length',
        detail: `Tag name is longer than ${MAX_TAG_NAME_LENGTH} characters.`,
      });
      continue;
    }
    if (
      (names.get(name.toLowerCase())?.size ?? 0) > 1 ||
      (original !== name && existing && existing.name.toLowerCase() !== original.toLowerCase())
    ) {
      issues.push({
        line: row.line,
        id: row.id,
        reason: 'collision',
        detail: 'Shortening merges distinct tag names. Rename in the source or narrow scope.',
      });
      continue;
    }
    if (existing?.nodeIds.includes(row.id))
      issues.push({
        line: row.line,
        id: row.id,
        reason: 'unchanged',
        detail: 'Tag membership already exists.',
      });
    else {
      if ((!existing && tags.length >= MAX_WORKSPACE_TAGS) || memberships >= MAX_TAG_MEMBERS) {
        issues.push({
          line: row.line,
          id: row.id,
          reason: 'tag-budget',
          detail: 'Workspace tag or membership budget reached.',
        });
        continue;
      }
      const tag = existing ?? { id: crypto.randomUUID(), name, color: '#72b7d2', nodeIds: [] };
      if (!existing) tags.push(tag);
      tag.nodeIds.push(row.id);
      memberships++;
      changes.push({
        id: row.id,
        target: 'tag',
        before: '',
        after: name,
        original,
        line: row.line,
      });
    }
    const group = combined.get(row.id) ?? [];
    group.push({ ...row, label: name });
    combined.set(row.id, group);
  }
  if (options.combineTagLabels)
    for (const group of combined.values())
      writeText(group[0], 'label', [...new Set(group.map((row) => row.label))].join(', '));
  const unmatched = new Set(
    rows.filter((row) => !knownLabelReference(workspace, row.id, keys)).map((row) => row.id),
  ).size;
  if (!changes.length) return { ...unchanged(), unmatched };
  const next: Workspace = {
    ...workspace,
    annotations: {
      ...workspace.annotations,
      entities,
      tags: parseWorkspaceTags(tags, workspace.network),
    },
    wallets: { ...workspace.wallets, definitions: wallets },
  };
  return {
    source: workspace,
    next,
    changes,
    issues,
    recordCount: inspection.recordCount,
    unmatched,
  };
}

/** Apply exactly the reviewed metadata in one workspace mutation. */
export function applyLabelImport(workspace: Workspace, plan: LabelImportPlan): Workspace {
  if (
    workspace.id !== plan.source.id ||
    workspace.network !== plan.source.network ||
    workspace.annotations !== plan.source.annotations ||
    workspace.wallets.definitions !== plan.source.wallets.definitions ||
    workspace.chainData.transactions !== plan.source.chainData.transactions ||
    workspace.chainData.watchedAddresses !== plan.source.chainData.watchedAddresses
  )
    throw new Error('Workspace changed. Review the refreshed preview before importing.');
  if (!plan.changes.length) return workspace;
  return {
    ...workspace,
    annotations: plan.next.annotations,
    wallets: { ...workspace.wallets, definitions: plan.next.wallets.definitions },
  };
}

/** Project native metadata for the destination, preserving native values. */
export function planLabelExport(
  workspace: Workspace,
  options: LabelExportOptions,
): LabelExportPlan {
  const byteLimit = options.profile === 'btcpay' ? 1_000_000 : MAX_LABEL_FILE_BYTES;
  const issues: LabelIssue[] = [],
    textChanges: LabelChange[] = [];
  const empty = (blocked: string): LabelExportPlan => ({
    content: '',
    recordCount: 0,
    bytes: 0,
    byteLimit,
    issues,
    textChanges,
    blocked,
  });
  if (options.profile === 'bluewallet' && workspace.network !== 'mainnet')
    return empty(
      'BlueWallet supports mainnet in the audited release. Choose another destination for testnet4.',
    );
  if (options.profile === 'keeper' && options.scope.kind !== 'wallet')
    return empty('Select one wallet for a Keeper export.');
  const tagsById = new Map<string, string[]>();
  for (const tag of workspace.annotations.tags ?? [])
    for (const id of tag.nodeIds) {
      const names = tagsById.get(id) ?? [];
      names.push(tag.name);
      tagsById.set(id, names);
    }
  const keys = createLabelKeyMatcher(workspace),
    keyId = keyAnnotationResolver(workspace, keys);
  const ids = new Set([...Object.keys(workspace.annotations.entities), ...tagsById.keys()]);
  if (options.includeKeyLabels && options.walletNameFallback)
    for (const wallet of workspace.wallets.definitions) ids.add(keyId(wallet.key));
  const scoped = labelScopeIds(workspace, [...ids], options.scope, keys);
  const explicitKeyRefs = new Set<string>();
  if (options.includeKeyLabels && options.walletNameFallback)
    for (const id of scoped) {
      if (!id.startsWith('xpub:') || !workspace.annotations.entities[id]?.label.trim()) continue;
      try {
        explicitKeyRefs.add(keys.parse(id.slice(5)).bip32Key);
      } catch {
        /* Invalid legacy references cannot supply a fallback override. */
      }
    }
  const projected: {
    type: string;
    ref: string;
    label: string;
    id: string;
    original: string;
    tag: boolean;
  }[] = [];
  for (const id of ids) {
    if (!scoped.has(id)) {
      issues.push({ id, reason: 'scope', detail: 'Outside the selected scope.' });
      continue;
    }
    const prefix = id.slice(0, id.indexOf(':')),
      type = prefix === 'out' ? 'output' : prefix;
    if (!['tx', 'addr', 'output', 'xpub'].includes(type)) continue;
    if (type === 'xpub' && (!options.includeKeyLabels || !supported(options.profile, type)))
      continue;
    if (!supported(options.profile, type)) {
      issues.push({
        id,
        reason: 'unsupported',
        detail: 'Destination does not use this record type.',
      });
      continue;
    }
    let ref = id.slice(id.indexOf(':') + 1);
    try {
      ref =
        type === 'xpub'
          ? keys.parse(ref).bip32Key
          : canonicalEntityReference(id, workspace.network).slice(id.indexOf(':') + 1);
    } catch {
      issues.push({
        id,
        reason: 'malformed',
        detail: 'The reference is invalid or belongs to a different Bitcoin network.',
      });
      continue;
    }
    const annotation = workspace.annotations.entities[id] ?? emptyAnnotation,
      tags = tagsById.get(id) ?? [];
    let text =
      type === 'tx' &&
      ['bluewallet', 'keeper'].includes(options.profile) &&
      options.transactionText === 'note'
        ? annotation.note.trim()
          ? annotation.note
          : annotation.label
        : annotation.label;
    if (type === 'xpub' && !text.trim() && options.walletNameFallback) {
      // A blank alias must not introduce a second value beside an explicit
      // annotation under an equivalent public encoding, even if it is too long.
      if (explicitKeyRefs.has(ref)) continue;
      const names = [...new Set(keys.matching(id.slice(5)).map((wallet) => wallet.name))];
      if (names.length > 1) {
        issues.push({
          id,
          reason: 'conflict',
          detail: 'Equivalent keys have different wallet names; no fallback exported.',
        });
        continue;
      }
      text = names[0] ?? '';
    }
    const add = (original: string, tag: boolean) => {
      if (!original.trim()) return;
      const value = options.profile === 'btcpay' ? original.trim() : original;
      const limit =
        options.profile === 'btcpay'
          ? 50
          : options.profile === 'sparrow' && type === 'xpub'
            ? 16
            : ['bluewallet', 'keeper'].includes(options.profile)
              ? tag
                ? MAX_TAG_NAME_LENGTH
                : MAX_ANNOTATION_NOTE_LENGTH
              : MAX_ANNOTATION_LABEL_LENGTH;
      if (value.length > limit && !options.shorten) {
        issues.push({
          id,
          reason: 'length',
          detail: `Text is longer than this destination’s ${limit.toLocaleString('en-US')}-character limit.`,
        });
        return;
      }
      projected.push({
        type,
        ref,
        label: options.shorten ? shortenLabel(value, limit) : value,
        id,
        original,
        tag,
      });
    };
    if (tagMapping(options.profile, type)) {
      for (const name of tags) add(name, true);
      if (options.includeEntityLabels) add(text, true);
    } else {
      if (options.includeTagsInLabels && tags.length)
        text = `${text.trim()}${text.trim() ? ' ' : ''}[${tags.join(', ')}]`;
      add(text, false);
    }
  }
  const tagNames = new Map<string, Set<string>>();
  for (const row of projected.filter((row) => row.tag)) {
    const names = tagNames.get(row.label.toLowerCase()) ?? new Set<string>();
    names.add((options.profile === 'btcpay' ? row.original.trim() : row.original).toLowerCase());
    tagNames.set(row.label.toLowerCase(), names);
  }
  const groups = new Map<string, typeof projected>();
  for (const row of projected) {
    if (row.tag && (tagNames.get(row.label.toLowerCase())?.size ?? 0) > 1) {
      issues.push({
        id: row.id,
        reason: 'collision',
        detail: 'Distinct names collide at the destination; excluded.',
      });
      continue;
    }
    const key = `${row.type}:${row.ref}`,
      group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const lines: string[] = [],
    encoder = new TextEncoder();
  let bytes = 0,
    recordCount = 0;
  for (const rows of groups.values()) {
    if (!rows[0].tag && new Set(rows.map((row) => row.original)).size > 1) {
      issues.push(
        ...rows.map((row) => ({
          id: row.id,
          reason: 'conflict' as const,
          detail: 'Conflicting equivalent-key labels cannot share one exported reference.',
        })),
      );
      continue;
    }
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.label)) continue;
      seen.add(row.label);
      const line = JSON.stringify({ type: row.type, ref: row.ref, label: row.label });
      bytes += encoder.encode(line).byteLength + Number(recordCount > 0);
      recordCount++;
      // Count the full projection but never allocate an oversized download.
      if (bytes <= byteLimit && recordCount <= MAX_LABEL_RECORDS) lines.push(line);
      if (row.original !== row.label)
        textChanges.push({
          id: `${row.type === 'output' ? 'out' : row.type}:${row.ref}`,
          target: row.tag ? 'tag' : 'label',
          before: row.original,
          after: row.label,
          original: row.original,
        });
    }
  }
  const blocked =
    recordCount > MAX_LABEL_RECORDS
      ? 'Export exceeds 10,000 records. Choose a narrower scope.'
      : bytes > byteLimit
        ? `Export exceeds ${byteLimit === MAX_LABEL_FILE_BYTES ? '5 MB' : '1 MB'} for this destination. Choose a narrower scope.`
        : undefined;
  return {
    content: blocked ? '' : lines.join('\n'),
    recordCount,
    bytes,
    byteLimit,
    issues,
    textChanges: blocked ? [] : textChanges,
    blocked,
  };
}
