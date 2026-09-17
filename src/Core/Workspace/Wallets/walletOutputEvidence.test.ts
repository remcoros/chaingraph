import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { createWalletOutputEvidenceResolver } from './walletOutputEvidence';
import { buildWalletSelectionIndex } from './walletSelectionIndex';
import { groupWalletRelationships } from './walletRelationships';
import { buildWalletReview } from './walletReview';
import { createWorkspace } from '../createWorkspace';
import { type TxOutput, addressToScriptHash } from '../../Bitcoin';
import type { Wallet } from './wallets';
import type { Workspace } from '../workspace';

import {
  RECEIVE_ADDRESS,
  SECOND_ADDRESS,
  PUBLIC_ZPUB,
  TX_FUNDING,
  TX_SPENDING,
  transactions,
} from '../../../../tests/fixtures/bitcoin';

const script = bytesToHex(bitcoinAddress.toOutputScript(RECEIVE_ADDRESS, networks.bitcoin));
const output = (scriptPubKey: TxOutput['scriptPubKey']): TxOutput => ({
  n: 0,
  value: 1,
  scriptPubKey,
});

describe('snapshot-scoped wallet output evidence', () => {
  it('shares raw script decoding across outputs despite conflicting address metadata', () => {
    const evidence = createWalletOutputEvidenceResolver('mainnet');
    const first = evidence(output({ hex: script, address: SECOND_ADDRESS }));
    const second = evidence({ ...output({ hex: script.toUpperCase() }), n: 7, value: 0.5 });
    expect(second).toBe(first);
    expect(first).toEqual({
      address: RECEIVE_ADDRESS,
      scripthash: addressToScriptHash(RECEIVE_ADDRESS, 'mainnet'),
    });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('keeps networks and separate snapshots isolated', () => {
    const mainnet = createWalletOutputEvidenceResolver('mainnet');
    const testnet = createWalletOutputEvidenceResolver('testnet4');
    const raw = output({ hex: script });
    const testAddress = bitcoinAddress.fromOutputScript(
      bitcoinAddress.toOutputScript(RECEIVE_ADDRESS, networks.bitcoin),
      networks.testnet,
    );
    expect(testnet(raw)).toEqual({
      address: testAddress,
      scripthash: mainnet(raw).scripthash,
    });
    expect(testnet(output({ address: RECEIVE_ADDRESS }))).toEqual({});
    expect(mainnet(output({ address: testAddress }))).toEqual({});
    expect(createWalletOutputEvidenceResolver('mainnet')(raw)).not.toBe(mainnet(raw));
  });

  it('never merges invalid mixed-case or multiple address claims with valid evidence', () => {
    const evidence = createWalletOutputEvidenceResolver('mainnet');
    expect(evidence(output({ address: RECEIVE_ADDRESS })).address).toBe(RECEIVE_ADDRESS);
    expect(evidence(output({ address: RECEIVE_ADDRESS.toUpperCase() })).address).toBe(
      RECEIVE_ADDRESS,
    );
    expect(evidence(output({ address: 'BC' + RECEIVE_ADDRESS.slice(2) }))).toEqual({});
    expect(evidence(output({ addresses: [RECEIVE_ADDRESS, SECOND_ADDRESS] }))).toEqual({});
    expect(evidence(output({ addresses: [RECEIVE_ADDRESS] }))).toBe(
      evidence(output({ address: RECEIVE_ADDRESS })),
    );
  });

  it('retains failed and non-address decodes without trusting fallback address text', () => {
    const evidence = createWalletOutputEvidenceResolver('mainnet');
    for (const hex of ['malformed', 'abc', '', '6a00']) {
      const first = evidence(output({ hex, address: RECEIVE_ADDRESS }));
      expect(first.address).toBeUndefined();
      expect(evidence(output({ hex, address: SECOND_ADDRESS }))).toBe(first);
      if (hex === '' || hex === '6a00') expect(first.scripthash).toMatch(/^[0-9a-f]{64}$/);
      else expect(first).toEqual({});
    }
    expect(evidence(undefined)).toEqual({});
  });

  it('shares evidence across selection, relationships and review, including attached prevouts', () => {
    const wallet: Wallet = {
      id: 'evidence-wallet',
      name: 'Public fixture',
      key: PUBLIC_ZPUB,
      color: '#27c4a7',
      scriptType: 'p2wpkh',
      addresses: [
        {
          address: RECEIVE_ADDRESS,
          scripthash: addressToScriptHash(RECEIVE_ADDRESS, 'mainnet'),
          branch: 0,
          index: 0,
          path: 'account/0/0',
        },
      ],
    };
    const workspace: Workspace = {
      ...createWorkspace('Public evidence fixture', 'mainnet'),
      wallets: {
        ...createWorkspace('Public evidence fixture', 'mainnet').wallets,
        definitions: [wallet],
      },
      chainData: {
        ...createWorkspace('Public evidence fixture', 'mainnet').chainData,
        transactions: structuredClone(transactions),
      },
    };
    const { n: _, ...prevout } = workspace.chainData.transactions[TX_FUNDING].vout[0];
    workspace.chainData.transactions[TX_SPENDING].vin[0].prevout = prevout;
    delete workspace.chainData.transactions[TX_FUNDING];
    const evidence = createWalletOutputEvidenceResolver(workspace.network);
    const index = buildWalletSelectionIndex(workspace, evidence);
    const relationships = groupWalletRelationships(workspace, wallet, index.prevouts, evidence);
    expect(index.prevouts.get(`${TX_FUNDING}:0`)?.status).toBe('attached');
    expect(index.scriptTransactionIds.get(wallet.addresses[0].scripthash)).toEqual([TX_SPENDING]);
    expect(relationships).toEqual(groupWalletRelationships(workspace, wallet));
    expect(relationships.destinations.length).toBeGreaterThan(0);
    expect(
      buildWalletReview(workspace, wallet, { prevouts: index.prevouts, relationships, evidence }),
    ).toEqual(buildWalletReview(workspace, wallet));
  });
});
