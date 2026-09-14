import { AnalysisWorkbenchContent } from './Analysis/AnalysisWorkbenchContent';
import type { WorkspaceController } from '../useWorkspace';

export function AnalysisWorkbench({ workspace }: { workspace: WorkspaceController }) {
  const {
    w,
    walletScanRevision,
    analysisSessions,
    workbench,
    lockingWorkspace,
    selected,
    wallet,
    change,
    wRef,
    tourStep,
    analysisWorkspaceRef,
  } = workspace;
  const { showFindingOnGraph } = workspace.analysisActions;

  if (!w) return null;
  return (
    <section
      className="workbench-page"
      hidden={workbench !== 'analysis' || !!tourStep}
      ref={analysisWorkspaceRef}
      id="analysis-workspace"
      tabIndex={-1}
      aria-label="Analysis workspace"
    >
      <AnalysisWorkbenchContent
        key={`${w.id}:${walletScanRevision}`}
        cache={analysisSessions.current}
        workspace={w}
        active={workbench === 'analysis' && !lockingWorkspace}
        selected={selected}
        wallet={wallet}
        onFindings={(findings) => change((current) => ({ ...current, findings }))}
        onRecovered={(before, next) => {
          if (
            wRef.current?.id !== before.id ||
            wRef.current.network !== before.network ||
            lockingWorkspace
          )
            return;
          let applied = false;
          change((current) => {
            if (current.transactions !== before.transactions) return current;
            applied = true;
            return { ...current, transactions: next.transactions };
          });
          // Evidence writes mark old findings stale. Install the rerun in the
          // same synchronous action, retaining the single data-enrichment Undo.
          if (applied) change((current) => ({ ...current, findings: next.findings }), false);
        }}
        onGraph={showFindingOnGraph}
      />
    </section>
  );
}
