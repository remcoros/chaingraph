import { WorkspaceCryptoError } from './Codec/workspaceCodecError';
import { WorkspaceSchemaVersionError } from './Migrations/workspaceMigrations';

const messages = {
  'worker-start':
    'The workspace worker could not start. Your data was preserved. Check browser permissions and retry.',
  'worker-unavailable':
    'This browser requires Web Worker support for encrypted workspaces. Use a compatible browser.',
  'worker-timeout':
    'Workspace processing took too long. Your data was preserved. Retry in a compatible browser.',
  'worker-stopped': 'The workspace worker stopped. Your data was preserved. Retry the operation.',
  'worker-unreadable':
    'The workspace worker returned an unreadable result. Your data was preserved. Retry the operation.',
  'worker-unexpected':
    'The workspace worker returned an unexpected result. Your data was preserved. Retry the operation.',
  'worker-dispatch':
    'The workspace could not be sent to the workspace worker. Your data was preserved. Retry the operation.',

  'schema-version':
    'Unsupported workspace schema version. Open it with a compatible Chaingraph version. The original was preserved.',
  'unsupported-format':
    'Unsupported encrypted workspace format or compression. Open it with a compatible Chaingraph version. The original was preserved.',
  'compression-unavailable':
    'This browser lacks the required gzip support. Use a browser with CompressionStream and DecompressionStream support. Your data was preserved.',
  'size-limit': 'Workspace exceeds the 32 MiB decompressed size limit. The original was preserved.',
  'unlock-failed': 'Unable to unlock workspace. The password is incorrect or the file was changed.',
  'invalid-envelope': 'Invalid encrypted workspace. Restore an intact backup.',
  'invalid-payload': 'Workspace contents are invalid or damaged. Restore an intact backup.',
  'compression-failed':
    'Workspace compression could not be processed. Your data was preserved. Retry saving or restore an intact backup.',
  validation:
    'Workspace validation failed. Your data was preserved. Restore an intact backup or correct the open workspace before saving.',
} as const;
export type WorkspaceOperationCode = keyof typeof messages;

function validationPath(error: unknown): string | undefined {
  const issue = (error as { issues?: { path?: unknown }[] } | undefined)?.issues?.[0];
  return Array.isArray(issue?.path) && issue.path.length ? issue.path.join('.') : undefined;
}

export class WorkspacePersistenceError extends Error {
  constructor(
    readonly code: WorkspaceOperationCode,
    detail?: string,
  ) {
    super(
      `${messages[code]}${code === 'validation' && detail ? ` Validation issue at ${detail}.` : ''}`,
    );
  }
}
export function operationErrorCode(error: unknown): WorkspaceOperationCode {
  if (error instanceof WorkspaceSchemaVersionError) return 'schema-version';
  if (error instanceof WorkspaceCryptoError && Object.hasOwn(messages, error.code))
    return error.code as WorkspaceOperationCode;
  return 'validation';
}
export function operationErrorDetail(error: unknown): string | undefined {
  return validationPath(error);
}
export function operationError(code: unknown, detail?: string): WorkspacePersistenceError {
  return new WorkspacePersistenceError(
    typeof code === 'string' && Object.hasOwn(messages, code)
      ? (code as WorkspaceOperationCode)
      : 'validation',
    detail,
  );
}
