import { describe, expect, it } from 'vitest';
import { REVIEW_REASONS } from '../../../../../Core/Workspace/Wallets/walletReview';
import {
  previousOutputDecisionsCategory,
  walletMetadataCategoryDefinitions,
  walletReviewGroupsInDisplayOrder,
  walletReviewReasonCategoryDefinitions,
  walletReviewReasonDefinitions,
} from './reviewCategoryDefinitions';

describe('wallet review category definitions', () => {
  it('defines presentation for every Core review reason', () => {
    expect(Object.keys(walletReviewReasonDefinitions).sort()).toEqual([...REVIEW_REASONS].sort());
    for (const definition of Object.values(walletReviewReasonDefinitions)) {
      expect(definition.label).toBeTruthy();
      expect(definition.description).toBeTruthy();
    }
  });

  it('keeps Wallet filter group and option order explicit', () => {
    expect(walletReviewGroupsInDisplayOrder.map((group) => group.id)).toEqual([
      'review-items',
      'labels-and-tags',
      'privacy-patterns',
      'value-and-structure',
      'imported-wallets',
    ]);
    expect(walletReviewReasonCategoryDefinitions.map((definition) => definition.id)).toEqual([
      'current-utxo',
      'wallet-address',
      'source',
      'source-address',
      'new-activity',
      'destination-address',
      'link',
    ]);
    expect(walletMetadataCategoryDefinitions.map((definition) => definition.id)).toEqual([
      'unidentified-sources',
      'unidentified-destinations',
      'utxo-missing-label',
      'utxo-missing-tags',
      'utxo-unidentified',
    ]);
    expect(previousOutputDecisionsCategory).toMatchObject({
      id: 'saved-output-reviews',
      displayOrder: 80,
    });
  });

  it('uses unique display positions within each Wallet-owned group', () => {
    const definitions = [
      ...walletReviewReasonCategoryDefinitions,
      previousOutputDecisionsCategory,
      ...walletMetadataCategoryDefinitions,
    ];
    for (const group of walletReviewGroupsInDisplayOrder.slice(0, 2)) {
      const positions = definitions
        .filter((definition) => definition.group.id === group.id)
        .map((definition) => definition.displayOrder);
      expect(new Set(positions).size).toBe(positions.length);
    }
  });
});
