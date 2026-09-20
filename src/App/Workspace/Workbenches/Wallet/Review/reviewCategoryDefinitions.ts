import type { ReviewReason } from '../../../../../Core/Workspace/Wallets/walletReview';
import { toolGroupsInDisplayOrder } from '../../../../../Core/Workspace/Analysis/toolGroups';

export const walletReviewGroups = {
  reviewItems: {
    id: 'review-items',
    label: 'Review items',
    order: 0,
  },
  labelsAndTags: {
    id: 'labels-and-tags',
    label: 'Labels and tags',
    order: 5,
  },
} as const;

export type WalletReviewGroup = (typeof walletReviewGroups)[keyof typeof walletReviewGroups];

export const walletReviewGroupsInDisplayOrder = [
  ...Object.values(walletReviewGroups),
  ...toolGroupsInDisplayOrder,
].sort((a, b) => a.order - b.order);

export interface WalletReviewCategoryDefinition {
  id: string;
  label: string;
  description: string;
  group: WalletReviewGroup;
  displayOrder: number;
}

interface ReviewReasonDefinition<Reason extends ReviewReason> {
  id: Reason;
  label: string;
  description: string;
  filter:
    | false
    | {
        group: WalletReviewGroup;
        displayOrder: number;
      };
}

export const walletReviewReasonDefinitions = {
  'wallet-transaction': {
    id: 'wallet-transaction',
    label: 'Wallet transaction',
    description:
      'Transactions in this wallet\u2019s known history. Review each transaction and record any context you want to keep.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 10 },
  },
  'current-utxo': {
    id: 'current-utxo',
    label: 'Current UTXOs; unspent in wallet',
    description:
      'Coins in this wallet that were unspent at the last UTXO check. This includes coins you have already labelled or tagged, so you can review everything the check found.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 20 },
  },
  'wallet-address': {
    id: 'wallet-address',
    label: 'Unknown receive/change address',
    description:
      'Receiving and change addresses in this wallet that have been used. Add labels to remember what you used them for; unused addresses are left out of the review list.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 30 },
  },
  source: {
    id: 'source',
    label: 'Earlier wallet receipt',
    description:
      'Earlier coins received by this wallet and later spent in transactions that created your current UTXOs. These receipts let you look back one step in your wallet’s history.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 40 },
  },
  'source-address': {
    id: 'source-address',
    label: 'Source address (received from)',
    description:
      'Addresses used to fund transactions that paid this wallet. They do not match its known addresses, but may still belong to you. Add a label if you recognize the sender or source.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 50 },
  },
  'destination-address': {
    id: 'destination-address',
    label: 'Destination address (sent to)',
    description:
      'Addresses paid by transactions that spent coins from this wallet. They do not match its known addresses, but may still belong to you. Add a label if you recognize the recipient or purpose.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 60 },
  },
  link: {
    id: 'link',
    label: 'Analysis finding',
    description:
      'Analysis findings involving this wallet that are still current. Open a finding to see the pattern it detected and the transactions behind it, then decide whether it helps explain your wallet’s activity.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 70 },
  },
  'funding-source': {
    id: 'funding-source',
    label: 'Saved output review',
    description:
      'Your saved reviews of individual outputs that funded this wallet. These earlier decisions remain available to revisit; new source reviews are grouped by address.',
    filter: false,
  },
  counterparty: {
    id: 'counterparty',
    label: 'Saved output review',
    description:
      'Your saved reviews of individual outputs created when this wallet spent coins. These earlier decisions remain available to revisit; new destination reviews are grouped by address.',
    filter: false,
  },
} satisfies { [Reason in ReviewReason]: ReviewReasonDefinition<Reason> };

export const walletReviewReasonCategoryDefinitions: readonly WalletReviewCategoryDefinition[] =
  Object.values(walletReviewReasonDefinitions)
    .flatMap((definition) =>
      definition.filter
        ? [
            {
              id: definition.id,
              label: definition.label,
              description: definition.description,
              ...definition.filter,
            },
          ]
        : [],
    )
    .sort((a, b) => a.displayOrder - b.displayOrder);

export const previousOutputDecisionsCategory: WalletReviewCategoryDefinition = {
  id: 'saved-output-reviews',
  label: 'Previous output decisions',
  description:
    'Decisions you saved when reviews were made for individual outputs. You can revisit those decisions here. New source and destination reviews bring related activity together under each address.',
  group: walletReviewGroups.reviewItems,
  displayOrder: 80,
};

export const walletMetadataCategoryDefinitions = [
  {
    id: 'unidentified-sources',
    label: 'Unidentified direct sources',
    description:
      'Source addresses with no label or tags to help you recognize them. Use this list to record where incoming payments came from. Labels on individual coins do not label the address itself.',
    group: walletReviewGroups.labelsAndTags,
    displayOrder: 10,
  },
  {
    id: 'unidentified-destinations',
    label: 'Unidentified direct destinations',
    description:
      'Destination addresses with no label or tags to help you recognize them. Use this list to record who you paid or why you moved the coins. An address here may still belong to you.',
    group: walletReviewGroups.labelsAndTags,
    displayOrder: 20,
  },
  {
    id: 'utxo-missing-label',
    label: 'UTXOs missing labels',
    description:
      'Current unspent coins that have no label of their own. Add a short name to remember where a coin came from or what you are keeping it for. Coins with tags or notes can still appear here.',
    group: walletReviewGroups.labelsAndTags,
    displayOrder: 30,
  },
  {
    id: 'utxo-missing-tags',
    label: 'UTXOs missing tags',
    description:
      'Current unspent coins with no tags, either on the coin itself or inherited from its address. Tags help you group coins by source, purpose or another meaning you choose.',
    group: walletReviewGroups.labelsAndTags,
    displayOrder: 40,
  },
  {
    id: 'utxo-unidentified',
    label: 'UTXOs missing labels and tags',
    description:
      'Current unspent coins with neither a label of their own nor any tags, including tags inherited from their address. Use this list to start organizing your coins.',
    group: walletReviewGroups.labelsAndTags,
    displayOrder: 50,
  },
] as const satisfies readonly WalletReviewCategoryDefinition[];
