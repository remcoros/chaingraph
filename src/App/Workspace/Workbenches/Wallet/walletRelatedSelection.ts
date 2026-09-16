export interface RelatedEntity {
  id: string;
  address?: string;
  txid?: string;
  transactionIds?: readonly string[];
}

/** Explicit relation within a supplied candidate set. No expansion, inferred
 * common ownership, case folding, partial matching or label-based identity. */
export function matchRelatedEntities(
  candidates: readonly RelatedEntity[],
  seeds: readonly RelatedEntity[],
  relation: 'address' | 'transaction',
): string[] {
  const valuesFor = (entity: RelatedEntity): readonly string[] =>
    relation === 'address'
      ? entity.address
        ? [entity.address]
        : []
      : entity.txid
        ? [entity.txid]
        : (entity.transactionIds ?? []);
  const values = new Set(seeds.flatMap((seed) => [...valuesFor(seed)]));
  return [
    ...new Set(
      candidates
        .filter((candidate) => valuesFor(candidate).some((value) => values.has(value)))
        .map((candidate) => candidate.id),
    ),
  ];
}
