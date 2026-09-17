import { CURRENT_WORKSPACE_VERSION, validateWorkspace, type Workspace } from '../../workspace';
import { parseGraphNodeIds } from '../../view';
import { migrateWorkspace } from '../Migrations/workspaceMigrations';
import { legacyGraphNodeIds } from '../Migrations/legacyGraphMembership';

/** Full decoded-document migration and restoration. Run in a worker, not the UI thread. */
export function decodeWorkspaceDocument(data: unknown, verifyDerivation = true): Workspace {
  const parsed = validateWorkspace(migrateWorkspace(data), verifyDerivation);
  if (
    parsed.view.graphNodeIds === undefined &&
    [2, 3, 4, 5, CURRENT_WORKSPACE_VERSION].includes((data as { version?: number }).version ?? 0)
  )
    throw new Error('Workspace is missing explicit graph entity membership.');
  if (parsed.view.graphNodeIds === undefined)
    parsed.view.graphNodeIds = parseGraphNodeIds(legacyGraphNodeIds(parsed), parsed.network);
  return parsed;
}

/** Reopening transitions never run during a live save or ordinary model validation. */
export function parseWorkspace(data: unknown): Workspace {
  const parsed = decodeWorkspaceDocument(data);
  if (parsed.connectionScans)
    parsed.connectionScans.runs = parsed.connectionScans.runs.map((run) =>
      run.status === 'running' ? { ...run, status: 'interrupted' as const } : run,
    );
  return parsed;
}
