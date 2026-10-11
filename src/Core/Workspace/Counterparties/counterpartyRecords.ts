import { z } from 'zod';
import { canonicalAnnotationReference, counterpartyReference } from '../annotationReferences';
import { canonicalEntityReference, transactionReference } from '../entityReferences';
import type { Network } from '../../Bitcoin';
import type { Transaction } from '../../ChainData';
import type { Annotation, WorkspaceTag } from '../Annotations/annotations';

/** A user-maintained identity. Its name and other metadata belong to Annotations. */
export interface Counterparty {
  id: string;
  category?: string;
}

/** The user names a receipt/payment relationship, without attributing transaction ownership. */
export interface WalletTransactionSubject {
  kind: 'wallet-transaction';
  /** Original wallet context. Concrete anchors preserve the link after wallet removal/reimport. */
  walletId: string;
  transactionId: string;
  direction: 'received' | 'sent';
  /** Received outputs, or exact wallet prevouts spent by this transaction. */
  walletOutputIds: string[];
  /** Explicit narrower receipt/payment outputs, never an inferred allocation. */
  outputIds?: string[];
}

export type CounterpartySubject = WalletTransactionSubject | { kind: 'entity'; subjectId: string };

export type CounterpartyLink = CounterpartySubject & { counterpartyId: string };

export interface CounterpartyRecords {
  definitions: Counterparty[];
  links: CounterpartyLink[];
}

export const MAX_COUNTERPARTIES = 1_000;
export const MAX_COUNTERPARTY_LINKS = 50_000;
const MAX_LINK_REFERENCES = 50_000;
const uuid = z.uuid().transform((id) => id.toLowerCase());
const references = z.array(z.string().max(200)).min(1).max(MAX_LINK_REFERENCES);
const subjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wallet-transaction'),
    walletId: uuid,
    transactionId: z
      .string()
      .regex(/^[0-9a-f]{64}$/i)
      .transform((id) => id.toLowerCase()),
    direction: z.enum(['received', 'sent']),
    walletOutputIds: references,
    outputIds: references.optional(),
  }),
  z.object({ kind: z.literal('entity'), subjectId: z.string().max(200) }),
]);
const linkSchema = z.intersection(z.object({ counterpartyId: uuid }), subjectSchema);

export const counterpartiesSchema: z.ZodType<CounterpartyRecords> = z.object({
  definitions: z
    .array(z.object({ id: uuid, category: z.string().trim().min(1).max(100).optional() }))
    .max(MAX_COUNTERPARTIES),
  links: z.array(linkSchema).max(MAX_COUNTERPARTY_LINKS),
});

/** Count invalid raw input before schema allocation/normalization. */
export function assertCounterpartyBudget(data: unknown): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const raw = data as { definitions?: unknown; links?: unknown };
  if (Array.isArray(raw.definitions) && raw.definitions.length > MAX_COUNTERPARTIES)
    throw new Error('Workspace supports at most 1,000 counterparties.');
  if (!Array.isArray(raw.links)) return;
  if (raw.links.length > MAX_COUNTERPARTY_LINKS)
    throw new Error('Workspace exceeds the 50,000 counterparty link limit.');
  let count = 0;
  for (const link of raw.links) {
    if (!link || typeof link !== 'object') continue;
    const entry = link as { walletOutputIds?: unknown; outputIds?: unknown };
    count +=
      1 +
      (Array.isArray(entry.walletOutputIds) ? entry.walletOutputIds.length : 0) +
      (Array.isArray(entry.outputIds) ? entry.outputIds.length : 0);
    if (count > MAX_LINK_REFERENCES)
      throw new Error('Workspace exceeds the 50,000 counterparty reference limit.');
  }
}

export function canonicalCounterpartySubject(
  workspace: { network: Network },
  data: CounterpartySubject,
): CounterpartySubject {
  const subject = subjectSchema.parse(data);
  if (subject.kind === 'entity') {
    const subjectId = canonicalEntityReference(subject.subjectId, workspace.network);
    if (!subjectId.startsWith('addr:') && !subjectId.startsWith('out:'))
      throw new Error('A reusable counterparty association needs an address or output.');
    return { kind: 'entity', subjectId };
  }
  const outputs = (ids: string[]) =>
    [
      ...new Set(
        ids.map((id) => {
          const reference = canonicalEntityReference(id, workspace.network);
          if (!reference.startsWith('out:'))
            throw new Error('Counterparty anchors must be outputs.');
          return reference;
        }),
      ),
    ].sort();
  const walletOutputIds = outputs(subject.walletOutputIds);
  const outputIds = subject.outputIds ? outputs(subject.outputIds) : undefined;
  const belongsToTransaction = (id: string) => id.slice(4, 68) === subject.transactionId;
  if (subject.direction === 'received' && walletOutputIds.some((id) => !belongsToTransaction(id)))
    throw new Error('Receipt anchors must be outputs of the receiving transaction.');
  if (outputIds?.some((id) => !belongsToTransaction(id)))
    throw new Error('Selected payment outputs must belong to the relationship transaction.');
  if (subject.direction === 'received' && outputIds?.some((id) => !walletOutputIds.includes(id)))
    throw new Error('A narrowed receipt must use its selected wallet outputs.');
  return { ...subject, walletOutputIds, ...(outputIds ? { outputIds } : {}) };
}

export function counterpartySubjectKey(subject: CounterpartySubject): string {
  if (subject.kind === 'entity') return subject.subjectId;
  // Original wallet UUID is contextual: identical anchored relationships survive reimport.
  return `${subject.transactionId}|${subject.direction}|${subject.walletOutputIds.join(',')}|${subject.outputIds?.join(',') ?? ''}`;
}

export function counterpartyLinkReferences(link: CounterpartyLink): string[] {
  return link.kind === 'entity'
    ? [link.subjectId]
    : [
        transactionReference(link.transactionId),
        ...link.walletOutputIds,
        ...(link.outputIds ?? []),
      ];
}

/** Cross-concept validation accepts unloaded subjects and removed original wallet definitions. */
export function validateCounterparties(workspace: {
  network: Network;
  annotations: { entities: Record<string, Annotation>; tags?: WorkspaceTag[] };
  counterparties?: CounterpartyRecords;
  chainData: { transactions: Record<string, Transaction> };
}): CounterpartyRecords | undefined {
  const ids = new Set<string>();
  for (const party of workspace.counterparties?.definitions ?? []) {
    if (ids.has(party.id)) throw new Error('Workspace contains duplicate counterparty IDs.');
    ids.add(party.id);
    if (!workspace.annotations.entities[counterpartyReference(party.id)]?.label.trim())
      throw new Error('Every counterparty needs a name.');
  }
  for (const reference of [
    ...Object.keys(workspace.annotations.entities).filter((id) => id.startsWith('party:')),
    ...(workspace.annotations.tags ?? []).flatMap((tag) =>
      tag.nodeIds.filter((id) => id.startsWith('party:')),
    ),
  ]) {
    const canonical = canonicalAnnotationReference(reference, workspace.network);
    if (canonical !== reference || !ids.has(canonical.slice(6)))
      throw new Error('Counterparty metadata must reference an existing identity.');
  }
  const keys = new Set<string>();
  const links = (workspace.counterparties?.links ?? []).map((original) => {
    const subject = canonicalCounterpartySubject(workspace, original);
    const link = { ...subject, counterpartyId: original.counterpartyId };
    if (!ids.has(link.counterpartyId))
      throw new Error('Counterparty link references an unknown identity.');
    const key = `${link.counterpartyId}|${counterpartySubjectKey(subject)}`;
    if (keys.has(key)) throw new Error('Workspace contains duplicate counterparty links.');
    keys.add(key);
    if (link.kind !== 'wallet-transaction') return link;
    const transaction = workspace.chainData.transactions[link.transactionId];
    if (!transaction) return link;
    const inputIds = new Set(
      transaction.vin.flatMap((input) =>
        input.txid !== undefined && input.vout !== undefined
          ? [`out:${input.txid}:${input.vout}`]
          : [],
      ),
    );
    if (link.direction === 'sent' && link.walletOutputIds.some((id) => !inputIds.has(id)))
      throw new Error('Payment anchors must be inputs of the spending transaction.');
    for (const id of [
      ...(link.direction === 'received' ? link.walletOutputIds : []),
      ...(link.outputIds ?? []),
    ]) {
      if (!transaction.vout.some((output) => output.n === Number(id.slice(69))))
        throw new Error('Counterparty link references an output outside its transaction.');
    }
    return link;
  });
  return workspace.counterparties ? { ...workspace.counterparties, links } : undefined;
}
