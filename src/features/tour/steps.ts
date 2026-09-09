import {
  Bookmark,
  Box,
  FolderOpen,
  GitBranch,
  ListFilter,
  ListChecks,
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
  revealTarget?: boolean | 'start';
  missingTargetText?: string;
  when?: (context: TourContext) => boolean;
  /** Presentation only. App adapts these hints without changing saved workspace state. */
  view?: {
    workbench?: 'graph' | 'wallet';
    walletTab?: 'review' | 'sources';
    panel?: 'graph' | 'left' | 'right';
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
    target: '[data-tour="wallet-preview"] [data-tour="wallet-overview"]',
    fallbackTarget: '[data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'review' },
    text: 'Open Wallet, choose a wallet in the picker, or use Add wallet for a watch-only public key. Refresh discovers history; Check UTXOs checks unspent status; Analyse loaded runs local analysis.',
    missingTargetText:
      'No wallet yet. After the tour, use Add a wallet or choose the public demo wallet from Example workspaces in Help. You can skip ahead without importing.',
    tip: 'This tour only previews loaded data. It does not refresh, check UTXOs, run analysis or save edits.',
  },
  {
    id: 'wallet-activity',
    label: 'Review and addresses',
    title: 'Recognise your activity',
    icon: ListChecks,
    target: '[data-tour="wallet-preview"] [data-tour="wallet-sections"]',
    fallbackTarget: '[data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'sources' },
    text: 'To review gathers observations needing attention. Sources and Destinations list addresses linked directly to wallet transactions. Select an address to annotate a known or uncertain counterparty.',
    missingTargetText:
      'These lists appear after adding a wallet. With no loaded activity they stay empty; try the public demo wallet after the tour.',
    tip: 'Wallet matches identify your side. Counterparty links do not prove ownership or allocate CoinJoin funds. Missing inputs leave source evidence incomplete.',
  },
  {
    id: 'wallet-filter',
    label: 'Filter and select',
    title: 'Work through a useful subset',
    icon: ListFilter,
    target: '[data-tour="wallet-preview"] [data-tour="wallet-filters"]',
    fallbackTarget: '[data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'review' },
    text: 'Try Labels: Unlabeled, a tag, or Search to narrow the list. Click a row for one item, tick checkboxes for several, or use Select all for every match.',
    missingTargetText:
      'Add a wallet after the tour to reveal these filters. If a list has no matches, clear its filters or load wallet history before selecting.',
    tip: 'Use Label, Tags or the icon picker on one item or a batch; Notes is for one item. Annotations follow the same entities across Wallet and Graph.',
  },
  {
    id: 'wallet-decisions',
    label: 'Review and follow',
    title: 'Decide, then follow the context',
    icon: GitBranch,
    target: '[data-tour="wallet-preview"] [data-tour="wallet-item-actions"]',
    fallbackTarget:
      '[data-tour="wallet-preview"] [data-tour="wallet-filters"], [data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'review' },
    text: 'Mark reviewed completes a review decision. Review later sets it aside. Use Show to open the item in Graph, then Back to Wallet to return to your list and selection.',
    missingTargetText:
      'No review item is available to preview. After the tour, choose a row in To review to reveal its actions, or use the Review filter to revisit Reviewed and Review later items.',
    tip: 'Label, Tags, Notes and the icon picker record your context. The item’s Transaction flow shows loaded inputs and outputs; a review decision records your judgment, not proof of ownership.',
  },
  {
    id: 'lookup',
    label: 'Add chain data',
    title: 'Start from an outpoint, address or transaction',
    icon: Search,
    target: '[data-tour="chain-lookup"]',
    view: { panel: 'graph' },
    text: 'Paste a transaction ID, txid:vout outpoint, or Bitcoin address. The backend queries the matching network through your own nodes.',
    tip: 'Previous: off loads only the requested transaction. Choose one or two levels when you want more ancestry, then expand individual paths as needed.',
  },
  {
    id: 'graph',
    label: '3D graph',
    title: 'Read the shape of the transaction graph',
    icon: Box,
    target: '[data-tour="graph-stage"]',
    view: { panel: 'graph' },
    text: 'Cubes are transactions, spheres are outputs, and arrows show spending direction. Orbit by dragging empty space, scroll to zoom, and right-drag to pan. Flat offers a 2D layout.',
    tip: 'Hover a node for tracing and editing actions. Choose Value under Size by to compare amounts. Fit frames visible nodes; Hide panels makes more room without moving the camera.',
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
