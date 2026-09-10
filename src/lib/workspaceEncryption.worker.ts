import type { Workspace } from '../domain/types';
import { decryptAndValidateWorkspace, validateAndEncryptWorkspace } from './workspaceEncryption';
import { operationErrorCode } from './workspaceOperationError';

// Each worker handles one job, then the caller terminates it. Decrypted data returns
// only to browser memory; errors contain allowlisted codes, never raw exception text.
self.onmessage = async (
  event: MessageEvent<{
    type: 'encrypt-workspace' | 'decrypt-workspace';
    id: string;
    workspace?: Workspace;
    input?: unknown;
    password: string;
  }>,
) => {
  const request = event.data;
  if (
    !request ||
    !['encrypt-workspace', 'decrypt-workspace'].includes(request.type) ||
    typeof request.id !== 'string'
  )
    return;
  self.onmessage = null;
  try {
    if (request.type === 'encrypt-workspace') {
      const envelope = await validateAndEncryptWorkspace(request.workspace!, request.password);
      self.postMessage({ type: 'workspace-encrypted', id: request.id, envelope });
    } else {
      const workspace = await decryptAndValidateWorkspace(request.input, request.password);
      self.postMessage({ type: 'workspace-decrypted', id: request.id, workspace });
    }
  } catch (error) {
    self.postMessage({
      type: 'workspace-operation-failed',
      id: request.id,
      code: operationErrorCode(error),
    });
  }
};
