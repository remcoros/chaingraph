export type WorkbenchMode = 'wallet' | 'graph' | 'analysis';

/** A semantic focus destination. Each workbench resolves its own DOM target. */
export type WorkbenchEntryTarget = 'workbench' | 'stage' | 'inspector';

export interface WorkbenchSwitchOptions {
  interaction?: 'switch' | 'handoff' | 'return';
  focus?: WorkbenchEntryTarget;
}

export const WORKBENCH_LABELS: Record<WorkbenchMode, string> = {
  wallet: 'Wallet',
  graph: 'Graph',
  analysis: 'Analysis',
};
