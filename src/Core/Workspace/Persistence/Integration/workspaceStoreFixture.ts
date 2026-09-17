import { WorkspaceStore } from '../../Session/WorkspaceStore';
import {
  WorkspacePersistenceImplementation,
  type WorkspacePersistenceOptions,
} from '../workspacePersistence';

/** Persistence/session integration fixture. Private fault injection never crosses the public interface. */
export function createBrowserWorkspaceStore(options: WorkspacePersistenceOptions = {}) {
  return new WorkspaceStore(new WorkspacePersistenceImplementation(options));
}
