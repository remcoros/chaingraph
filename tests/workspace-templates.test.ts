import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_TEMPLATES, createTemplateWorkspace } from '../src/domain/workspaceTemplates';
import { buildGraph, parseWorkspace } from '../src/domain/workspace';
import { outputNodeId, sats, txNodeId } from '../src/domain/types';

afterEach(() => vi.restoreAllMocks());

describe('real annotated workspace templates', () => {
  it('offers at least two independent examples for each supported network', () => {
    expect(new Set(WORKSPACE_TEMPLATES.map((entry) => entry.id)).size).toBe(
      WORKSPACE_TEMPLATES.length,
    );
    for (const network of ['mainnet', 'testnet4']) {
      expect(
        WORKSPACE_TEMPLATES.filter((entry) => entry.network === network).length,
      ).toBeGreaterThanOrEqual(2);
    }
    for (const entry of WORKSPACE_TEMPLATES) {
      expect(entry.sources.length).toBeGreaterThan(0);
      expect(entry.sources.every((source) => new URL(source.url).protocol === 'https:')).toBe(true);
    }
  });

  it.each(WORKSPACE_TEMPLATES)(
    'opens $id offline with complete initial inputs and editable metadata',
    async (template) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
      const workspace = await createTemplateWorkspace(template.id);
      expect(fetch).not.toHaveBeenCalled();
      expect(parseWorkspace(workspace)).toEqual(workspace);
      expect(workspace.network).toBe(template.network);
      expect(workspace.demo).toBe(false);
      expect(workspace.wallets).toEqual([]);
      expect(workspace.findings).toEqual([]);
      expect(Object.keys(workspace.transactions).length).toBeLessThanOrEqual(20);
      expect(Object.values(workspace.transactions).every((tx) => tx.vin.length < 327)).toBe(true);
      const selected = workspace.transactions[workspace.view.transactionFlow!.transactionId!];
      expect(selected).toBeDefined();
      for (const input of selected.vin) {
        if (input.txid === undefined) continue;
        expect(workspace.transactions[input.txid]?.vout[input.vout!]?.n).toBe(input.vout);
      }
      // Every cached spend references a real output of its cached parent.
      for (const tx of Object.values(workspace.transactions)) {
        for (const input of tx.vin) {
          if (input.txid === undefined || !workspace.transactions[input.txid]) continue;
          expect(workspace.transactions[input.txid].vout[input.vout!]?.n).toBe(input.vout);
        }
      }
      const graph = buildGraph(workspace);
      const nodes = new Set(graph.nodes.map((node) => node.id));
      expect(nodes.has(workspace.view.selectionId!)).toBe(true);
      expect(Object.values(workspace.annotations).some((annotation) => annotation.bookmarked)).toBe(
        true,
      );
      for (const [id, annotation] of Object.entries(workspace.annotations)) {
        expect(nodes.has(id)).toBe(true);
        expect(annotation.label.length).toBeGreaterThan(0);
        expect(annotation.note.length).toBeGreaterThan(0);
        expect(annotation.icon.length).toBeGreaterThan(0);
      }
      expect(workspace.tags!.length).toBeGreaterThan(0);
      for (const tag of workspace.tags!) {
        expect(tag.nodeIds.length).toBeGreaterThan(0);
        expect(tag.nodeIds.every((id) => nodes.has(id))).toBe(true);
      }
      expect(() =>
        parseWorkspace({
          ...workspace,
          network: workspace.network === 'mainnet' ? 'testnet4' : 'mainnet',
        }),
      ).toThrow();
    },
  );

  it.each(WORKSPACE_TEMPLATES)(
    'creates isolated copies of $id with fresh workspace and tag identities',
    async (template) => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-08T18:00:00Z'));
        const first = await createTemplateWorkspace(template.id);
        vi.setSystemTime(new Date('2026-09-08T18:01:00Z'));
        const second = await createTemplateWorkspace(template.id, 'My investigation', 'My notes');
        expect(first.id).not.toBe(second.id);
        expect(first.createdAt).not.toBe(second.createdAt);
        expect(second.name).toBe('My investigation');
        expect(second.description).toBe('My notes');
        const firstIds = new Set(first.tags!.map((tag) => tag.id));
        expect(second.tags!.every((tag) => !firstIds.has(tag.id))).toBe(true);
        const expected = structuredClone(second);
        const root = first.view.transactionFlow!.transactionId!;
        first.transactions[root].vout[0].value = 1;
        first.transactions[root].vout[0].scriptPubKey.hex = '6a';
        first.annotations[Object.keys(first.annotations)[0]].note = 'Edited';
        first.tags![0].nodeIds.length = 0;
        first.inputContext![Object.keys(first.inputContext!)[0]].length = 0;
        first.contextTransactionIds!.length = 0;
        first.view.transactionFlow!.open = false;
        expect(second).toEqual(expected);
        const third = await createTemplateWorkspace(template.id);
        expect(third.transactions).toEqual(second.transactions);
        expect(third.annotations).toEqual(second.annotations);
        expect(third.inputContext).toEqual(second.inputContext);
        expect(third.contextTransactionIds).toEqual(second.contextTransactionIds);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('preserves the equal-output case and exact successor outpoint without ownership findings', async () => {
    const workspace = await createTemplateWorkspace('mainnet-equal-outputs');
    const seed = '323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2';
    const successor = '015d9cf0a12057d009395710611c65109f36b3eaefa3a694594bf243c097f404';
    expect(workspace.transactions[seed].vin).toHaveLength(5);
    expect(workspace.transactions[seed].vout.map((output) => sats(output.value))).toEqual([
      5_000_000, 5_000_000, 5_000_000, 5_000_000, 5_000_000,
    ]);
    expect(workspace.transactions[successor].vin[1]).toMatchObject({ txid: seed, vout: 2 });
    expect(workspace.transactions[successor].vin).toHaveLength(9);
    expect(workspace.transactions[successor].vout.map((output) => sats(output.value))).toEqual([
      791_116, 907_419, 9_136_520, 9_136_520,
    ]);
    const graph = buildGraph(workspace);
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        source: outputNodeId(seed, 2),
        target: txNodeId(successor),
        kind: 'spends',
      }),
    );
    // One full parent has 247 outputs; the initial graph keeps only referenced context.
    expect(graph.nodes.length).toBeLessThan(60);
    for (const input of workspace.transactions[successor].vin) {
      expect(workspace.transactions[input.txid!].vout[input.vout!]).toBeDefined();
    }
  });

  it('preserves the mainnet message script and its zero value', async () => {
    const workspace = await createTemplateWorkspace('mainnet-op-return');
    const transaction =
      workspace.transactions['8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684'];
    expect(transaction.vout[0]).toMatchObject({
      n: 0,
      value: 0,
      scriptPubKey: { type: 'nulldata', hex: '6a13636861726c6579206c6f766573206865696469' },
    });
    expect(sats(transaction.vout[1].value)).toBe(200_000);
  });

  it('preserves the exact testnet4 funding and spending path', async () => {
    const workspace = await createTemplateWorkspace('testnet4-spent-output');
    const seed = 'd4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a';
    const spender = '8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044';
    expect(workspace.transactions[seed].vin[0]).toMatchObject({
      txid: '0ffaf73db54ae2666a19324415fb158993b7b30478237ec56d655cfbed2bf606',
      vout: 0,
    });
    expect(workspace.transactions[spender].vin[0]).toMatchObject({ txid: seed, vout: 1 });
    expect(sats(workspace.transactions[seed].vout[1].value)).toBe(447_915_285);
    expect(buildGraph(workspace).links).toContainEqual(
      expect.objectContaining({
        source: outputNodeId(seed, 1),
        target: txNodeId(spender),
        kind: 'spends',
      }),
    );
  });

  it('preserves all 53 fan-out outputs and distinguishes observed script forms', async () => {
    const workspace = await createTemplateWorkspace('testnet4-fan-out');
    const tx =
      workspace.transactions['cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5'];
    expect(tx.vin).toHaveLength(1);
    expect(tx.vout).toHaveLength(53);
    expect(
      tx.vout.slice(0, 51).every((output) => output.scriptPubKey.type === 'witness_v0_scripthash'),
    ).toBe(true);
    expect(tx.vout[51].scriptPubKey.type).toBe('witness_v0_keyhash');
    expect(tx.vout[52]).toMatchObject({ value: 0, scriptPubKey: { type: 'nulldata' } });
  });

  it('rejects unknown templates and invalid workspace names', async () => {
    await expect(createTemplateWorkspace('unknown')).rejects.toThrow('Unknown workspace template');
    await expect(createTemplateWorkspace('mainnet-op-return', '')).rejects.toThrow();
  });
});
