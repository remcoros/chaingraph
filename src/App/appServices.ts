import { createBrowserWorkspaceStore } from './createWorkspaceStore';

/** Page-wide services whose identity must outlive React render cycles. */
export const appServices = {
  workspaceStore: createBrowserWorkspaceStore(),
};
