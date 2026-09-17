import { CURRENT_WORKSPACE_VERSION } from '../../workspace';
import { migrateTransactionPlacement } from './transactionPlacement';

export class WorkspaceSchemaVersionError extends Error {
  readonly code = 'unsupported-workspace-version';

  constructor() {
    super('Unsupported workspace schema version. Open it with a compatible Chaingraph version.');
    this.name = 'WorkspaceSchemaVersionError';
  }
}

/**
 * Migrate decoded JSON before domain validation, without mutating the original.
 * Versionless and version 1 workspaces predate explicit canvas membership.
 * parseWorkspace seeds their membership from validated graph observations once;
 * raw observations must never reach graph construction before validation.
 * This boundary does not persist anything or change the encrypted envelope.
 */
export function migrateWorkspace(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const raw = data as Record<string, unknown>;
  if (raw.version === CURRENT_WORKSPACE_VERSION) return data;
  if (
    Object.prototype.hasOwnProperty.call(raw, 'version') &&
    ![1, 2, 3, 4, 5].includes(raw.version as number)
  )
    throw new WorkspaceSchemaVersionError();
  const nested: Record<string, unknown> = raw.version === 5 ? raw : nestWorkspace(raw);
  const chainData = nested.chainData as Record<string, unknown> | undefined;
  const scans = nested.connectionScans as Record<string, unknown> | undefined;
  const { inputContext, ...document } = nested;
  const view = document.view;
  return {
    ...document,
    version: CURRENT_WORKSPACE_VERSION,
    ...(typeof view === 'object' &&
      view !== null &&
      !Array.isArray(view) && {
        view: { ...view, ...(inputContext !== undefined && { inputContext }) },
      }),
    ...(chainData && {
      chainData: {
        ...chainData,
        transactions: migrateTransactionPlacement(chainData.transactions),
      },
    }),
    ...(scans && {
      connectionScans: { ...scans, evidence: migrateTransactionPlacement(scans.evidence) },
    }),
  };
}

function nestWorkspace(raw: Record<string, unknown>) {
  const {
    transactions,
    contextTransactionIds,
    watchedAddresses,
    addressHistories,
    addressBalances,
    addressUtxos,
    wallets,
    walletReviews,
    annotations,
    tags,
    findings,
    ...rest
  } = raw;
  // Preserve absence and partial knowledge. Import time is not observation time.
  return {
    ...rest,
    version: CURRENT_WORKSPACE_VERSION,
    chainData: {
      transactions,
      contextTransactionIds,
      watchedAddresses,
      addressHistories,
      addressBalances,
      addressUtxos,
    },
    wallets: { definitions: wallets, reviews: walletReviews },
    annotations: { entities: annotations, tags },
    analysis: { findings },
  };
}
