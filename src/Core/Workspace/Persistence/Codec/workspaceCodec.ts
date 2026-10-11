import type { Workspace } from '../../workspace';
import { decodeWorkspaceDocument, parseWorkspace } from './parseWorkspace';
import { migrateWorkspace } from '../Migrations/workspaceMigrations';
import { decryptWorkspace, encryptWorkspace, MAX_ENCRYPTED_FILE_BYTES } from './encryptedEnvelope';

/** Validate without dropping fields when serializing a locally edited workspace. */
export async function validateAndEncryptWorkspace(
  workspace: Workspace,
  password: string,
  encrypt = encryptWorkspace,
) {
  // Validate the original version so legacy graph membership is seeded only
  // after its observations pass validation. Normalize scan results without marking
  // the live run interrupted; that transition belongs to import/unlock only.
  // Preserve unrelated persisted fields.
  const validated = decodeWorkspaceDocument(workspace, false);
  const migrated = migrateWorkspace(workspace) as Workspace;
  let reviews = migrated.wallets.reviews;
  for (const [key, record] of Object.entries(validated.wallets.reviews ?? {})) {
    const original = migrated.wallets.reviews?.[key];
    if (
      !original ||
      record.supportEvidence === undefined ||
      record.supportEvidence === original.supportEvidence
    )
      continue;
    if (reviews === migrated.wallets.reviews) reviews = { ...reviews };
    // Retain unrelated raw fields while writing the one-time validated migration baseline.
    reviews![key] = { ...original, supportEvidence: record.supportEvidence };
  }
  return encrypt(
    {
      ...migrated,
      ...(reviews !== migrated.wallets.reviews
        ? { wallets: { ...migrated.wallets, reviews } }
        : {}),
      connectionScans: validated.connectionScans,
      view: { ...migrated.view, graphNodeIds: validated.view.graphNodeIds },
    },
    password,
  );
}

/** Blob text/JSON, authentication, expansion, migration and wallet verification run in the worker. */
export async function decryptAndValidateWorkspace(input: unknown, password: string) {
  if (input instanceof Blob) {
    if (input.size > MAX_ENCRYPTED_FILE_BYTES) throw new Error('Workspace file is too large.');
    input = JSON.parse(await input.text());
  }
  return parseWorkspace(await decryptWorkspace(input, password));
}
