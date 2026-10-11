import { describe, expect, it } from 'vitest';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';
import { legacyWorkspace } from '../../../../../tests/fixtures/legacyWorkspace';
import { createWorkspace } from '../../createWorkspace';
import { deriveAddresses } from '../../Wallets/walletDerivation';
import { buildWalletReview, reviewKey } from '../../Wallets/walletReview';
import {
  legacyWalletFindingEvidence,
  walletFindingEvidence,
} from '../../Wallets/walletReviewEvidence';
import type { AnalysisFinding } from '../../Analysis/finding';
import type { Workspace } from '../../workspace';
import { encryptWorkspace, decryptWorkspace } from '../Codec/encryptedEnvelope';
import { decryptAndValidateWorkspace, validateAndEncryptWorkspace } from '../Codec/workspaceCodec';
import { parseWorkspace } from '../Codec/parseWorkspace';

const walletId = '20000000-0000-4000-8000-000000000001';
const txid = 'a'.repeat(64);
const at = '2026-09-10T12:00:00.000Z';
const password = 'public review migration fixture';
const finding: AnalysisFinding = {
  id: 'equal-outputs:public',
  algorithm: 'equal-outputs-v2',
  title: 'Equal outputs',
  description: 'Public synthetic observation',
  nodeIds: [`out:${txid}:0`, `out:${txid}:1`],
  txids: [txid],
  subjects: [`tx:${txid}`],
  createdAt: at,
};
const key = reviewKey(walletId, 'link', finding.id);

function fixture(status: 'reviewed' | 'unknown' | 'later' = 'reviewed') {
  const workspace = createWorkspace('Review migration', 'mainnet');
  workspace.wallets.definitions = [
    {
      id: walletId,
      name: 'Public vector wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#123456',
      addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1).map((address) => ({
        ...address,
        history: [{ tx_hash: txid, height: 1 }],
      })),
    },
  ];
  workspace.chainData.transactions[txid] = {
    txid,
    vin: [{ coinbase: '00' }],
    vout: [
      { n: 0, value: 1, scriptPubKey: { hex: '0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2' } },
      { n: 1, value: 1, scriptPubKey: { hex: '51' } },
    ],
    status: { kind: 'confirmed', confirmations: 1 },
  };
  workspace.analysis.findings = [finding];
  workspace.wallets.reviews = {
    [key]: { status, at, evidence: legacyWalletFindingEvidence(finding) },
  };
  return { ...workspace, version: 7 };
}

const review = (workspace: Workspace) =>
  buildWalletReview(workspace, workspace.wallets.definitions[0]).items.find(
    (item) => item.key === key,
  )!;

describe('saved support baselines for legacy finding decisions', () => {
  it.each(['reviewed', 'unknown', 'later'] as const)(
    'retains the original %s decision without inventing an upgrade change',
    async (status) => {
      const legacy = fixture(status);
      const before = structuredClone(legacy);
      const restored = await decryptAndValidateWorkspace(
        await encryptWorkspace(legacy, password),
        password,
      );
      expect(restored.wallets.reviews?.[key]).toEqual({
        ...legacy.wallets.reviews![key],
        supportEvidence: walletFindingEvidence(restored, finding),
      });
      expect(review(restored)).toMatchObject({ status, changed: false, decidedAt: at });
      expect(legacy).toEqual(before);
      expect(parseWorkspace(restored)).toEqual(restored);
    },
  );

  it('persists a baseline when a legacy document is written directly without dropping unrelated raw fields', async () => {
    const legacy = { ...fixture(), retainedField: 'Public opaque context' };
    const before = structuredClone(legacy);
    const encoded = await validateAndEncryptWorkspace(legacy as unknown as Workspace, password);
    const raw = await decryptWorkspace(encoded, password);
    expect(raw).toMatchObject({
      version: 8,
      retainedField: legacy.retainedField,
      wallets: {
        reviews: {
          [key]: { ...legacy.wallets.reviews![key], supportEvidence: expect.any(String) },
        },
      },
    });
    const restored = await decryptAndValidateWorkspace(encoded, password);
    expect(review(restored)).toMatchObject({ status: 'reviewed', changed: false });
    expect(legacy).toEqual(before);
  });

  it('seeds older flattened documents through the same validated migration boundary', () => {
    const { version: _version, ...legacy } = fixture();
    const flattened = legacyWorkspace({ ...legacy, version: 8 });
    const restored = parseWorkspace(flattened);
    expect(restored.wallets.reviews?.[key].supportEvidence).toBe(
      walletFindingEvidence(restored, finding),
    );
    expect(review(restored)).toMatchObject({ status: 'reviewed', changed: false });
  });

  it('keeps the saved baseline across routine confirmations and reopens material support changes after v8 save/reopen', async () => {
    const restored = parseWorkspace(fixture());
    const baseline = restored.wallets.reviews![key].supportEvidence;
    const refreshed = {
      ...restored,
      chainData: {
        ...restored.chainData,
        transactions: {
          [txid]: {
            ...restored.chainData.transactions[txid],
            status: { kind: 'confirmed' as const, confirmations: 10 },
          },
        },
      },
    };
    expect(review(refreshed)).toMatchObject({ status: 'reviewed', changed: false });
    const changed = {
      ...refreshed,
      chainData: {
        ...refreshed.chainData,
        transactions: {
          [txid]: {
            ...refreshed.chainData.transactions[txid],
            vout: refreshed.chainData.transactions[txid].vout.map((output) => ({
              ...output,
              value: 0.5,
            })),
          },
        },
      },
    };
    expect(review(changed)).toMatchObject({ status: 'reviewed', changed: true, decidedAt: at });
    const reopened = await decryptAndValidateWorkspace(
      await validateAndEncryptWorkspace(changed, password),
      password,
    );
    expect(reopened.wallets.reviews![key].supportEvidence).toBe(baseline);
    expect(reopened.wallets.reviews![key].evidence).toBe(restored.wallets.reviews![key].evidence);
    expect(review(reopened)).toMatchObject({ status: 'reviewed', changed: true });
  });

  it('does not baseline already changed references or stale findings', () => {
    const changedReferences = fixture();
    changedReferences.wallets.reviews![key].evidence = 'previously changed';
    const restored = parseWorkspace(changedReferences);
    expect(restored.wallets.reviews![key].supportEvidence).toBeUndefined();
    expect(review(restored)).toMatchObject({ status: 'reviewed', changed: true });
    const stale = fixture();
    stale.analysis.findings = [{ ...finding, stale: true }];
    expect(parseWorkspace(stale).wallets.reviews![key].supportEvidence).toBeUndefined();
  });
});
