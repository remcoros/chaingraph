import { addressToScriptHash, parseExtendedPublicKey, type Network } from '../../Bitcoin';
import { canonicalEntityReference } from '../entityReferences';

export const MAX_LABEL_FILE_BYTES = 5_000_000;
export const MAX_LABEL_RECORDS = 10_000;
// Unicode mode treats a valid surrogate pair as one supplementary code point;
// only lone surrogate code units match this range.
const illFormedText = /[\uD800-\uDFFF]/u;
export type LabelRecordType = 'tx' | 'addr' | 'output' | 'xpub';
export interface LabelRecord {
  line: number;
  type: LabelRecordType;
  id: string;
  label: string;
  origin?: string;
}
export interface LabelIssue {
  line?: number;
  id?: string;
  reason:
    | 'malformed'
    | 'unsupported'
    | 'no-label'
    | 'wrong-network'
    | 'scope'
    | 'empty'
    | 'length'
    | 'collision'
    | 'conflict'
    | 'tag-budget'
    | 'unchanged'
    | 'kept';
  detail: string;
  recordType?: string;
  text?: { current: string; incoming: string };
  source?: { label: string; origin?: string };
}
export interface LabelInspection {
  network: Network;
  recordCount: number;
  records: LabelRecord[];
  issues: LabelIssue[];
  origins: string[];
  ignoredFields: string[];
}

/** Inspect without mutation, preserving order, physical lines and account context. */
export function inspectLabelRecords(content: string, network: Network): LabelInspection {
  if (new TextEncoder().encode(content).byteLength > MAX_LABEL_FILE_BYTES)
    throw new Error('Label file exceeds 5 MB.');
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const recordCount = lines.reduce((count, line) => count + Number(Boolean(line.trim())), 0);
  if (recordCount > MAX_LABEL_RECORDS) throw new Error('Label file exceeds 10,000 records.');
  const records: LabelRecord[] = [];
  const issues: LabelIssue[] = [];
  const fields = new Set<string>();
  const keyValidity = new Map<string, 'valid' | 'wrong-network' | 'invalid'>();
  for (const [index, text] of lines.entries()) {
    if (!text.trim()) continue;
    const line = index + 1;
    let item: unknown;
    try {
      item = JSON.parse(text);
    } catch {
      issues.push({ line, reason: 'malformed', detail: 'This line is not valid JSON.' });
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({ line, reason: 'malformed', detail: 'This line must contain a label entry.' });
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.type !== 'string' || typeof row.ref !== 'string') {
      issues.push({
        line,
        reason: 'malformed',
        detail: 'The entry needs a label type and a reference, both enclosed in quotes.',
      });
      continue;
    }
    if (!['tx', 'addr', 'output', 'xpub'].includes(row.type)) {
      issues.push({
        line,
        reason: 'unsupported',
        recordType: row.type,
        detail: 'Record type is not modeled by Chaingraph.',
      });
      continue;
    }
    const type = row.type as LabelRecordType;
    if (
      row.ref.length > 150 ||
      (row.origin !== undefined &&
        (typeof row.origin !== 'string' ||
          row.origin.length > 10_000 ||
          illFormedText.test(row.origin)))
    ) {
      issues.push({
        line,
        reason: 'malformed',
        detail: 'The reference or source account is invalid.',
      });
      continue;
    }
    let id: string;
    try {
      if (type === 'xpub') {
        let validity = keyValidity.get(row.ref);
        if (!validity) {
          try {
            parseExtendedPublicKey(row.ref, network);
            validity = 'valid';
          } catch {
            try {
              parseExtendedPublicKey(row.ref, network === 'mainnet' ? 'testnet4' : 'mainnet');
              validity = 'wrong-network';
            } catch {
              validity = 'invalid';
            }
          }
          keyValidity.set(row.ref, validity);
        }
        if (validity === 'invalid') throw new Error('Invalid key');
        if (validity === 'wrong-network') {
          issues.push({
            line,
            id: `xpub:${row.ref}`,
            reason: 'wrong-network',
            detail: 'Public key belongs to another network.',
          });
          continue;
        }
        id = `xpub:${row.ref}`;
      } else {
        if (type === 'addr') {
          try {
            addressToScriptHash(row.ref, network);
          } catch {
            try {
              addressToScriptHash(row.ref, network === 'mainnet' ? 'testnet4' : 'mainnet');
            } catch {
              throw new Error('Invalid address');
            }
            issues.push({
              line,
              id: `addr:${row.ref}`,
              reason: 'wrong-network',
              detail: 'Address belongs to another network.',
            });
            continue;
          }
        }
        id = canonicalEntityReference(`${type === 'output' ? 'out' : type}:${row.ref}`, network);
      }
    } catch {
      issues.push({
        line,
        reason: 'malformed',
        detail: 'The transaction, address, output or public key reference is invalid.',
      });
      continue;
    }
    for (const field of Object.keys(row))
      if (!['type', 'ref', 'label', 'origin'].includes(field)) fields.add(field);
    if (row.label === undefined) {
      issues.push({
        line,
        id,
        reason: 'no-label',
        detail: 'No label supplied; existing metadata is kept.',
      });
      continue;
    }
    if (typeof row.label !== 'string') {
      issues.push({
        line,
        id,
        reason: 'malformed',
        detail: 'Label text must be enclosed in quotes.',
      });
      continue;
    }
    if (illFormedText.test(row.label)) {
      issues.push({
        line,
        id,
        reason: 'malformed',
        detail: 'Label text contains invalid characters.',
      });
      continue;
    }
    records.push({ line, type, id, label: row.label, origin: row.origin as string | undefined });
  }
  return {
    network,
    recordCount,
    records,
    issues,
    origins: [...new Set(records.flatMap((row) => (row.origin ? [row.origin] : [])))],
    ignoredFields: [...fields].sort(),
  };
}

export { clampAnnotationText as shortenLabel } from './annotations';
