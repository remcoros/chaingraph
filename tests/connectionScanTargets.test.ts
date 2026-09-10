import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_SETTINGS, runConnectionScan } from '../src/domain/connectionScan';
import { prepareCustomScanTargets } from '../src/domain/connectionScanTargets';
import type { Transaction } from '../src/domain/types';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${id(n)}`;
const out = (n: number, index = 0) => `out:${id(n)}:${index}`;
const transaction = (n: number, parent?: number, count = 2): Transaction => ({
  txid: id(n),
  vin: parent === undefined ? [{ coinbase: '00' }] : [{ txid: id(parent), vout: 7 }],
  vout: Array.from({ length: count }, (_, n) => ({
    n,
    value: 1,
    scriptPubKey: { hex: '51' },
  })),
});

describe('custom scan targets', () => {
  it('includes only picked transactions and their exact immediate I/O, deduplicated without the source', () => {
    const transactions = {
      [id(1)]: transaction(1, 9),
      [id(2)]: transaction(2, 1),
      [id(3)]: transaction(3, 2),
    };
    const targets = prepareCustomScanTargets({
      pickedNodeIds: [tx(2), out(2), tx(2), out(1, 7), out(3, 1)],
      transactions,
      source: out(2),
    });
    expect(targets).toEqual([tx(2), out(1, 7), out(2, 1), out(3, 1)].sort());
    expect(targets).not.toContain(tx(1));
    expect(targets).not.toContain(out(9, 7));
    expect(targets).not.toContain(tx(3));
    expect(transactions[id(2)].vout).toHaveLength(2);
  });

  it('picks an exact outpoint without requiring or expanding its creator', () => {
    expect(
      prepareCustomScanTargets({
        pickedNodeIds: [out(2, 150), out(2, 150)],
        transactions: {},
        source: tx(1),
      }),
    ).toEqual([out(2, 150)]);
  });

  it('does not create a prevout target for coinbase inputs', () => {
    expect(
      prepareCustomScanTargets({
        pickedNodeIds: [tx(2)],
        transactions: { [id(2)]: transaction(2) },
        source: tx(1),
      }),
    ).toEqual([tx(2), out(2), out(2, 1)].sort());
  });

  it('refuses a partial target set when a picked transaction is not loaded', () => {
    expect(() =>
      prepareCustomScanTargets({
        pickedNodeIds: [out(3), tx(2)],
        transactions: {},
        source: tx(1),
      }),
    ).toThrow('Load the picked transaction');
  });

  it('accepts exactly 1,000 expanded targets after source exclusion and rejects overflow', () => {
    const picked = transaction(2, undefined, 1000);
    expect(
      prepareCustomScanTargets({
        pickedNodeIds: [tx(2), out(2), tx(2)],
        transactions: { [id(2)]: picked },
        source: out(2),
      }),
    ).toHaveLength(1000);
    expect(() =>
      prepareCustomScanTargets({
        pickedNodeIds: [tx(2)],
        transactions: { [id(2)]: picked },
        source: tx(1),
      }),
    ).toThrow('exceed 1,000 targets');
  });

  it('rejects malformed picks, mismatched transaction identity and incomplete prevouts', () => {
    for (const picked of ['addr:unknown', out(2, -1), out(2, 0x100000000)]) {
      expect(() =>
        prepareCustomScanTargets({ pickedNodeIds: [picked], transactions: {}, source: tx(1) }),
      ).toThrow('valid transactions or outputs');
    }
    expect(() =>
      prepareCustomScanTargets({
        pickedNodeIds: [tx(2)],
        transactions: { [id(2)]: transaction(3) },
        source: tx(1),
      }),
    ).toThrow('does not match its ID');
    expect(() =>
      prepareCustomScanTargets({
        pickedNodeIds: [tx(2)],
        transactions: { [id(2)]: { ...transaction(2), vin: [{ txid: id(1) }] } },
        source: tx(1),
      }),
    ).toThrow('input references are incomplete');
  });

  it('finds a hidden picked transaction input as a target without its creator being picked', async () => {
    const targetIds = prepareCustomScanTargets({
      pickedNodeIds: [tx(3)],
      transactions: { [id(3)]: transaction(3, 2) },
      source: tx(1),
    });
    const edges = [
      [tx(1), out(1)],
      [out(1), tx(2)],
      [tx(2), out(2, 7)],
      [out(2, 7), tx(3)],
    ];
    const run = await runConnectionScan({
      id: 'custom-targets',
      source: tx(1),
      targetIds,
      displayedNodeIds: [tx(1), tx(3)],
      settings: { ...DEFAULT_SCAN_SETTINGS, targetScope: 'custom', direction: 'downstream' },
      resolveNeighbors: async (id, direction) => ({
        nodeIds: edges
          .filter((edge) => edge[direction === 'downstream' ? 0 : 1] === id)
          .map((edge) => edge[direction === 'downstream' ? 1 : 0]),
      }),
    });
    expect(run.settings.targetScope).toBe('custom');
    expect(run.results).toContainEqual(
      expect.objectContaining({
        kind: 'connection',
        endpoint: out(2, 7),
        path: [tx(1), out(1), tx(2), out(2, 7)],
      }),
    );
    expect(run.targetIds).not.toContain(tx(2));
  });
});
