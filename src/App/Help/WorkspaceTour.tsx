import { GuidedTour } from './GuidedTour';
import type { WorkspaceController } from '../Workspace/useWorkspace';

export function WorkspaceTour({ workspace }: { workspace: WorkspaceController }) {
  const { tour } = workspace;
  if (tour.activeId === undefined || !workspace.activeWorkspace) return null;
  return (
    <GuidedTour
      steps={tour.steps}
      activeId={tour.activeId}
      onStepChange={tour.show}
      previewLabel={tour.needsExample ? 'Public example · preview only (mainnet)' : undefined}
      previewStatus={
        tour.needsExample
          ? {
              loading: tour.example.loading,
              error: tour.example.error,
              onRetry: tour.example.retry,
            }
          : undefined
      }
    />
  );
}
