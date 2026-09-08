import type { Workspace } from '../domain/types';
import { parseWorkspace } from '../domain/workspace';
import { encryptWorkspace } from './crypto';

/** The same validation and version-1 envelope in browser workers and injected/Node tests. */
export async function validateAndEncryptWorkspace(
  workspace: Workspace,
  password: string,
  encrypt = encryptWorkspace,
) {
  parseWorkspace(workspace, false);
  return encrypt(workspace, password);
}
