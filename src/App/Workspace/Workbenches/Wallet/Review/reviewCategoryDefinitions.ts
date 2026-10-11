import type { ReviewReason } from '../../../../../Core/Workspace/Wallets/walletReview';
import { toolGroupsInDisplayOrder } from '../../../../../Core/Workspace/Analysis/toolGroups';

export const walletReviewGroups = {
  reviewItems: {
    id: 'review-items',
    label: 'Review items',
    order: 0,
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
    label: 'Transaction description',
    description: 'What a transaction was for. Add a label, note or tag.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 10 },
  },
  'current-utxo': {
    id: 'current-utxo',
    label: 'Coin description',
    description: 'Where a coin came from or what it is for.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 20 },
  },
  'wallet-address': {
    id: 'wallet-address',
    label: 'Prior address acknowledgment',
    description:
      'An acknowledgment of a used receiving or change address from the earlier review workflow. Retained in prior decisions with its original meaning.',
    filter: false,
  },
  source: {
    id: 'source',
    label: 'Prior incoming transaction acknowledgment',
    description:
      'An earlier review of an incoming transaction, retained with its original meaning.',
    filter: false,
  },
  'source-address': {
    id: 'source-address',
    label: 'Sender',
    description: 'Sender of an incoming transaction.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 50 },
  },
  'destination-address': {
    id: 'destination-address',
    label: 'Recipient',
    description: 'Recipient of an outgoing transaction.',
    filter: { group: walletReviewGroups.reviewItems, displayOrder: 60 },
  },
  link: {
    id: 'link',
    label: 'Analysis finding',
    description:
      'Analysis findings involving this wallet that are still current. Open a finding to see the pattern it detected and the transactions behind it, then decide whether it helps explain your wallet’s activity.',
    filter: false,
  },
  'funding-source': {
    id: 'funding-source',
    label: 'Prior funding-output review',
    description:
      'An earlier decision about an individual funding output. Retained in prior decisions with its original meaning; it is not an answer to a new annotation goal.',
    filter: false,
  },
  counterparty: {
    id: 'counterparty',
    label: 'Prior destination-output review',
    description:
      'An earlier decision about an individual destination output. Retained in prior decisions with its original meaning; it is not an answer to a new annotation goal.',
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

export const olderOrUnknownFindingsCategory: WalletReviewCategoryDefinition = {
  id: 'older-or-unknown-findings',
  label: 'Older or unknown findings',
  description:
    'Stored analysis findings whose tool is no longer available or cannot be identified. Refresh to use current tools.',
  group: walletReviewGroups.reviewItems,
  displayOrder: 70,
};
