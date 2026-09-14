import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  newWorkspace,
  parseWorkspace,
  parseTransaction,
  outputAddress,
  WorkspaceValidationError,
} from '../src/Domain/Workspace/workspace';
import { analysisTools } from '../src/Domain/Analysis/analysis';
import { outputNodeId, txNodeId, type Transaction, type Wallet } from '../src/Domain/types';
import { laboratoryWorkspace } from './fixtures/laboratory';

const id = (n: number) => n.toString(16).padStart(64, '0');
function tx(
  n: number,
  inputs: { txid: string; vout: number }[],
  outputs: { address: string; value: number }[],
): Transaction {
  return {
    txid: id(n),
    vin: inputs.length ? inputs : [{ coinbase: '0101' }],
    vout: outputs.map((output, index) => ({
      n: index,
      value: output.value,
      scriptPubKey: { address: output.address },
    })),
  };
}
const addrA = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const addrB = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const findTool = (name: string) => analysisTools.find((tool) => tool.id === name)!;

describe('workspace graph and analysis', () => {
  it('connects funding and spending outputs, preserving unknown funding nodes and annotations', () => {
    const w = newWorkspace('Investigation', 'mainnet');
    const funding = tx(1, [], [{ address: addrA, value: 1 }]);
    const spending = tx(
      2,
      [
        { txid: id(1), vout: 0 },
        { txid: id(99), vout: 1 },
      ],
      [{ address: addrB, value: 0.9 }],
    );
    w.transactions = { [funding.txid]: funding, [spending.txid]: spending };
    w.annotations[outputNodeId(id(1), 0)] = {
      label: 'Savings',
      note: 'User provenance',
      bookmarked: true,
      icon: '🔒',
    };
    const graph = buildGraph(w);
    expect(graph.nodes.find((node) => node.id === outputNodeId(id(1), 0))).toMatchObject({
      label: '🔒 Savings',
      value: 100_000_000,
    });
    expect(w.annotations[outputNodeId(id(1), 0)].label).toBe('Savings');
    expect(graph.nodes.find((node) => node.id === outputNodeId(id(99), 1))).toMatchObject({
      kind: 'output',
      txid: id(99),
      vout: 1,
    });
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        source: outputNodeId(id(1), 0),
        target: txNodeId(id(2)),
        kind: 'spends',
      }),
    );
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.links.every((link) => ids.has(link.source) && ids.has(link.target))).toBe(true);
  });

  it('builds a 150-input/output transaction without losing outpoints or spending edges', () => {
    const w = newWorkspace('Large transaction', 'mainnet');
    const big = tx(
      999,
      Array.from({ length: 150 }, (_, n) => ({ txid: id(n + 1), vout: 0 })),
      Array.from({ length: 150 }, () => ({ address: addrA, value: 0.01 })),
    );
    w.transactions[big.txid] = big;
    const graph = buildGraph(w);
    expect(graph.nodes).toHaveLength(301);
    expect(graph.links).toHaveLength(300);
    expect(findTool('equal-outputs').run(w)).toHaveLength(1);
    expect(findTool('cioh').run(w)).toEqual([]);
  });

  it('treats common inputs as removable hypotheses and excludes equal-output candidates', () => {
    const w = newWorkspace('Hypotheses', 'mainnet');
    const funding = tx(
      1,
      [],
      [
        { address: addrA, value: 1 },
        { address: addrB, value: 1 },
      ],
    );
    const spending = tx(
      2,
      [
        { txid: id(1), vout: 0 },
        { txid: id(1), vout: 1 },
      ],
      [{ address: addrA, value: 1.9 }],
    );
    w.transactions = { [funding.txid]: funding, [spending.txid]: spending };
    const findings = findTool('cioh').run(w);
    expect(findings).toHaveLength(1);
    expect(new Set(findings[0].nodeIds)).toEqual(
      new Set([outputNodeId(id(1), 0), outputNodeId(id(1), 1)]),
    );
    expect(findings[0].description).toContain('PayJoin');
    w.findings = findings;
    expect(buildGraph(w).nodes.filter((node) => node.cluster)).toHaveLength(2);
    w.findings = findings.map((finding) => ({ ...finding, excluded: true }));
    expect(buildGraph(w).nodes.filter((node) => node.cluster)).toHaveLength(0);
  });

  it('reports address reuse only within loaded outputs and keeps labels on roundtrip', () => {
    const w = newWorkspace('Labeled wallet', 'mainnet');
    w.transactions[id(1)] = tx(
      1,
      [],
      [
        { address: addrA, value: 1 },
        { address: addrA, value: 2 },
      ],
    );
    w.annotations[txNodeId(id(1))] = {
      label: 'Funding',
      note: 'Personal note',
      bookmarked: true,
      icon: '★',
    };
    w.findings = findTool('address-reuse').run(w);
    const parsed = parseWorkspace(JSON.parse(JSON.stringify(w)));
    expect(parsed.annotations).toEqual(w.annotations);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].nodeIds).toHaveLength(2);
    expect(parsed.findings[0].txids).toEqual([id(1)]);
    expect(parsed.findings[0].description).toContain('within this transaction');
    expect(parsed.findings[0].details).toContain('loaded history');
    expect(parsed.findings).toEqual(w.findings);
    expect(parsed.findings[0].description).toContain(
      'not evidence of repeated receiving activity across separate transactions',
    );
  });

  it('rejects malformed workspace versions, network names and mismatched transaction keys', () => {
    const w = newWorkspace('Import boundary', 'mainnet');
    expect(() => parseWorkspace({ ...w, version: 5 })).toThrow();
    expect(() => parseWorkspace({ ...w, network: 'testnet' })).toThrow();
    expect(() =>
      parseWorkspace({
        ...w,
        transactions: { [id(10)]: tx(11, [], [{ address: addrA, value: 1 }]) },
      }),
    ).toThrow('invalid transaction records');
  });

  it('does not attribute legacy multi-address scripts to their first address', () => {
    const output = { n: 0, value: 1, scriptPubKey: { addresses: [addrA, addrB] } };
    expect(outputAddress(output)).toBeUndefined();
    expect(outputAddress({ ...output, scriptPubKey: { addresses: [addrA] } })).toBe(addrA);
    const w = newWorkspace('Legacy script', 'mainnet');
    w.view.showAddresses = true;
    w.transactions[id(1)] = { ...tx(1, [], []), vout: [output] };
    expect(buildGraph(w).nodes.some((node) => node.kind === 'address')).toBe(false);
    expect(findTool('address-reuse').run(w)).toEqual([]);
  });

  it.each([false, true])(
    'preserves dense test data and the legacy demo flag %s through import',
    (demo) => {
      const fixture = laboratoryWorkspace();
      fixture.demo = demo;
      expect(parseWorkspace(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
    },
  );
});

describe('transaction import boundary', () => {
  const valid = () => tx(1, [{ txid: id(2), vout: 0 }], [{ address: addrA, value: 1 }]);

  it.each([
    [],
    [{}],
    [{ txid: id(2) }],
    [{ vout: 0 }],
    [{ coinbase: '' }],
    [{ txid: id(2), vout: 0, coinbase: '00' }],
    [{ coinbase: '00' }, { txid: id(2), vout: 0 }],
    [
      { txid: id(2), vout: 0 },
      { txid: id(2), vout: 0 },
    ],
  ])('rejects incomplete, mixed, or duplicated inputs: %j', (...vin) => {
    expect(() => parseTransaction({ ...valid(), vin })).toThrow();
  });

  it('rejects duplicate, reordered, missing, and empty output indexes', () => {
    for (const indexes of [[], [0, 0], [1, 0], [0, 2], [1]]) {
      expect(() =>
        parseTransaction({ ...valid(), vout: indexes.map((n) => ({ ...valid().vout[0], n })) }),
      ).toThrow();
    }
    expect(
      parseTransaction({ ...valid(), vout: [0, 1].map((n) => ({ ...valid().vout[0], n })) }).vout,
    ).toHaveLength(2);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 21_000_001, 0.000000001, 0.000000019])(
    'rejects invalid or fractional-satoshi amounts: %s',
    (value) => {
      expect(() =>
        parseTransaction({ ...valid(), vout: [{ ...valid().vout[0], value }] }),
      ).toThrow();
    },
  );

  it('accepts normal floating-point decimal noise and enforces the total money limit', () => {
    for (const value of [0, 0.00000001, 0.1 + 0.2, 21_000_000]) {
      expect(
        parseTransaction({ ...valid(), vout: [{ ...valid().vout[0], value }] }).vout[0].value,
      ).toBe(value);
    }
    expect(() =>
      parseTransaction({
        ...valid(),
        vout: [0, 1].map((n) => ({ n, value: 11_000_000, scriptPubKey: {} })),
      }),
    ).toThrow('output total');
  });

  it.each([
    ['size', Infinity],
    ['size', -1],
    ['size', 1.5],
    ['vsize', 1_000_001],
    ['confirmations', 0.5],
    ['time', -1],
    ['blocktime', Infinity],
  ])('rejects invalid %s metadata', (field, value) => {
    expect(() => parseTransaction({ ...valid(), [field]: value })).toThrow();
  });

  it('bounds outpoints and sequence and checks serialized versus virtual size', () => {
    expect(() =>
      parseTransaction({ ...valid(), vin: [{ txid: id(2), vout: 0x100000000 }] }),
    ).toThrow();
    expect(() =>
      parseTransaction({ ...valid(), vin: [{ txid: id(2), vout: 0, sequence: -1 }] }),
    ).toThrow();
    expect(() => parseTransaction({ ...valid(), size: 100, vsize: 101 })).toThrow('Virtual size');
    expect(
      parseTransaction({ ...valid(), size: 200, vsize: 100, confirmations: -1 }).confirmations,
    ).toBe(-1);
  });
});

describe('wallet and aggregate workspace import bounds', () => {
  // Public BIP84 test vector, also used by the scanner and browser fixtures.
  const wallet: Wallet = {
    id: 'f27b07a5-afbe-4fa9-b390-fe4444d5bec6',
    name: 'Vector wallet',
    key: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
    scriptType: 'p2wpkh',
    color: '#aabbcc',
    addresses: [
      {
        address: addrA,
        scripthash: '6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a',
        path: 'account/0/0',
        branch: 0,
        index: 0,
      },
    ],
  };
  const workspace = () => ({
    ...newWorkspace('Wallet import', 'mainnet'),
    wallets: [structuredClone(wallet)],
  });

  it('accepts consistent public wallet records and rejects duplicate identity or derivation slots', () => {
    expect(parseWorkspace(workspace()).wallets[0]).toEqual(wallet);
    expect(() => parseWorkspace({ ...workspace(), wallets: [wallet, wallet] })).toThrow(
      'duplicate wallet IDs',
    );
    const duplicate = workspace();
    duplicate.wallets[0].addresses.push({ ...wallet.addresses[0] });
    expect(() => parseWorkspace(duplicate)).toThrow('duplicate receive/change');
  });

  it('rejects wrong network keys, conflicting script types, and inconsistent address metadata', () => {
    expect(() => parseWorkspace({ ...workspace(), network: 'testnet4' })).toThrow(
      'belongs to mainnet',
    );
    expect(() =>
      parseWorkspace({ ...workspace(), wallets: [{ ...wallet, scriptType: 'p2pkh' }] }),
    ).toThrow('script type');
    for (const changes of [
      { scripthash: id(99) },
      { path: 'account/1/0' },
      { index: 0x80000000 },
    ]) {
      const w = workspace();
      Object.assign(w.wallets[0].addresses[0], changes);
      expect(() => parseWorkspace(w)).toThrow();
    }
    expect(() =>
      parseWorkspace({ ...workspace(), wallets: [{ ...wallet, scanLimit: Infinity }] }),
    ).toThrow();
  });

  it('rejects an aggregate graph over budget before deeply parsing every transaction', () => {
    const w = newWorkspace('Oversized import', 'mainnet');
    const outputs = Array.from({ length: 9000 }, (_, n) => ({ n, value: 0, scriptPubKey: {} }));
    for (let n = 1; n <= 6; n++)
      w.transactions[id(n)] = { txid: id(n), vin: [{ coinbase: '00' }], vout: outputs };
    try {
      parseWorkspace(w);
      throw new Error('Expected workspace rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceValidationError);
      expect(error).toMatchObject({
        code: 'graph-limit',
        message: expect.stringContaining('50,000'),
      });
    }
  });
});

it('accepts large whole-satoshi amounts without mistaking binary rounding for excess precision', () => {
  for (const value of [1234567.12345678, 10000000.00000001, 0.00000001]) {
    const transaction = tx(500, [], [{ address: addrA, value }]);
    expect(parseTransaction(transaction).vout[0].value).toBe(value);
  }
  expect(() => parseTransaction(tx(501, [], [{ address: addrA, value: 0.000000011 }]))).toThrow(
    'whole-satoshi',
  );
});
