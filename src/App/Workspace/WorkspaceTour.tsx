import { GuidedTour } from '../Help/GuidedTour';
import type { WorkspaceController } from './useWorkspace';

export function WorkspaceTour({ workspace }: { workspace: WorkspaceController }) {
  if (workspace.tour === undefined || !workspace.activeWorkspace) return null;
  return (
    <GuidedTour
      steps={workspace.tourSteps}
      activeId={workspace.tour}
      onStepChange={workspace.setTour}
      previewLabel={
        workspace.needsTourExample ? 'Public example · preview only (mainnet)' : undefined
      }
      previewStatus={
        workspace.needsTourExample
          ? {
              loading: workspace.walletTourExample.loading,
              error: workspace.walletTourExample.error,
              onRetry: workspace.walletTourExample.retry,
            }
          : undefined
      }
    />
  );
}
