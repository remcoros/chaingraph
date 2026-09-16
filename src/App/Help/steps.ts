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
import type { GraphLeftTab, GraphMobilePanel } from '../Workspace/GraphState/panelState';

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
  /** Preview with a temporary public example when the workspace has no wallet. */
  requiresWallet?: boolean;
  /** Presentation only. App adapts these hints without changing saved workspace state. */
  view?: {
    workbench?: 'graph' | 'wallet';
    walletTab?: 'review' | 'sources';
    panel?: GraphMobilePanel;
    leftTab?: GraphLeftTab;
    rightTab?: 'inspect';
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
    title: 'Workspaces',
    icon: FolderOpen,
    target: '[data-tour="workspace-tabs"]',
    text: 'A workspace keeps your wallets, transactions and annotations together, one Bitcoin network per workspace. Open multiple using the tabs above.',
    tip: 'Choose Example workspaces from Help to start with real transactions and annotations you can edit freely.',
  },
  {
    id: 'wallets',
    label: 'Wallets',
    title: 'Your wallets together',
    icon: Wallet,
    target: '[data-tour="wallet-preview"] [data-tour="wallet-overview"]',
    fallbackTarget: '[data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'review' },
    text: 'Open "Wallet", then pick one or use "Add wallet". "Refresh" pulls in its history, "Check UTXOs" confirms what is still unspent, and "Analyze" runs the local analysis.',
    missingTargetText:
      'No wallet yet. Add a watch-only public key once the tour is done. For now, a temporary public example shows the three activity views.',
    tip: 'This is a preview only. The tour will not refresh, check UTXOs, run analysis or save anything.',
  },
  {
    id: 'wallet-activity',
    requiresWallet: true,
    label: 'Review and addresses',
    title: 'Recognise your activity',
    icon: ListChecks,
    target: '[data-tour="wallet-preview"] [data-tour="wallet-sections"]',
    fallbackTarget: '[data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'sources' },
    text: '"To review" gathers the observations that need your attention. "Sources" and "Destinations" list addresses tied directly to your wallet transactions. Select an address to note whether its counterparty is known or still uncertain.',
    missingTargetText:
      'These lists fill in once you add a wallet. Try the public demo wallet after the tour to see them in action.',
    tip: 'A wallet match tells you which side is yours. A counterparty link is a note, not proof of ownership, and it will not split CoinJoin funds for you. A missing input just means that source evidence is incomplete.',
  },
  {
    id: 'wallet-filter',
    requiresWallet: true,
    label: 'Filter and select',
    title: 'Narrow the list to what matters',
    icon: ListFilter,
    target: '[data-tour="wallet-preview"] [data-tour="wallet-filters"]',
    fallbackTarget: '[data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'review' },
    text: 'Try "Labels: Unlabeled", a tag, or "Search" to narrow things down. Click a row for one item, tick checkboxes for several, or use "Select all" to grab every match.',
    missingTargetText:
      'Add a wallet after the tour to see these filters. If a list comes up empty, clear its filters or load more wallet history first.',
    tip: '"Label", "Tags" and the icon picker work on one item or a whole batch; "Notes" is for one item at a time. Annotations carry across Wallet and Graph on the same entities.',
  },
  {
    id: 'wallet-decisions',
    requiresWallet: true,
    label: 'Review and follow',
    title: 'Decide, then follow the context',
    icon: GitBranch,
    target: '[data-tour="wallet-preview"] [data-tour="wallet-item-actions"]',
    fallbackTarget:
      '[data-tour="wallet-preview"] [data-tour="wallet-filters"], [data-tour="wallet-empty"]',
    revealTarget: 'start',
    view: { workbench: 'wallet', walletTab: 'review' },
    text: '"Mark reviewed" closes out a review decision, and "Review later" sets it aside for now. Use "Show" to jump to the item in Graph, then "Back to Wallet" whenever you want to return to your list and selection.',
    missingTargetText:
      'No review item to preview right now. After the tour, pick a row in "To review" to see its actions, or use the Review filter to revisit anything marked "Reviewed" or "Review later".',
    tip: '"Label", "Tags", "Notes" and the icon picker capture what you know. The item’s Transaction flow shows its loaded inputs and outputs, but a review decision is your judgment call, not proof of ownership.',
  },
  {
    id: 'lookup',
    label: 'Add chain data',
    title: 'Start from a transaction, address or outpoint',
    icon: Search,
    target: '[data-tour="chain-lookup"]',
    view: { panel: 'graph' },
    text: 'Paste a transaction ID, a txid:vout outpoint, or a Bitcoin address, and the backend queries the matching network through your own nodes.',
    tip: '"Previous: off" loads just the transaction you asked for. Pick one or two levels back for more ancestry, then expand individual paths whenever you want to go further.',
  },
  {
    id: 'graph',
    label: '3D graph',
    title: 'Read the shape of the transaction graph',
    icon: Box,
    target: '[data-tour="graph-stage"]',
    view: { panel: 'graph' },
    text: 'Cubes are transactions, spheres are outputs, and arrows show which way the funds move. Drag empty space to orbit, scroll to zoom, and right-drag to pan. Switch to "Flat" for a 2D layout.',
    tip: 'Hover a node to trace or edit it. Choose "Value" under "Size by" to compare amounts at a glance. "Fit" frames everything currently visible, and "Hide panels" collapses both side panels without moving the camera.',
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
      'Select a loaded transaction or output after the tour to open its flow view. Example workspaces come with a useful starting selection already made.',
    text: 'The flow view lines up inputs and outputs next to their transaction. Select an output and follow its spending arrow, or select an input to jump to the transaction that created it.',
    tip: 'A spending link points to an exact outpoint, so it is solid. Working out which other output carries the same funds onward is an inference though, especially through a CoinJoin.',
  },
  {
    id: 'annotations',
    revealTarget: true,
    label: 'Labels and notes',
    title: 'Record what you know',
    icon: Pencil,
    target: '[data-tour="annotation-editor"]',
    fallbackTarget: '[data-tour="analysis-panel"]',
    view: { panel: 'right', rightTab: 'inspect' },
    missingTargetText:
      'Select an entity after the tour to see its label, notes and icon controls in the Inspector.',
    text: 'Give any selected address, output or transaction a label, a note and an icon. Hover cards and the pencils in flow view all open the same editor.',
    tip: 'Use the note to say where a claim came from. Keep a guess like “possible exchange deposit” clearly separate from a verified transaction fact. Everything saves automatically as you go.',
  },
  {
    id: 'tags',
    label: 'Tags',
    title: 'Bring related observations into view',
    icon: Tags,
    target: '[data-tour="wallet-panel"]',
    view: { panel: 'left', leftTab: 'tags' },
    text: 'Tag a shop, an exchange, some wallet activity, or just a working hypothesis. Add or create a tag while inspecting an entity, then open the "Tags" panel to see everything wearing it.',
    tip: 'Tags and wallet matches can both highlight the graph. Sharing a tag records a grouping you made.',
  },
  {
    id: 'entities',
    label: 'Entities and filters',
    title: 'Reduce noise without losing your work',
    icon: ListFilter,
    target: '[data-tour="wallet-panel"]',
    view: { panel: 'left', leftTab: 'entities' },
    text: 'Browse transactions, outputs and addresses as a list. Filter by type, label, value or visibility, then select a row to see it on the graph.',
    tip: 'Hide keeps the data in your workspace, just out of view. Use the Hidden filter to bring it back anytime.',
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    title: 'Keep useful starting points',
    icon: Bookmark,
    target: '[data-tour="wallet-panel"]',
    view: { panel: 'left', leftTab: 'bookmarks' },
    text: 'Bookmark important transactions and outputs from the Inspector. This list gets you back to a useful point fast.',
    tip: 'Example workspaces already include bookmarks for their starting transaction and other interesting outputs. Feel free to rename them as your investigation grows.',
  },
  {
    id: 'saving',
    label: 'Save and share',
    title: 'Keep an encrypted copy outside your browser',
    icon: LockKeyhole,
    target: '[data-tour="workspace-actions"]',
    view: { panel: 'graph' },
    text: 'Changes save automatically, encrypted, right in this browser. The workspace name stays public, but its description, wallets and annotations are encrypted.',
    tip: '"Export" an encrypted copy before clearing browser data, or to move between devices. Keep that password somewhere safe. You can restart this tour anytime from "Help".',
  },
];
