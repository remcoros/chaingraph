import { createWorkspacePersistence } from '../Core/Workspace/Persistence';
import { WorkspaceStore } from '../Core/Workspace/Session/WorkspaceStore';

const persistence = createWorkspacePersistence();

/** Page-wide services whose identity must outlive React render cycles. */
export const appServices = {
  persistence,
  workspaceStore: new WorkspaceStore(persistence),
};
