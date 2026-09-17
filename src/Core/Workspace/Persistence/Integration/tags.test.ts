import { describe, expect, it } from 'vitest';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { buildGraph } from '../../../../App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../createWorkspace';
import { parseWorkspace } from '../../Persistence';
import { buildWalletMatches } from '../../Wallets/walletMatches';
import {
  buildTagIndex,
  tagNodeIds,
  tagsFromLabels,
} from '../../../../App/Workspace/Annotations/tagProjection';
import {
  canonicalEntityReference,
  addressReference,
  outpointReference,
  transactionReference,
} from '../../entityReferences';
import { parseWorkspaceTags, type WorkspaceTag } from '../../Annotations/annotations';
import { deriveAddresses } from '../../Wallets/walletDerivation';
import { listTagsForNode } from '../../Annotations/tagMembership';

import { decryptWorkspace, encryptWorkspace } from '../Codec/encryptedEnvelope';

const txid = (n: number) => n.toString(16).padStart(64, '0');
// Public BIP84 vector, CC0; existing source attribution: docs/references.md.
const account =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const address = deriveAddresses(account, 'mainnet', 'p2wpkh', 0, 0, 1)[0];
const external = deriveAddresses(account, 'mainnet', 'p2wpkh', 0, 1, 1)[0];
const tag = (nodeIds: string[] = []): WorkspaceTag => ({
  id: crypto.randomUUID(),
  name: 'Exchange',
  color: '#aabbcc',
  nodeIds,
});
function fixture() {
  const workspace = createWorkspace('Public wallet fixture', 'mainnet');
  workspace.view.showAddresses = true;
  workspace.wallets.definitions = [
    {
      id: crypto.randomUUID(),
      name: 'Vector wallet',
      key: account,
      scriptType: 'p2wpkh',
      color: '#aabbcc',
      addresses: [address],
    },
  ];
  workspace.chainData.transactions = {
    [txid(1)]: {
      txid: txid(1),
      vin: [{ coinbase: '00' }],
      vout: [
        { n: 0, value: 1, scriptPubKey: { address: address.address } },
        { n: 1, value: 1, scriptPubKey: { address: external.address } },
      ],
    },
    [txid(2)]: {
      txid: txid(2),
      vin: [
        { txid: txid(1), vout: 0 },
        { txid: txid(99), vout: 0 },
      ],
      vout: [{ n: 0, value: 0.9, scriptPubKey: { address: external.address } }],
    },
  };
  return workspace;
}

describe('workspace tag import boundary', () => {
  it('keeps old workspaces compatible and preserves empty tags and view settings', () => {
    const workspace = createWorkspace('Older workspace', 'mainnet');
    expect(parseWorkspace(workspace)).toEqual(workspace);
    expect(
      parseWorkspace({
        ...workspace,
        view: { ...workspace.view, highlightMode: 'tags' },
        annotations: { ...workspace.annotations, tags: [] },
      }),
    ).toMatchObject({ annotations: { tags: [] }, view: { highlightMode: 'tags' } });
    expect(() =>
      parseWorkspace({ ...workspace, view: { ...workspace.view, highlightMode: 'proof' } }),
    ).toThrow();
  });

  it('canonicalizes references and deduplicates members without requiring loaded data', () => {
    const source = tag([
      `tx:${'AB'.repeat(32)}`,
      `tx:${'ab'.repeat(32)}`,
      `out:${txid(2)}:0001`,
      addressReference(address.address.toUpperCase()),
      addressReference(address.address),
    ]);
    const workspace = createWorkspace('Tags', 'mainnet');
    const parsed = parseWorkspace({
      ...workspace,
      annotations: { ...workspace.annotations, tags: [{ ...source, name: ' Exchange ' }] },
    });
    expect(parsed.annotations.tags?.[0]).toMatchObject({
      name: 'Exchange',
      nodeIds: [
        `tx:${'ab'.repeat(32)}`,
        outpointReference(txid(2), 1),
        addressReference(address.address),
      ],
    });
    expect(source.nodeIds).toHaveLength(5);
  });

  it('rejects duplicate identities and case-insensitive names', () => {
    const first = tag();
    expect(() => parseWorkspaceTags([first, { ...first, name: 'Other' }], 'mainnet')).toThrow(
      'duplicate tag IDs',
    );
    expect(() => parseWorkspaceTags([first, { ...tag(), name: ' eXcHaNgE ' }], 'mainnet')).toThrow(
      'duplicate tag names',
    );
  });

  it.each([
    { id: 'not-a-uuid' },
    { name: ' ' },
    { name: 'x'.repeat(101) },
    { color: 'red' },
    { description: 'x'.repeat(2001) },
    { nodeIds: ['__proto__'] },
    { nodeIds: [`out:${txid(1)}:4294967296`] },
    { nodeIds: [`xpub:${account}`] },
    { nodeIds: ['addr:garbage'] },
  ])('rejects malformed tag data: %j', (change) => {
    expect(() => parseWorkspaceTags([{ ...tag(), ...change }], 'mainnet')).toThrow();
  });

  it('rejects wrong-network addresses and accepts the largest uint32 output', () => {
    expect(() => canonicalEntityReference(addressReference(address.address), 'testnet4')).toThrow(
      'Invalid address',
    );
    const testAddress = bitcoinAddress.toBech32(new Uint8Array(20).fill(7), 0, 'tb');
    expect(canonicalEntityReference(addressReference(testAddress), 'testnet4')).toBe(
      addressReference(testAddress),
    );
    expect(canonicalEntityReference(`out:${txid(1)}:4294967295`, 'mainnet')).toBe(
      `out:${txid(1)}:4294967295`,
    );
  });

  it('bounds aggregate memberships before deduplication and total tag count', () => {
    const workspace = createWorkspace('Over budget', 'mainnet');
    expect(() =>
      parseWorkspace({
        ...workspace,
        annotations: {
          ...workspace.annotations,
          tags: Array.from({ length: 201 }, (_, index) => ({ ...tag(), name: `Tag ${index}` })),
        },
      }),
    ).toThrow('200 tags');
    const member = transactionReference(txid(1));
    expect(() =>
      parseWorkspace({
        ...workspace,
        annotations: {
          ...workspace.annotations,
          tags: [
            tag(Array(25_001).fill(member)),
            { ...tag(Array(25_000).fill(member)), name: 'Shop' },
          ],
        },
      }),
    ).toThrow('50,000 tag membership');
  });

  it('keeps tags inside the encrypted payload without changing annotations', async () => {
    const workspace = fixture();
    workspace.annotations.entities[outpointReference(txid(1), 0)] = {
      label: 'Deposit',
      note: 'Private note',
      icon: '★',
      bookmarked: true,
    };
    workspace.annotations.tags = [
      { ...tag([outpointReference(txid(1), 0)]), description: 'Private relationship' },
    ];
    const annotation = structuredClone(workspace.annotations.entities);
    const envelope = await encryptWorkspace(parseWorkspace(workspace), 'public fixture password');
    expect(JSON.stringify(envelope)).not.toContain('Private relationship');
    const restored = parseWorkspace(await decryptWorkspace(envelope, 'public fixture password'));
    expect(restored.annotations.tags).toEqual(workspace.annotations.tags);
    expect(restored.annotations.entities).toEqual(annotation);
    restored.annotations.tags![0].nodeIds.push(transactionReference(txid(2)));
    expect(restored.annotations.entities).toEqual(annotation);
  });
});

describe('manual tag projection', () => {
  it('indexes direct and inherited memberships once, without duplicates', () => {
    const workspace = fixture();
    workspace.annotations.tags = [
      tag([addressReference(address.address), outpointReference(txid(1), 0)]),
      { ...tag([outpointReference(txid(1), 0)]), name: 'Deposit' },
    ];
    const graph = buildGraph(workspace);
    const index = buildTagIndex(workspace, graph);
    expect(index.get(outpointReference(txid(1), 0))).toEqual(workspace.annotations.tags);
    for (const node of graph.nodes)
      expect(new Set(index.get(node.id) ?? [])).toEqual(new Set(listTagsForNode(workspace, node)));
  });
  it('extends address tags to outputs with address nodes hidden, never to their transactions', () => {
    const workspace = fixture();
    workspace.view.showAddresses = false;
    workspace.annotations.tags = [
      tag([addressReference(address.address), transactionReference(txid(99))]),
    ];
    const graph = buildGraph(workspace);
    expect(tagNodeIds(workspace.annotations.tags[0], graph)).toEqual([
      outpointReference(txid(1), 0),
    ]);
    expect(
      listTagsForNode(
        workspace,
        graph.nodes.find((node) => node.id === outpointReference(txid(1), 0))!,
      ),
    ).toEqual(workspace.annotations.tags);
    expect(
      listTagsForNode(
        workspace,
        graph.nodes.find((node) => node.id === transactionReference(txid(1)))!,
      ),
    ).toEqual([]);
    expect(workspace.annotations.tags[0].nodeIds).toContain(transactionReference(txid(99)));
  });

  it('groups explicit nonempty labels as proposals, preserving imported annotations and existing tags', () => {
    const workspace = fixture();
    const annotation = { label: 'Shop', note: 'Keep this note', icon: '★', bookmarked: true };
    workspace.annotations.entities = {
      [transactionReference(txid(1))]: annotation,
      [outpointReference(txid(2), 0)]: { ...annotation, label: ' shop ' },
      [addressReference(address.address)]: { ...annotation, label: 'Exchange' },
      [`xpub:${account}`]: { ...annotation, label: 'Wallet key' },
      [transactionReference(txid(99))]: { ...annotation, label: '' },
    };
    workspace.annotations.tags = [tag()];
    const before = structuredClone(workspace);
    const proposals = tagsFromLabels(workspace);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      name: 'Shop',
      nodeIds: [transactionReference(txid(1)), outpointReference(txid(2), 0)],
    });
    expect(workspace).toEqual(before);
    expect(parseWorkspaceTags(proposals, workspace.network)).toEqual(proposals);
  });
});

describe('verified wallet match projection', () => {
  it('marks only matching outputs and addresses, and labels related transactions as associations', () => {
    const workspace = fixture();
    const matches = buildWalletMatches(workspace, buildGraph(workspace).nodes);
    const walletIds = [workspace.wallets.definitions[0].id];
    expect(matches.get(outpointReference(txid(1), 0))).toEqual({ walletIds, kind: 'output' });
    expect(matches.get(addressReference(address.address))).toEqual({ walletIds, kind: 'address' });
    expect(matches.get(transactionReference(txid(1)))).toEqual({ walletIds, kind: 'transaction' });
    expect(matches.get(transactionReference(txid(2)))).toEqual({ walletIds, kind: 'transaction' });
    expect(matches.has(outpointReference(txid(1), 1))).toBe(false);
    expect(matches.has(outpointReference(txid(2), 0))).toBe(false);
    expect(matches.has(outpointReference(txid(99), 0))).toBe(false);
  });

  it('matches script-only outputs and gives scripts precedence over conflicting address text', () => {
    const workspace = fixture();
    const ownHex = bytesToHex(bitcoinAddress.toOutputScript(address.address, networks.bitcoin));
    const otherHex = bytesToHex(bitcoinAddress.toOutputScript(external.address, networks.bitcoin));
    workspace.chainData.transactions[txid(1)].vout[0].scriptPubKey = { hex: ownHex.toUpperCase() };
    workspace.chainData.transactions[txid(1)].vout[1].scriptPubKey = {
      address: address.address,
      hex: otherHex,
    };
    let matches = buildWalletMatches(workspace, buildGraph(workspace).nodes);
    expect(matches.has(outpointReference(txid(1), 0))).toBe(true);
    expect(matches.has(outpointReference(txid(1), 1))).toBe(false);
    workspace.chainData.transactions[txid(1)].vout[0].scriptPubKey = {
      address: address.address,
      hex: '',
    };
    matches = buildWalletMatches(workspace, buildGraph(workspace).nodes);
    expect(matches.has(outpointReference(txid(1), 0))).toBe(false);
  });

  it('does not infer input matches from wallet history or a missing parent, even on filtered graphs', () => {
    const workspace = fixture();
    delete workspace.chainData.transactions[txid(1)];
    workspace.wallets.definitions[0].addresses[0] = {
      ...address,
      history: [{ tx_hash: txid(2), height: 100 }],
    };
    expect(buildWalletMatches(workspace, buildGraph(workspace).nodes).size).toBe(0);
    const loaded = fixture();
    const filtered = {
      nodes: buildGraph(loaded).nodes.filter((node) => node.kind === 'transaction'),
      links: [],
    };
    expect(
      buildWalletMatches(loaded, filtered.nodes).get(transactionReference(txid(2)))?.kind,
    ).toBe('transaction');
  });

  it('retains multiple matching wallets and ignores inconsistent wallet address hashes', () => {
    const workspace = fixture();
    workspace.wallets.definitions.push({
      ...workspace.wallets.definitions[0],
      id: crypto.randomUUID(),
      name: 'Second import',
    });
    const graph = buildGraph(workspace);
    expect(
      buildWalletMatches(workspace, graph.nodes).get(outpointReference(txid(1), 0))?.walletIds,
    ).toEqual(workspace.wallets.definitions.map((wallet) => wallet.id));
    workspace.wallets.definitions = [
      { ...workspace.wallets.definitions[0], addresses: [{ ...address, scripthash: txid(123) }] },
    ];
    expect(buildWalletMatches(workspace, graph.nodes).size).toBe(0);
  });
});
