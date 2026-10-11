import { z } from 'zod';
import { counterpartyReference } from '../annotationReferences';
import { canonicalEntityReference } from '../entityReferences';
import { emptyAnnotation } from '../Annotations/emptyAnnotation';
import type { Workspace } from '../workspace';
import {
  MAX_COUNTERPARTIES,
  assertCounterpartyBudget,
  canonicalCounterpartySubject,
  counterpartySubjectKey,
  validateCounterparties,
  type Counterparty,
  type CounterpartyLink,
  type CounterpartySubject,
  type WalletTransactionSubject,
} from './counterpartyRecords';
export {
  MAX_COUNTERPARTIES,
  MAX_COUNTERPARTY_LINKS,
  assertCounterpartyBudget,
  validateCounterparties,
} from './counterpartyRecords';
export type {
  Counterparty,
  CounterpartySubject,
  CounterpartyLink,
  CounterpartyRecords,
  WalletTransactionSubject,
} from './counterpartyRecords';

export interface CounterpartyEdit {
  id: string;
  name: string;
  category?: string;
  note?: string;
}

/** Save identity metadata and optionally associate activity in one undoable intention. */
export function saveCounterparty(
  workspace: Workspace,
  edit: CounterpartyEdit,
  subject?: CounterpartySubject,
): Workspace {
  const id = counterpartyReference(edit.id).slice(6);
  const name = z.string().trim().min(1).max(200).parse(edit.name);
  const category = edit.category?.trim() || undefined;
  if (category && category.length > 100)
    throw new Error('Counterparty category exceeds 100 characters.');
  if (edit.note !== undefined && edit.note.length > 10_000)
    throw new Error('Counterparty note exceeds 10,000 characters.');
  const records = workspace.counterparties ?? { definitions: [], links: [] };
  const existing = records.definitions.find((party) => party.id === id);
  if (!existing && records.definitions.length >= MAX_COUNTERPARTIES)
    throw new Error('Workspace supports at most 1,000 counterparties.');
  const reference = counterpartyReference(id);
  const annotation = workspace.annotations.entities[reference] ?? emptyAnnotation;
  const note = edit.note ?? annotation.note;
  const definitionChanged = !existing || existing.category !== category;
  const metadataChanged = annotation.label !== name || annotation.note !== note;
  const next =
    !definitionChanged && !metadataChanged
      ? workspace
      : {
          ...workspace,
          counterparties: {
            ...records,
            definitions: existing
              ? records.definitions.map((party) =>
                  party.id === id ? { id, ...(category ? { category } : {}) } : party,
                )
              : [...records.definitions, { id, ...(category ? { category } : {}) }],
          },
          annotations: {
            ...workspace.annotations,
            entities: {
              ...workspace.annotations.entities,
              [reference]: { ...annotation, label: name, note },
            },
          },
        };
  return subject ? assignCounterparty(next, id, subject) : next;
}

/** Add only this explicit relationship. Never propagate identity or copy metadata. */
export function assignCounterparty(
  workspace: Workspace,
  counterpartyId: string,
  subject: CounterpartySubject,
): Workspace {
  const id = counterpartyReference(counterpartyId).slice(6);
  const records = workspace.counterparties;
  if (!records?.definitions.some((party) => party.id === id))
    throw new Error('That counterparty is no longer part of this workspace.');
  const canonical = canonicalCounterpartySubject(workspace, subject);
  if (
    records.links.some(
      (link) =>
        link.counterpartyId === id &&
        counterpartySubjectKey(link) === counterpartySubjectKey(canonical),
    )
  )
    return workspace;
  const counterparties = {
    ...records,
    links: [...records.links, { ...canonical, counterpartyId: id }],
  };
  assertCounterpartyBudget(counterparties);
  const next = { ...workspace, counterparties };
  return { ...next, counterparties: validateCounterparties(next) };
}

export function removeCounterpartyLink(
  workspace: Workspace,
  counterpartyId: string,
  subject: CounterpartySubject,
): Workspace {
  const id = counterpartyReference(counterpartyId).slice(6);
  const canonical = canonicalCounterpartySubject(workspace, subject);
  const records = workspace.counterparties;
  const links = records?.links.filter(
    (link) =>
      link.counterpartyId !== id ||
      counterpartySubjectKey(link) !== counterpartySubjectKey(canonical),
  );
  return !records || !links || links.length === records.links.length
    ? workspace
    : { ...workspace, counterparties: { ...records, links } };
}

/** Editable choices share exact anchors. Overlapping or inherited context stays separate. */
export function counterpartySelectionLinks(
  workspace: Pick<Workspace, 'network' | 'counterparties'>,
  subject: CounterpartySubject,
): CounterpartyLink[] {
  const canonical = canonicalCounterpartySubject(workspace, subject);
  const key = counterpartySubjectKey(
    canonical.kind === 'entity' ? canonical : { ...canonical, outputIds: undefined },
  );
  return (workspace.counterparties?.links ?? []).filter(
    (link) =>
      counterpartySubjectKey(link.kind === 'entity' ? link : { ...link, outputIds: undefined }) ===
      key,
  );
}

/** One checklist edit replaces only this identity's scopes in this anchored relationship. */
export function setCounterpartySelection(
  workspace: Workspace,
  counterpartyId: string,
  subject: CounterpartySubject,
  selection: 'none' | 'all' | string[],
): Workspace {
  const id = counterpartyReference(counterpartyId).slice(6);
  const canonical = canonicalCounterpartySubject(workspace, subject);
  if (Array.isArray(selection) && canonical.kind !== 'wallet-transaction')
    throw new Error('Output selection needs a payment or receipt.');
  const selected =
    selection === 'none'
      ? undefined
      : canonicalCounterpartySubject(
          workspace,
          canonical.kind === 'wallet-transaction'
            ? { ...canonical, outputIds: Array.isArray(selection) ? selection : undefined }
            : canonical,
        );
  const links = counterpartySelectionLinks(workspace, canonical).filter(
    (link) => link.counterpartyId === id,
  );
  if (
    selected &&
    links.length === 1 &&
    counterpartySubjectKey(links[0]) === counterpartySubjectKey(selected)
  )
    return workspace;
  const removed = new Set(links);
  const next = removed.size
    ? {
        ...workspace,
        counterparties: {
          ...workspace.counterparties!,
          links: workspace.counterparties!.links.filter((link) => !removed.has(link)),
        },
      }
    : workspace;
  return selected ? assignCounterparty(next, id, selected) : next;
}

/** Delete a human identity and its links/metadata, preserving all factual chain subjects. */
export function removeCounterparty(workspace: Workspace, counterpartyId: string): Workspace {
  const id = counterpartyReference(counterpartyId).slice(6);
  const records = workspace.counterparties;
  if (!records?.definitions.some((party) => party.id === id)) return workspace;
  const reference = counterpartyReference(id);
  const entities = { ...workspace.annotations.entities };
  delete entities[reference];
  return {
    ...workspace,
    counterparties: {
      definitions: records.definitions.filter((party) => party.id !== id),
      links: records.links.filter((link) => link.counterpartyId !== id),
    },
    annotations: {
      ...workspace.annotations,
      entities,
      tags: workspace.annotations.tags?.map((tag) => ({
        ...tag,
        nodeIds: tag.nodeIds.filter((member) => member !== reference),
      })),
    },
  };
}

export type CounterpartyRelationshipQuery = Pick<
  WalletTransactionSubject,
  'transactionId' | 'direction' | 'walletOutputIds' | 'outputIds'
>;

export interface CounterpartyLookup {
  forRelationship: (query: CounterpartyRelationshipQuery) => Counterparty[];
  forEntity: (subjectId: string) => Counterparty[];
}

/** Prepare once for an immutable document snapshot. No registry, persisted index or identity inference. */
export function createCounterpartyLookup(
  workspace: Pick<Workspace, 'counterparties'>,
): CounterpartyLookup {
  const definitions = new Map(
    (workspace.counterparties?.definitions ?? []).map((party) => [party.id, party]),
  );
  const relationships = new Map<
    string,
    (WalletTransactionSubject & { counterpartyId: string })[]
  >();
  const entities = new Map<string, Set<string>>();
  for (const link of workspace.counterparties?.links ?? []) {
    if (link.kind === 'entity') {
      const ids = entities.get(link.subjectId) ?? new Set<string>();
      ids.add(link.counterpartyId);
      entities.set(link.subjectId, ids);
    } else {
      const key = `${link.transactionId}|${link.direction}`;
      const links = relationships.get(key) ?? [];
      links.push(link);
      relationships.set(key, links);
    }
  }
  const resolve = (ids: Iterable<string>) =>
    [...ids].flatMap((id) => {
      const party = definitions.get(id);
      return party ? [party] : [];
    });
  return {
    forRelationship: (query) =>
      resolve(
        new Set(
          (relationships.get(`${query.transactionId}|${query.direction}`) ?? []).flatMap((link) => {
            if (
              link.kind !== 'wallet-transaction' ||
              link.transactionId !== query.transactionId ||
              link.direction !== query.direction ||
              !link.walletOutputIds.some((id) => query.walletOutputIds.includes(id))
            )
              return [];
            if (
              query.outputIds &&
              (!link.outputIds || !link.outputIds.some((id) => query.outputIds!.includes(id)))
            )
              return [];
            if (
              link.direction === 'received' &&
              link.outputIds &&
              !link.outputIds.some((id) => query.walletOutputIds.includes(id))
            )
              return [];
            return [link.counterpartyId];
          }),
        ),
      ),
    forEntity: (subjectId) => resolve(entities.get(subjectId) ?? []),
  };
}

/** Query original or reimported activity through concrete anchors, never wallet UUID alone. */
export function listCounterpartiesForRelationship(
  workspace: Pick<Workspace, 'counterparties'>,
  query: CounterpartyRelationshipQuery,
  prepared?: CounterpartyLookup,
): Counterparty[] {
  return (prepared ?? createCounterpartyLookup(workspace)).forRelationship(query);
}

/** Exact, explicitly reusable association; neighboring subjects do not inherit it. */
export function listCounterpartiesForEntity(
  workspace: Pick<Workspace, 'network' | 'counterparties'>,
  subjectId: string,
  prepared?: CounterpartyLookup,
): Counterparty[] {
  const reference = canonicalEntityReference(subjectId, workspace.network);
  return (prepared ?? createCounterpartyLookup(workspace)).forEntity(reference);
}
