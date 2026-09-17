import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  indexPreviousOutputs,
  mergeTransactionObservations,
  resolvePreviousOutput,
  parseTransaction,
  type Transaction,
} from '../../../src/Core/ChainData';
import { buildGraph } from '../../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';

import { outpointReference } from '../../../src/Core/Workspace/entityReferences';

import { flowInputPlan } from '../../../src/App/Workspace/Workbenches/Graph/TransactionFlow/flowInputPlan';

const id = (n: number) => n.toString(16).padStart(64, '0');
const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
const script = bytesToHex(bitcoinAddress.toOutputScript(address, networks.bitcoin));
const prevout = (value = 1, hex = script) => ({
  value,
  scriptPubKey: { hex, address, type: 'witness_v0_keyhash' },
});
const spend = (details = prevout()): Transaction => ({
  txid: id(2),
  vin: [{ txid: id(1), vout: 3, prevout: details }],
  vout: [{ n: 0, value: 0.99, scriptPubKey: { hex: '51' } }],
  vsize: 100,
});

describe('previous-output observations', () => {
  it('keeps enriched input details without fabricating a creating transaction', () => {
    const workspace = createWorkspace('Enriched', 'mainnet');
    workspace.chainData.transactions[id(2)] = spend();
    const parsed = parseWorkspace(structuredClone(workspace));
    const resolution = resolvePreviousOutput(
      { network: parsed.network, transactions: parsed.chainData.transactions },
      parsed.chainData.transactions[id(2)].vin[0],
      indexPreviousOutputs({
        network: parsed.network,
        transactions: parsed.chainData.transactions,
      }),
    );
    expect(resolution).toMatchObject({
      status: 'attached',
      output: { n: 3, value: 1, scriptPubKey: { hex: script } },
    });
    expect(parsed.chainData.transactions[id(1)]).toBeUndefined();
    expect(
      buildGraph(parsed).nodes.find((node) => node.id === outpointReference(id(1), 3)),
    ).toMatchObject({
      value: 100_000_000,
      address,
    });
    expect(
      buildGraph(parsed).links.some(
        (link) => link.kind === 'creates' && link.target === outpointReference(id(1), 3),
      ),
    ).toBe(false);
  });

  it('keeps old transactions compatible and treats missing values as unknown', () => {
    const old = spend();
    delete old.vin[0].prevout;
    expect(parseTransaction(old)).toEqual(old);
    const workspace = createWorkspace('Old import', 'mainnet');
    workspace.chainData.transactions[old.txid] = old;
    expect(
      resolvePreviousOutput(
        { network: workspace.network, transactions: workspace.chainData.transactions },
        old.vin[0],
      ).status,
    ).toBe('missing');
    expect(
      buildGraph(workspace).nodes.find((node) => node.id === outpointReference(id(1), 3))?.value,
    ).toBeUndefined();
  });

  it('rejects malformed, wrong-network, coinbase, and over-limit attached evidence', () => {
    const valid = spend();
    for (const input of [
      { txid: id(1), vout: 3, prevout: { ...prevout(), value: 0.000000001 } },
      { txid: id(1), vout: 3, prevout: { ...prevout(), scriptPubKey: { address } } },
      { txid: id(1), vout: 3, prevout: { ...prevout(), scriptPubKey: { hex: 'zz' } } },
      { coinbase: '00', prevout: prevout() },
    ])
      expect(() => parseTransaction({ ...valid, vin: [input] })).toThrow();

    const testnetAddress = bitcoinAddress.toBech32(new Uint8Array(20).fill(2), 0, 'tb');
    const workspace = createWorkspace('Wrong network', 'mainnet');
    workspace.chainData.transactions[valid.txid] = {
      ...valid,
      vin: [
        {
          txid: id(1),
          vout: 3,
          prevout: { ...prevout(), scriptPubKey: { hex: script, address: testnetAddress } },
        },
      ],
    };
    expect(() => parseWorkspace(workspace)).toThrow('invalid address for mainnet');

    expect(() =>
      parseTransaction({
        ...valid,
        vin: [
          { txid: id(1), vout: 0, prevout: prevout(11_000_000) },
          { txid: id(3), vout: 0, prevout: prevout(11_000_000) },
        ],
      }),
    ).toThrow('previous-output total');
  });

  it('rejects imported conflicts and reports runtime conflicts as unknown', () => {
    const workspace = createWorkspace('Conflict', 'mainnet');
    const first = spend(prevout(1));
    const second = { ...spend(prevout(2)), txid: id(3) };
    workspace.chainData.transactions = { [first.txid]: first, [second.txid]: second };
    expect(
      indexPreviousOutputs({
        network: workspace.network,
        transactions: workspace.chainData.transactions,
      }).get(`${id(1)}:3`),
    ).toEqual({
      status: 'conflict',
    });
    expect(() => parseWorkspace(workspace)).toThrow('conflicting previous-output');

    workspace.chainData.transactions = {
      [first.txid]: first,
      [id(1)]: {
        txid: id(1),
        vin: [{ coinbase: '00' }],
        vout: Array.from({ length: 4 }, (_, n) => ({
          n,
          value: n === 3 ? 2 : 0,
          scriptPubKey: { hex: script },
        })),
      },
    };
    expect(
      resolvePreviousOutput(
        { network: workspace.network, transactions: workspace.chainData.transactions },
        first.vin[0],
      ).status,
    ).toBe('conflict');

    workspace.chainData.transactions[id(1)].vout = workspace.chainData.transactions[
      id(1)
    ].vout.slice(0, 3);
    expect(
      resolvePreviousOutput(
        { network: workspace.network, transactions: workspace.chainData.transactions },
        first.vin[0],
      ).status,
    ).toBe('conflict');
    expect(() => parseWorkspace(workspace)).toThrow('conflicting previous-output');

    delete workspace.chainData.transactions[first.txid].vin[0].prevout;
    expect(
      resolvePreviousOutput(
        { network: workspace.network, transactions: workspace.chainData.transactions },
        first.vin[0],
      ).status,
    ).toBe('conflict');
    expect(() => parseWorkspace(workspace)).toThrow('conflicting previous-output');
  });

  it('preserves compatible enrichment across sparse refreshes and rejects replacements', () => {
    const enriched = spend();
    const sparse = structuredClone(enriched);
    delete sparse.vin[0].prevout;
    expect(mergeTransactionObservations(enriched, sparse, 'mainnet').vin[0].prevout).toEqual(
      enriched.vin[0].prevout,
    );
    expect(() => mergeTransactionObservations(enriched, spend(prevout(2)), 'mainnet')).toThrow(
      'Conflicting previous-output',
    );
  });

  it('skips enriched parents during bulk hydration but keeps selected-input navigation', () => {
    const workspace = createWorkspace('Flow', 'mainnet');
    workspace.chainData.transactions[id(2)] = spend();
    const txNode = buildGraph(workspace).nodes.find((node) => node.id === `tx:${id(2)}`)!;
    const inputNode = buildGraph(workspace).nodes.find(
      (node) => node.id === outpointReference(id(1), 3),
    )!;
    expect(flowInputPlan(workspace, txNode, true).missing).toEqual([]);
    expect(flowInputPlan(workspace, inputNode).missing).toEqual([id(1)]);
  });
});
