import type { Workspace } from '../domain/types';
import { parseWorkspace } from '../domain/workspace';
import { migrateWorkspace } from '../domain/workspaceMigrations';
import { decryptWorkspace, encryptWorkspace, MAX_ENCRYPTED_FILE_BYTES } from './crypto';

/** Validate without dropping fields when serializing a locally edited workspace. */
export async function validateAndEncryptWorkspace(
  workspace: Workspace,
  password: string,
  encrypt = encryptWorkspace,
) {
  const migrated = migrateWorkspace(workspace);
  parseWorkspace(migrated, false);
  return encrypt(migrated, password);
}

/** Blob text/JSON, authentication, expansion, migration and wallet verification run in the worker. */
export async function decryptAndValidateWorkspace(input: unknown, password: string) {
  if (input instanceof Blob) {
    if (input.size > MAX_ENCRYPTED_FILE_BYTES) throw new Error('Workspace file is too large.');
    input = JSON.parse(await input.text());
  }
  return parseWorkspace(await decryptWorkspace(input, password));
}
