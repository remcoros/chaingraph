import { z } from 'zod';
import type { Network } from '../Bitcoin';
import { canonicalEntityReference } from './entityReferences';

const counterpartyIdSchema = z.uuid().transform((id) => id.toLowerCase());

/** Human identities are metadata subjects, never factual chain entities. */
export function counterpartyReference(id: string): string {
  return `party:${counterpartyIdSchema.parse(id)}`;
}

/** Keeps factual references unchanged while allowing explicitly named human identities. */
export function canonicalAnnotationReference(id: string, network: Network): string {
  if (id.startsWith('party:')) return counterpartyReference(id.slice(6));
  return canonicalEntityReference(id, network);
}
