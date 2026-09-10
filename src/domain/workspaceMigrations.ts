/** Decrypted workspace schema version, independent of the encrypted envelope version. */
export const CURRENT_WORKSPACE_VERSION = 2 as const;

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
  if (!Object.prototype.hasOwnProperty.call(raw, 'version') || raw.version === 1)
    return { ...raw, version: CURRENT_WORKSPACE_VERSION };
  if (raw.version !== CURRENT_WORKSPACE_VERSION) throw new WorkspaceSchemaVersionError();
  return data;
}
