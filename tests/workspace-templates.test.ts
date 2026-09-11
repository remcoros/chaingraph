import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_TEMPLATES, createTemplateWorkspace } from '../src/domain/workspaceTemplates';
import { buildGraph, parseWorkspace } from '../src/domain/workspace';
import { indexPreviousOutputs } from '../src/domain/prevouts';
import { outputNodeId, sats, txNodeId } from '../src/domain/types';
import { projectGraphMembership } from '../src/domain/graphMembership';
import { transactionNodeIds } from '../src/domain/visibility';
import { formatBitcoinAmount } from '../src/domain/amountFormat';

afterEach(() => vi.restoreAllMocks());

describe('real annotated workspace templates', () => {
  it('keeps every bundled snapshot small enough to ship uncompressed', async () => {
    const { stat } = await import('node:fs/promises');
    for (const template of WORKSPACE_TEMPLATES) {
      const { size } = await stat(`src/domain/templateData/${template.id}.json`);
      // Snapshots record the outputs an example displays. Shipping whole parent
      // transactions for their inputs would reintroduce megabytes of unused data.
      expect({ id: template.id, kb: size <= 400_000 }).toEqual({ id: template.id, kb: true });
    }
  });

  it('offers six mainnet examples followed by three testnet4 examples', () => {
    expect(new Set(WORKSPACE_TEMPLATES.map((entry) => entry.id)).size).toBe(
      WORKSPACE_TEMPLATES.length,
    );
    expect(WORKSPACE_TEMPLATES.map((entry) => entry.network)).toEqual([
      ...Array(6).fill('mainnet'),
      ...Array(3).fill('testnet4'),
    ]);
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
      expect(workspace.wallets).toHaveLength(template.id === 'mainnet-public-wallet' ? 1 : 0);
      expect(workspace.findings).toEqual([]);
      expect(Object.keys(workspace.transactions).length).toBeLessThanOrEqual(30);
      expect(
        Object.values(workspace.transactions).every(
          (tx) => tx.vin.length <= (template.id === 'mainnet-wabisabi' ? 350 : 326),
        ),
      ).toBe(true);
      const selected = workspace.transactions[workspace.view.transactionFlow!.transactionId!];
      expect(selected).toBeDefined();
      // Every input resolves to known previous-output content, whether the parent is
      // loaded in full or the output is attached to the spending input.
      const previous = indexPreviousOutputs(workspace);
      for (const input of selected.vin) {
        if (input.txid === undefined) continue;
        const resolution = previous.get(outputNodeId(input.txid, input.vout!));
        expect(resolution?.status === 'loaded' || resolution?.status === 'attached').toBe(true);
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
    'starts $id with connected I/O and its annotated teaching points on the canvas',
    async (template) => {
      const workspace = await createTemplateWorkspace(template.id);
      const graph = projectGraphMembership(buildGraph(workspace), workspace.view.graphNodeIds);
      const nodes = new Set(graph.nodes.map((node) => node.id));
      expect(nodes.size).toBe(workspace.view.graphNodeIds!.length);
      expect(nodes.has(workspace.view.selectionId!)).toBe(true);
      for (const id of Object.keys(workspace.annotations)) expect(nodes.has(id), id).toBe(true);
      const linked = new Set(graph.links.flatMap((link) => [link.source, link.target]));
      for (const id of nodes) expect(linked.has(id), `Disconnected opening node: ${id}`).toBe(true);
      for (const node of graph.nodes.filter((node) => node.kind === 'transaction')) {
        const transaction = workspace.transactions[node.txid!];
        if (workspace.inputContext?.[transaction.txid]) continue;
        for (const side of ['inputs', 'outputs'] as const) {
          const candidates = transactionNodeIds(transaction, side);
          const shown = candidates.filter((id) => nodes.has(id));
          expect(shown.length).toBe(Math.min(candidates.length, 20));
        }
      }
      // Selection and save/load preserve this initial canvas without expanding it.
      const saved = parseWorkspace({
        ...workspace,
        view: { ...workspace.view, selectionId: graph.nodes.at(-1)!.id },
      });
      expect(saved.view.graphNodeIds).toEqual(workspace.view.graphNodeIds);
      expect(workspace.view.prefetchDepth).toBe(0);
    },
  );

  it('keeps large opening graphs bounded while showing script variety and repeated amounts', async () => {
    for (const id of ['mainnet-batch-outputs', 'testnet4-fan-out', 'mainnet-wabisabi']) {
      const workspace = await createTemplateWorkspace(id);
      const root = workspace.transactions[workspace.view.transactionFlow!.transactionId!];
      const visible = new Set(workspace.view.graphNodeIds);
      const outputs = root.vout.filter((output) => visible.has(outputNodeId(root.txid, output.n)));
      expect(visible.size).toBeLessThanOrEqual(41);
      expect(outputs.length).toBeLessThan(root.vout.length);
      expect(new Set(outputs.map((output) => output.scriptPubKey.type))).toEqual(
        new Set(root.vout.map((output) => output.scriptPubKey.type)),
      );
      if (id === 'mainnet-wabisabi')
        for (const tag of workspace.tags!)
          expect(tag.nodeIds.filter((node) => visible.has(node)).length).toBeGreaterThanOrEqual(2);
    }
  });

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
        if (first.wallets.length) {
          expect(first.wallets[0].id).not.toBe(second.wallets[0].id);
          expect(first.wallets[0].addresses).toEqual(second.wallets[0].addresses);
        }
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
        const contextId = Object.keys(first.inputContext ?? {})[0];
        if (contextId) first.inputContext![contextId].length = 0;
        if (first.contextTransactionIds) first.contextTransactionIds.length = 0;
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

  it('shows a verified funding hop and the dominant large output', async () => {
    const workspace = await createTemplateWorkspace('mainnet-large-value-path');
    const seed = 'a6d697a25266ce3c78774fd1d75f896b7af522ada209b0f6228ea497bc49a46d';
    const parent = '17a0d14d4ec50f3384e1c9c6eac7a67345b4c1946a518ab2d943a6d71fe5266e';
    expect(workspace.transactions[seed].vin).toHaveLength(15);
    expect(workspace.transactions[seed].vin[0]).toMatchObject({ txid: parent, vout: 1 });
    expect(workspace.transactions[seed].vout.map((output) => sats(output.value))).toEqual([
      59_849_955_894, 340_000_000_000,
    ]);
    expect(workspace.view.selectionId).toBe(outputNodeId(seed, 1));
    expect(workspace.view.sizeBy).toBe('value');
    expect(buildGraph(workspace).nodes.length).toBeLessThan(50);
  });

  it('keeps the 143-output case complete with truthful amount and script groups', async () => {
    const workspace = await createTemplateWorkspace('mainnet-batch-outputs');
    const root = workspace.transactions[workspace.view.transactionFlow!.transactionId!];
    expect(root.vin).toHaveLength(1);
    expect(root.vout).toHaveLength(143);
    const small = workspace.tags!.find(
      (tag) => tag.name === `Below ${formatBitcoinAmount(10_000)}`,
    );
    expect(small?.nodeIds).toEqual(
      root.vout
        .filter((output) => sats(output.value) < 10_000)
        .map((output) => outputNodeId(root.txid, output.n)),
    );
    expect(new Set(root.vout.map((output) => output.scriptPubKey.type)).size).toBe(4);
    expect(buildGraph(workspace).nodes.length).toBeLessThan(150);
  });

  it('opens the large CoinJoin with complete inputs and amount groups without ownership findings', async () => {
    const workspace = await createTemplateWorkspace('mainnet-wabisabi');
    const root = workspace.transactions[workspace.view.transactionFlow!.transactionId!];
    expect(root.vin).toHaveLength(327);
    expect(root.vout).toHaveLength(279);
    // The snapshot carries the CoinJoin alone; each spend records the exact output it
    // consumed instead of the whole parent transaction.
    expect(Object.keys(workspace.transactions)).toHaveLength(1);
    expect(workspace.contextTransactionIds ?? []).toEqual([]);
    const previous = indexPreviousOutputs(workspace);
    for (const input of root.vin) {
      expect(input.prevout?.scriptPubKey.hex).toMatch(/^(?:[0-9a-f]{2})+$/);
      expect(previous.get(outputNodeId(input.txid!, input.vout!))?.status).toBe('attached');
    }
    const group = workspace.tags!.find(
      (tag) => tag.name === `${formatBitcoinAmount(2_097_152)} × 20`,
    );
    expect(group?.nodeIds).toEqual(
      root.vout
        .filter((output) => sats(output.value) === 2_097_152)
        .map((output) => outputNodeId(root.txid, output.n)),
    );
    expect(workspace.findings).toEqual([]);
    expect(buildGraph(workspace).nodes.length).toBe(607);
  });

  it('includes a derived public watch-only wallet with honest partial scan state', async () => {
    const workspace = await createTemplateWorkspace('mainnet-public-wallet');
    const [wallet] = workspace.wallets;
    expect(wallet.key.startsWith('zpub')).toBe(true);
    expect(wallet.scriptType).toBe('p2wpkh');
    expect(wallet.scanComplete).toBe(false);
    expect(wallet.addresses).toHaveLength(20);
    expect(wallet.pendingTransactionIds!.length).toBeGreaterThan(0);
    const addresses = new Set(wallet.addresses.map((address) => address.address));
    const walletOutputs = Object.values(workspace.transactions).flatMap((transaction) =>
      transaction.vout.filter(
        (output) => output.scriptPubKey.address && addresses.has(output.scriptPubKey.address),
      ),
    );
    expect(walletOutputs.length).toBeGreaterThanOrEqual(2);
    expect(workspace.view.leftTab).toBe('wallets');
    expect(workspace.view.highlightMode).toBe('wallets');
    expect(workspace.description).toContain('never send funds');
    expect(() =>
      parseWorkspace({
        ...workspace,
        wallets: [
          {
            ...wallet,
            addresses: [{ ...wallet.addresses[0], index: wallet.addresses[0].index + 100 }],
          },
        ],
      }),
    ).toThrow();
  });

  it('follows the mixed testnet4 output into its single-output successor', async () => {
    const workspace = await createTemplateWorkspace('testnet4-mixed-path');
    const seed = 'b92eb2d8abf81a25197bacde9845eea3d711bd6edf25e1e8975d731271dd83eb';
    const successor = 'e0d797ca417b3c39e64677da7be5591f7c5e5d945743e9046efdbb10fd8ba76f';
    expect(workspace.transactions[successor].vin[0]).toMatchObject({ txid: seed, vout: 0 });
    expect(workspace.transactions[seed].vout.map((output) => sats(output.value))).toEqual([
      1_018_062, 0, 4_998_981_938,
    ]);
    expect(sats(workspace.transactions[successor].vout[0].value)).toBe(1_000_000);
    expect(buildGraph(workspace).links).toContainEqual(
      expect.objectContaining({
        source: outputNodeId(seed, 0),
        target: txNodeId(successor),
        kind: 'spends',
      }),
    );
  });

  it('rejects unknown templates and invalid workspace names', async () => {
    await expect(createTemplateWorkspace('unknown')).rejects.toThrow('Unknown workspace template');
    await expect(createTemplateWorkspace('mainnet-op-return', '')).rejects.toThrow();
  });
});
