import {
  Bookmark,
  Box,
  FolderOpen,
  GitBranch,
  ListFilter,
  LockKeyhole,
  Pencil,
  Search,
  Tags,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface TourContext {
  hasSelection: boolean;
  hasTransactions: boolean;
  features: readonly string[];
}
export interface TourStep {
  /** Stable identity, independent of ordering and optional feature availability. */
  id: string;
  label: string;
  title: string;
  text: string;
  tip: string;
  icon: LucideIcon;
  target: string;
  fallbackTarget?: string;
  revealTarget?: boolean;
  missingTargetText?: string;
  when?: (context: TourContext) => boolean;
  /** Presentation only. App adapts these hints without changing saved workspace state. */
  view?: {
    panel: 'graph' | 'left' | 'right';
    leftTab?: 'wallets' | 'entities' | 'bookmarks' | 'tags';
    rightTab?: 'inspect' | 'analysis';
    flowOpen?: boolean;
  };
}
export function availableTourSteps(steps: readonly TourStep[], context: TourContext) {
  return steps.filter((step) => !step.when || step.when(context));
}

export const WORKBENCH_TOUR: readonly TourStep[] = [
  {
    id: 'workspaces',
    label: 'Workspaces',
    title: 'An investigation has its own space',
    icon: FolderOpen,
    target: '[data-tour="workspace-tabs"]',
    text: 'Keep wallets, transactions and annotations together in a workspace. Open several in the top tabs, with one Bitcoin network per workspace.',
    tip: 'For a ready-made investigation, choose Example workspaces from Help. Your copy starts with real transactions and editable annotations.',
  },
  {
    id: 'wallets',
    label: 'Wallets',
    title: 'Bring your wallets together',
    icon: Wallet,
    target: '[data-tour="wallet-panel"]',
    view: { panel: 'left', leftTab: 'wallets' },
    text: 'Add watch-only account public keys, then scan receive and change addresses. Several wallets can belong to the same investigation.',
    tip: 'Returning after a few days? Refresh your wallets, review new activity, then show the transactions you want on the graph. No private keys are needed.',
  },
  {
    id: 'lookup',
    label: 'Add chain data',
    title: 'Start from an outpoint, address or transaction',
    icon: Search,
    target: '[data-tour="chain-lookup"]',
    view: { panel: 'graph' },
    text: 'Paste a transaction ID, txid:vout outpoint, or Bitcoin address. The backend queries the matching network through your own nodes.',
    tip: 'Previous starts at Off. Choose one or two levels when you want more ancestry, then expand individual paths as needed.',
  },
  {
    id: 'graph',
    label: '3D graph',
    title: 'Read the shape of the transaction graph',
    icon: Box,
    target: '[data-tour="graph-stage"]',
    view: { panel: 'graph' },
    text: 'Cubes are transactions, spheres are outputs, and arrows show spending direction. Orbit by dragging empty space, scroll to zoom, and right-drag to pan. Flat offers a 2D layout.',
    tip: 'Hover a node for tracing and editing actions. Use Size by value, amount filters and tag highlights to follow the larger flows. Fit restores the overview.',
  },
  {
    id: 'flow',
    label: 'Transaction flow',
    title: 'Follow an output into its next transaction',
    icon: GitBranch,
    target: '[data-tour="transaction-flow"]',
    fallbackTarget: '[data-tour="graph-stage"]',
    view: { panel: 'graph', flowOpen: true },
    missingTargetText:
      'Select a loaded transaction or output after the tour to open its transaction flow. Example workspaces include a useful starting selection.',
    text: 'The flow view puts inputs and outputs beside their transaction. Select an output and follow its spending arrow, or select an input to navigate to its creating transaction.',
    tip: 'A spending link is an exact outpoint reference. Deciding which other output carries the same funds through a transaction is an inference, especially with CoinJoins.',
  },
  {
    id: 'annotations',
    revealTarget: true,
    label: 'Labels and notes',
    title: 'Record what you know, and what you suspect',
    icon: Pencil,
    target: '[data-tour="annotation-editor"]',
    fallbackTarget: '[data-tour="analysis-panel"]',
    view: { panel: 'right', rightTab: 'inspect' },
    missingTargetText:
      'Select an entity after the tour to reveal its label, notes and icon controls in the Inspector.',
    text: 'Give a selected address, output or transaction a label, a note and an icon. Hover cards and flow-view pencils take you to the same editor.',
    tip: 'Write the source of a claim in the note. A label such as “possible exchange deposit” should stay distinct from a verified transaction fact. Edits save automatically.',
  },
  {
    id: 'tags',
    label: 'Tags',
    title: 'Bring related observations into view',
    icon: Tags,
    target: '[data-tour="wallet-panel"]',
    view: { panel: 'left', leftTab: 'tags' },
    text: 'Use tags for a shop, exchange, wallet activity or a working hypothesis. Add or create a tag directly while inspecting an entity, then use the Tags panel to show its members.',
    tip: 'Tags and wallet matches can highlight the graph. Sharing a tag records your grouping; it does not prove common ownership.',
  },
  {
    id: 'entities',
    label: 'Entities and filters',
    title: 'Reduce noise without losing your work',
    icon: ListFilter,
    target: '[data-tour="wallet-panel"]',
    view: { panel: 'left', leftTab: 'entities' },
    text: 'Browse transactions, outputs and addresses as a list. Filter by type, label, value or visibility, then select a row to inspect it on the graph.',
    tip: 'Hide keeps the data in your workspace. Use the Hidden filter to bring it back. Removing annotated entities asks for confirmation. Graph and flow amount filters are independent.',
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    title: 'Keep a few useful starting points',
    icon: Bookmark,
    target: '[data-tour="wallet-panel"]',
    view: { panel: 'left', leftTab: 'bookmarks' },
    text: 'Bookmark important transactions and outputs from the Inspector. This list brings you back to a useful point without searching for its transaction ID again.',
    tip: 'Example workspaces include bookmarks for their starting transaction and interesting outputs. Rename their labels as your investigation develops.',
  },
  {
    id: 'saving',
    label: 'Save and share',
    title: 'Keep an encrypted copy outside your browser',
    icon: LockKeyhole,
    target: '[data-tour="workspace-actions"]',
    view: { panel: 'graph' },
    text: 'Changes are encrypted and saved automatically in this browser. The workspace name stays public; its description, wallets and annotations are encrypted.',
    tip: 'Export an encrypted workspace before clearing browser data, or to move between devices. Keep the password safe. Use Help to restart this tour whenever you need it.',
  },
];
