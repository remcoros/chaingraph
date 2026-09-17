import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { addressReference, outpointReference } from '../../../Core/Workspace/entityReferences';
import type { Network } from '../../../Core/Bitcoin';
import type { Transaction } from '../../../Core/ChainData';
import { buildGraph } from './graphEvidence';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../Core/Workspace/Persistence';

const id = (n: number) => n.toString(16).padStart(64, '0');
function fixture(network: Network = 'mainnet') {
  const address = bitcoinAddress.toBech32(
    new Uint8Array(20).fill(1),
    0,
    network === 'mainnet' ? 'bc' : 'tb',
  );
  const script = bytesToHex(
    bitcoinAddress.toOutputScript(
      address,
      network === 'mainnet' ? networks.bitcoin : networks.testnet,
    ),
  );
  const prevout = { value: 1, scriptPubKey: { hex: script, address } };
  const spender: Transaction = {
    txid: id(2),
    vin: [{ txid: id(1), vout: 0, prevout }],
    vout: [{ n: 0, value: 0.99, scriptPubKey: { hex: '51' } }],
  };
  const workspace = createWorkspace('Public attached address fixture', network);
  workspace.chainData.transactions = { [spender.txid]: spender };
  workspace.view.showAddresses = true;
  return { workspace, address, spender, prevout };
}

describe('graph addresses from attached input evidence', () => {
  it.each(['mainnet', 'testnet4'] as const)(
    'exposes an attached address on %s without inventing its creating transaction',
    (network) => {
      const { workspace, address } = fixture(network);
      const parsed = parseWorkspace(workspace);
      const before = structuredClone(parsed);
      const graph = buildGraph(parsed);
      const outputId = outpointReference(id(1), 0);
      expect(graph.nodes.find((node) => node.id === addressReference(address))).toMatchObject({
        kind: 'address',
        address,
      });
      expect(graph.links.filter((link) => link.kind === 'address')).toEqual([
        {
          id: `${outputId}>${addressReference(address)}`,
          source: outputId,
          target: addressReference(address),
          kind: 'address',
        },
      ]);
      expect(graph.nodes.some((node) => node.id === `tx:${id(1)}`)).toBe(false);
      expect(graph.links.some((link) => link.kind === 'creates' && link.target === outputId)).toBe(
        false,
      );
      expect(parsed.chainData.watchedAddresses).toEqual([]);
      expect(parsed).toEqual(before);
    },
  );

  it('keeps the address toggle off without losing known output metadata', () => {
    const { workspace, address } = fixture();
    workspace.view.showAddresses = false;
    const graph = buildGraph(workspace);
    expect(graph.nodes.some((node) => node.kind === 'address')).toBe(false);
    expect(graph.links.some((link) => link.kind === 'address')).toBe(false);
    expect(graph.nodes.find((node) => node.id === outpointReference(id(1), 0))?.address).toBe(
      address,
    );
  });

  it('keeps one address link after loading the creator and across repeated input observations', () => {
    const { workspace, address, prevout, spender } = fixture();
    workspace.chainData.transactions[id(3)] = { ...spender, txid: id(3) };
    for (const loadCreator of [false, true]) {
      if (loadCreator)
        workspace.chainData.transactions[id(1)] = {
          txid: id(1),
          vin: [{ coinbase: '00' }],
          vout: [{ n: 0, ...prevout }],
        };
      const graph = buildGraph(workspace);
      expect(graph.nodes.filter((node) => node.id === addressReference(address))).toHaveLength(1);
      expect(graph.links.filter((link) => link.kind === 'address')).toHaveLength(1);
      expect(graph.links.filter((link) => link.kind === 'spends')).toHaveLength(2);
    }
  });

  it.each(['missing', 'conflicting'] as const)(
    'does not create address links from %s input evidence',
    (status) => {
      const { workspace, spender, prevout } = fixture();
      if (status === 'missing') delete spender.vin[0].prevout;
      else
        workspace.chainData.transactions[id(3)] = {
          ...spender,
          txid: id(3),
          vin: [{ txid: id(1), vout: 0, prevout: { ...prevout, value: 2 } }],
        };
      const graph = buildGraph(workspace);
      expect(graph.nodes.filter((node) => node.kind === 'address')).toEqual([]);
      expect(graph.links.filter((link) => link.kind === 'address')).toEqual([]);
      expect(
        graph.nodes.find((node) => node.id === outpointReference(id(1), 0))?.address,
      ).toBeUndefined();
    },
  );
});
