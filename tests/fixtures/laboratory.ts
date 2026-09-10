import { buildGraph, newWorkspace } from '../../src/domain/workspace';
import type { Transaction, Workspace } from '../../src/domain/types';
// Deliberately synthetic, deterministic fixture; never presented as chain data.
export function laboratoryWorkspace(): Workspace {
  const w = newWorkspace('Synthetic graph fixture', 'testnet4');
  w.demo = false;
  const id = (n: number) => n.toString(16).padStart(64, '0');
  for (let group = 0; group < 3; group++) {
    const joinid = id(1000 + group);
    const vin: Transaction['vin'] = [];
    for (let i = 0; i < 150; i++) {
      const parentid = id(2000 + group * 150 + i);
      vin.push({ txid: parentid, vout: 0 });
      w.transactions[parentid] = {
        txid: parentid,
        vin: [{ coinbase: 'synthetic' }],
        vout: [
          {
            n: 0,
            value: 0.01001,
            scriptPubKey: { type: 'witness_v0_keyhash' },
          },
        ],
        confirmations: 12,
      };
    }
    w.transactions[joinid] = {
      txid: joinid,
      vin,
      vout: Array.from({ length: 150 }, (_, n) => ({
        n,
        value: 0.01,
        scriptPubKey: { type: 'witness_v0_keyhash' },
      })),
      confirmations: 6,
      vsize: 21000,
    };
    w.annotations[`tx:${joinid}`] = {
      label: `Synthetic CoinJoin ${group + 1}`,
      note: 'Generated fixture: 150 inputs and 150 equal outputs. Not an on-chain transaction.',
      icon: '◇',
      bookmarked: true,
    };
    for (let i = 0; i < 30; i++) {
      const child = id(4000 + group * 30 + i);
      w.transactions[child] = {
        txid: child,
        vin: [{ txid: joinid, vout: i }],
        vout: [
          { n: 0, value: 0.006, scriptPubKey: {} },
          { n: 1, value: 0.00399, scriptPubKey: {} },
        ],
        confirmations: 2,
      };
    }
  }
  // This fixture intentionally exercises a fully populated canvas.
  w.view.graphNodeIds = buildGraph(w).nodes.map((node) => node.id);
  return w;
}
