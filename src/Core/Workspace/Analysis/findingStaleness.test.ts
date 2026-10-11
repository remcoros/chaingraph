import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../createWorkspace';
import { analysisTools } from './analysis';
import { findingAssessmentInputs, findingInputs, invalidateFindings } from './findingStaleness';
import { scanAnalysis, analysisScanScope, scanDefaults, analysisScanMatches } from './analysisScan';
import { RECEIVE_ADDRESS, SECOND_ADDRESS } from '../../../../tests/fixtures/bitcoin';
import { addressToScriptHash } from '../../Bitcoin';

const txid = 'a'.repeat(64),
  parent = 'b'.repeat(64);
function fixture() {
  const workspace = createWorkspace('Public dependency fixture', 'mainnet');
  workspace.chainData.transactions[txid] = {
    txid,
    vin: [{ txid: parent, vout: 0 }],
    vout: [0, 1, 2].map((n) => ({ n, value: 0.1, scriptPubKey: { hex: '51' } })),
    vsize: 200,
    status: { kind: 'confirmed' as const, confirmations: 1 },
  };
  workspace.analysis.findings = analysisTools.flatMap((tool) =>
    tool.run(workspace, undefined, tool.id === 'equal-outputs' ? { minInputs: 1 } : {}),
  );
  return workspace;
}

describe('finding-specific staleness', () => {
  it('keeps wallet names in computational dependencies but outside assessment evidence', () => {
    const before = fixture();
    const walletFinding = {
      ...before.analysis.findings[0],
      id: 'wallet-name-support',
      algorithm: 'wallet-intersections-v2',
    };
    before.analysis.findings = [walletFinding];
    before.wallets.definitions = [
      {
        id: 'public-wallet',
        name: 'Original wallet',
        key: '',
        scriptType: 'p2wpkh',
        color: '#27c4a7',
        addresses: [
          {
            address: RECEIVE_ADDRESS,
            scripthash: addressToScriptHash(RECEIVE_ADDRESS, 'mainnet'),
            path: 'account/0/0',
            branch: 0,
            index: 0,
          },
        ],
      },
    ];
    const renamed = {
      ...before,
      wallets: {
        ...before.wallets,
        definitions: [{ ...before.wallets.definitions[0], name: 'Renamed wallet' }],
      },
    };
    expect(findingInputs(renamed, walletFinding)).not.toBe(findingInputs(before, walletFinding));
    expect(invalidateFindings(before, renamed).analysis.findings[0].stale).toBe(true);
    expect(findingAssessmentInputs(renamed, walletFinding)).toBe(
      findingAssessmentInputs(before, walletFinding),
    );

    const newAssociation = {
      ...renamed,
      wallets: {
        ...renamed.wallets,
        definitions: [
          {
            ...renamed.wallets.definitions[0],
            addresses: [
              {
                ...renamed.wallets.definitions[0].addresses[0],
                address: SECOND_ADDRESS,
                scripthash: addressToScriptHash(SECOND_ADDRESS, 'mainnet'),
              },
            ],
          },
        ],
      },
    };
    expect(findingAssessmentInputs(newAssociation, walletFinding)).not.toBe(
      findingAssessmentInputs(before, walletFinding),
    );
  });

  it('keeps value support material while excluding placement and observation dates', () => {
    const before = fixture();
    const finding = before.analysis.findings.find((item) =>
      item.algorithm.startsWith('value-flow'),
    )!;
    const refreshed = {
      ...before,
      chainData: {
        ...before.chainData,
        transactions: {
          ...before.chainData.transactions,
          [txid]: {
            ...before.chainData.transactions[txid],
            status: {
              kind: 'confirmed' as const,
              confirmations: 20,
              blocktime: 1_790_000_000,
              observation: { source: 'core' as const, observedAt: '2026-10-10T12:00:00Z' },
            },
          },
        },
      },
    };
    const material = {
      ...refreshed,
      chainData: {
        ...refreshed.chainData,
        transactions: {
          ...refreshed.chainData.transactions,
          [txid]: { ...refreshed.chainData.transactions[txid], vsize: 400 },
        },
      },
    };
    expect(findingAssessmentInputs(refreshed, finding)).toBe(
      findingAssessmentInputs(before, finding),
    );
    expect(findingAssessmentInputs(material, finding)).not.toBe(
      findingAssessmentInputs(before, finding),
    );
  });

  it('invalidates a wallet-dependent finding on changed derived coverage, but not a structure-only finding', () => {
    const before = fixture();
    const equal = before.analysis.findings.find((finding) =>
      finding.algorithm.startsWith('equal-outputs'),
    )!;
    const walletFinding = { ...equal, id: 'wallet-support', algorithm: 'wallet-intersections-v1' };
    before.analysis.findings = [equal, walletFinding];
    const wallet = {
      id: 'public-wallet',
      name: 'Public wallet',
      key: '',
      scriptType: 'p2wpkh' as const,
      color: '#27c4a7',
      addresses: [],
    };
    before.wallets.definitions = [wallet];
    const after = {
      ...before,
      wallets: {
        ...before.wallets,
        definitions: [
          {
            ...wallet,
            addresses: [
              {
                address: RECEIVE_ADDRESS,
                scripthash: addressToScriptHash(RECEIVE_ADDRESS, 'mainnet'),
                path: 'account/0/0',
                branch: 0 as const,
                index: 0,
              },
            ],
          },
        ],
      },
    };
    const findings = invalidateFindings(before, after).analysis.findings;
    expect(findings[0]).toBe(equal);
    expect(findings[1].stale).toBe(true);
  });

  it('guards completed analysis publication against relevant content changes, not unrelated document edits', async () => {
    const before = fixture();
    const scope = analysisScanScope(before, { id: `tx:${txid}`, kind: 'transaction', txid });
    const scan = await scanAnalysis(before, scope, scanDefaults());
    const unrelated = {
      ...before,
      name: 'Renamed during scan',
      annotations: {
        ...before.annotations,
        entities: {
          [`tx:${txid}`]: { label: 'A human label', note: '', icon: '', bookmarked: false },
        },
      },
      chainData: {
        ...before.chainData,
        transactions: {
          ...before.chainData.transactions,
          ['c'.repeat(64)]: { txid: 'c'.repeat(64), vin: [{ coinbase: '00' }], vout: [] },
        },
      },
    };
    expect(analysisScanMatches(scan, unrelated)).toBe(true);
    const relevant = {
      ...unrelated,
      chainData: {
        ...unrelated.chainData,
        transactions: {
          ...unrelated.chainData.transactions,
          [txid]: { ...before.chainData.transactions[txid], vsize: 400 },
        },
      },
    };
    expect(analysisScanMatches(scan, relevant)).toBe(false);
  });
  it('does not invalidate structure-only findings when only confirmations change', () => {
    const before = fixture();
    const after = {
      ...before,
      chainData: {
        ...before.chainData,
        transactions: {
          ...before.chainData.transactions,
          [txid]: {
            ...before.chainData.transactions[txid],
            status: { kind: 'confirmed' as const, confirmations: 20 },
          },
        },
      },
    };
    expect(invalidateFindings(before, after).analysis.findings).toBe(before.analysis.findings);
  });

  it('invalidates missing-fee input support but not equal-output support when a prevout is resolved', () => {
    const before = fixture();
    const after = {
      ...before,
      chainData: {
        ...before.chainData,
        transactions: {
          ...before.chainData.transactions,
          [txid]: {
            ...before.chainData.transactions[txid],
            vin: [{ txid: parent, vout: 0, prevout: { value: 0.4, scriptPubKey: { hex: '51' } } }],
          },
        },
      },
    };
    const findings = invalidateFindings(before, after).analysis.findings;
    expect(findings.find((f) => f.algorithm.startsWith('value-flow'))?.stale).toBe(true);
    const equal = findings.find((f) => f.algorithm.startsWith('equal-outputs'));
    expect(equal).toBeDefined();
    expect(equal?.stale).not.toBe(true);
  });

  it('ignores unrelated loaded transactions and user annotations', () => {
    const before = fixture();
    const after = {
      ...before,
      chainData: {
        ...before.chainData,
        transactions: {
          ...before.chainData.transactions,
          ['c'.repeat(64)]: { txid: 'c'.repeat(64), vin: [{ coinbase: '00' }], vout: [] },
        },
      },
    };
    expect(invalidateFindings(before, after).analysis.findings).toBe(before.analysis.findings);
  });
});
