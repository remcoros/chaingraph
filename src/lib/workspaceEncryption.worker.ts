import type { Workspace } from '../domain/types';
import { validateAndEncryptWorkspace } from './workspaceEncryption';

// Each worker handles one job and is terminated by its caller after completion.
// No workspace data, passwords or raw error messages leave this worker unencrypted.
self.onmessage = async (
  event: MessageEvent<{
    type: 'encrypt-workspace';
    id: string;
    workspace: Workspace;
    password: string;
  }>,
) => {
  const request = event.data;
  if (!request || request.type !== 'encrypt-workspace' || typeof request.id !== 'string') return;
  self.onmessage = null;
  try {
    const envelope = await validateAndEncryptWorkspace(request.workspace, request.password);
    self.postMessage({ type: 'workspace-encrypted', id: request.id, envelope });
  } catch {
    self.postMessage({ type: 'workspace-encryption-failed', id: request.id });
  }
};
