import { describe, expect, it } from 'vitest';
import { REVIEW_REASONS } from '../../../../../Core/Workspace/Wallets/walletReview';
import { walletReviewReasonDefinitions } from './reviewCategoryDefinitions';

describe('wallet review category definitions', () => {
  it('defines presentation for every Core review reason', () => {
    expect(Object.keys(walletReviewReasonDefinitions).sort()).toEqual([...REVIEW_REASONS].sort());
    for (const definition of Object.values(walletReviewReasonDefinitions)) {
      expect(definition.label).toBeTruthy();
      expect(definition.description).toBeTruthy();
    }
  });
});
