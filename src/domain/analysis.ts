import {
  outputNodeId,
  sats,
  type Workspace,
  type Transaction,
  type AnalysisFinding,
} from './types';
import { outputAddress } from './workspace';
export interface AnalysisTool {
  id: string;
  name: string;
  description: string;
  run: (workspace: Workspace, txids?: string[]) => AnalysisFinding[];
}
export function equalOutputCount(tx: Transaction): number {
  const counts = new Map<number, number>();
  for (const out of tx.vout)
    if (sats(out.value) > 0) counts.set(sats(out.value), (counts.get(sats(out.value)) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}
export const analysisTools: AnalysisTool[] = [
  {
    id: 'equal-outputs',
    name: 'Equal-output detection',
    description:
      'Highlight repeated output amounts. A pattern to investigate, not proof of a CoinJoin.',
    run: (w, ids) =>
      Object.values(w.transactions)
        .filter(
          (t) => (!ids || ids.includes(t.txid)) && t.vin.length >= 2 && equalOutputCount(t) >= 3,
        )
        .map((t) => ({
          id: `equal:${t.txid}`,
          algorithm: 'equal-outputs-v1',
          title: `${equalOutputCount(t)} equal outputs`,
          description:
            'Repeated positive output values can occur in collaborative transactions, batching, and other activity. This does not identify ownership or prove CoinJoin.',
          nodeIds: t.vout.map((o) => outputNodeId(t.txid, o.n)),
          txids: [t.txid],
          createdAt: new Date().toISOString(),
        })),
  },
  {
    id: 'cioh',
    name: 'Common-input ownership',
    description:
      'Group input outputs tentatively; skip transactions with three or more equal outputs. PayJoin and undetected collaboration remain exceptions.',
    run: (w, ids) => {
      const groups = new Map<string, Set<string>>();
      const evidence = new Map<string, Set<string>>();
      const parents = new Map<string, string>();
      function root(a: string): string {
        let x = a;
        while (parents.has(x) && parents.get(x) !== x) x = parents.get(x)!;
        let y = a;
        while (parents.has(y) && parents.get(y) !== x) {
          const next = parents.get(y)!;
          parents.set(y, x);
          y = next;
        }
        return x;
      }
      for (const tx of Object.values(w.transactions)) {
        if ((ids && !ids.includes(tx.txid)) || tx.vin.length < 2 || equalOutputCount(tx) >= 3)
          continue;
        const members = tx.vin
          .filter((i) => i.txid && i.vout !== undefined)
          .map((i) => ({
            id: outputNodeId(i.txid!, i.vout!),
            address: outputAddress(
              w.transactions[i.txid!]?.vout.find((o) => o.n === i.vout) ?? {
                n: 0,
                value: 0,
                scriptPubKey: {},
              },
            ),
          }));
        if (members.length < 2) continue;
        const first = members[0].address ? `addr:${members[0].address}` : members[0].id;
        for (const m of members) {
          const key = m.address ? `addr:${m.address}` : m.id;
          parents.set(root(key), root(first));
          const set = groups.get(key) ?? new Set();
          set.add(m.id);
          groups.set(key, set);
          const ev = evidence.get(key) ?? new Set();
          ev.add(tx.txid);
          evidence.set(key, ev);
        }
      }
      const merged = new Map<string, { nodes: Set<string>; txids: Set<string> }>();
      for (const [key, members] of groups) {
        const id = root(key),
          m = merged.get(id) ?? { nodes: new Set(), txids: new Set() };
        for (const n of members) m.nodes.add(n);
        for (const t of evidence.get(key) ?? []) m.txids.add(t);
        merged.set(id, m);
      }
      return [...merged.values()].map((g, i) => ({
        id: `cioh:${[...g.nodes].sort()[0]}`,
        algorithm: 'cioh-v1',
        title: `Input cluster ${i + 1}`,
        description:
          'Tentative common-input ownership hypothesis. Equal-output candidates (3+) were skipped. PayJoin, other collaborative spends, and incomplete history can invalidate this grouping. This is not evidence of a person’s identity.',
        nodeIds: [...g.nodes],
        txids: [...g.txids],
        createdAt: new Date().toISOString(),
      }));
    },
  },
  {
    id: 'address-reuse',
    name: 'Address reuse',
    description: 'Find addresses appearing on multiple loaded outputs.',
    run: (w) => {
      const byAddress = new Map<string, { nodes: string[]; txids: Set<string> }>();
      for (const t of Object.values(w.transactions))
        for (const o of t.vout) {
          const address = outputAddress(o);
          if (!address) continue;
          const g = byAddress.get(address) ?? { nodes: [], txids: new Set() };
          g.nodes.push(outputNodeId(t.txid, o.n));
          g.txids.add(t.txid);
          byAddress.set(address, g);
        }
      return [...byAddress]
        .filter(([, g]) => g.nodes.length > 1)
        .map(([a, g]) => ({
          id: `reuse:${a}`,
          algorithm: 'address-reuse-v1',
          title: `Address reused across ${g.nodes.length} outputs`,
          description: `${a} appears on multiple outputs in this workspace. Only loaded history is considered.`,
          nodeIds: g.nodes,
          txids: [...g.txids],
          createdAt: new Date().toISOString(),
        }));
    },
  },
];
