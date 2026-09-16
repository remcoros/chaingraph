import {
  BrowserWorkspacePersistence,
  type BrowserWorkspacePersistenceOptions,
} from './Workspace/Persistence/Browser';
import { WorkspaceStore } from './Workspace/Store/WorkspaceStore';

/** Browser composition root for the workspace lifecycle. */
export function createBrowserWorkspaceStore(options: BrowserWorkspacePersistenceOptions = {}) {
  return new WorkspaceStore(new BrowserWorkspacePersistence(options));
}

export type { WorkspaceStore } from './Workspace/Store/WorkspaceStore';
