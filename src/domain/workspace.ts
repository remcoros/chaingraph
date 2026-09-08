import { z } from 'zod';
import { graphSnapshotSchema } from './graphSnapshot';
import type { Workspace, Transaction, GraphData, GraphNode } from './types';
import { txNodeId, outputNodeId, addressNodeId, short, sats } from './types';
import { assertTagBudget, parseWorkspaceTags, workspaceTagsSchema } from './tags';
import {
  addressToScriptHash,
  inspectExtendedPublicKey,
  verifyWalletAddresses,
} from '../lib/wallet';
const MAX_MONEY = 21_000_000;
const MAX_MONEY_SATS = MAX_MONEY * 100_000_000;
export const MAX_GRAPH_RECORDS = 50_000;
const txid = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().max(10000);
const uint32 = z.number().int().min(0).max(0xffffffff);
const derivationIndex = z.number().int().min(0).max(0x7fffffff);
const height = z.number().int().min(-1).max(0x7fffffff);
const timestamp = z.iso.datetime({ offset: true });
const inputSchema = z
  .object({
    txid: txid.optional(),
    vout: uint32.optional(),
    coinbase: text.min(1).optional(),
    sequence: uint32.optional(),
  })
  .refine(
    (input) =>
      input.coinbase !== undefined
        ? input.txid === undefined && input.vout === undefined
        : input.txid !== undefined && input.vout !== undefined,
    'An input must contain either coinbase data or a complete transaction outpoint.',
  );
const outputSchema = z.object({
  n: uint32,
  value: z
    .number()
    .min(0)
    .max(MAX_MONEY)
    .refine(
      // Check decimal precision before multiplying: large valid BTC values can
      // acquire a fractional binary rounding residue when scaled to satoshis.
      (value) =>
        Math.abs(value - Number(value.toFixed(8))) <= Number.EPSILON * Math.max(1, Math.abs(value)),
      'Output values must have whole-satoshi precision.',
    ),
  scriptPubKey: z.object({
    hex: z
      .string()
      .max(20000)
      .regex(/^(?:[0-9a-fA-F]{2})*$/)
      .optional(),
    address: z.string().min(1).max(150).optional(),
    addresses: z.array(z.string().min(1).max(150)).max(20).optional(),
    type: text.optional(),
  }),
});
const transactionSchema = z
  .object({
    txid,
    vin: z.array(inputSchema).min(1).max(10000),
    vout: z.array(outputSchema).min(1).max(10000),
    confirmations: z.number().int().min(-0x7fffffff).max(0x7fffffff).optional(),
    blocktime: uint32.optional(),
    time: uint32.optional(),
    size: z.number().int().min(1).max(4_000_000).optional(),
    vsize: z.number().int().min(1).max(1_000_000).optional(),
    blockhash: txid.optional(),
  })
  .superRefine((transaction, context) => {
    if (
      transaction.vin.some((input) => input.coinbase !== undefined) &&
      transaction.vin.length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vin'],
        message: 'Coinbase must be the transaction’s only input.',
      });
    }
    const inputs = new Set<string>();
    for (const [index, input] of transaction.vin.entries()) {
      if (input.txid === undefined) continue;
      const key = `${input.txid}:${input.vout}`;
      if (inputs.has(key))
        context.addIssue({
          code: 'custom',
          path: ['vin', index],
          message: 'Duplicate input outpoint.',
        });
      inputs.add(key);
    }
    let total = 0;
    for (const [index, output] of transaction.vout.entries()) {
      if (output.n !== index)
        context.addIssue({
          code: 'custom',
          path: ['vout', index, 'n'],
          message: 'Output indexes must be unique and sequential from zero.',
        });
      total += sats(output.value);
    }
    if (total > MAX_MONEY_SATS)
      context.addIssue({
        code: 'custom',
        path: ['vout'],
        message: 'Transaction output total exceeds the Bitcoin money limit.',
      });
    if (
      transaction.size !== undefined &&
      transaction.vsize !== undefined &&
      transaction.vsize > transaction.size
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vsize'],
        message: 'Virtual size cannot exceed serialized size.',
      });
    }
  });
const walletSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  key: z.string().max(150),
  scriptType: z.enum(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr']),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  addresses: z
    .array(
      z.object({
        address: z.string().min(1).max(150),
        scripthash: txid,
        path: z.string().max(100),
        index: derivationIndex,
        branch: z.union([z.literal(0), z.literal(1)]),
        history: z
          .array(z.object({ tx_hash: txid, height }))
          .max(10000)
          .optional(),
      }),
    )
    .max(10000),
  scannedAt: timestamp.optional(),
  scanComplete: z.boolean().optional(),
  scanLimit: z.number().int().min(1).max(0x80000000).optional(),
  scanGap: z.number().int().min(1).max(100).optional(),
  pendingTransactionIds: z.array(txid).max(10000).optional(),
  unreviewedTransactionIds: z.array(txid).max(10000).optional(),
  activityOverflow: z.boolean().optional(),
  lastActivity: z
    .object({
      newTransactionIds: z.array(txid).max(500),
      refreshedTransactionCount: z.number().int().min(0).max(500),
      missingTransactionCount: z.number().int().min(0).max(100_000_000),
    })
    .optional(),
});
const workspaceSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: text.optional(),
  network: z.enum(['mainnet', 'testnet4']),
  createdAt: timestamp,
  demo: z.boolean(),
  wallets: z.array(walletSchema).max(100),
  transactions: z.record(txid, transactionSchema),
  annotations: z.record(
    z.string().max(200),
    z.object({
      label: z.string().max(200),
      note: text,
      icon: z.string().max(20),
      bookmarked: z.boolean(),
    }),
  ),
  tags: workspaceTagsSchema.optional(),
  findings: z
    .array(
      z.object({
        id: z.string().max(100),
        algorithm: z.string().max(100),
        title: z.string().max(200),
        description: text,
        nodeIds: z.array(z.string().max(200)).max(30000),
        txids: z.array(txid).max(10000),
        createdAt: timestamp,
        excluded: z.boolean().optional(),
        kind: z.enum(['observation', 'hypothesis', 'incomplete']).optional(),
        scopeTxids: z.array(txid).max(10000).optional(),
        stale: z.boolean().optional(),
      }),
    )
    .max(10000),
  watchedAddresses: z.array(z.string().max(150)).max(10000),
  view: z.object({
    dimensions: z.union([z.literal(2), z.literal(3)]),
    sizeBy: z.enum(['uniform', 'value', 'degree']),
    glow: z.boolean(),
    showAddresses: z.boolean(),
    highlightMode: z.enum(['all', 'wallets', 'tags', 'none']).optional(),
    graphSnapshot: graphSnapshotSchema.optional(),
    selectionId: z.string().max(300).optional(),
    filters: z
      .object({
        tagId: z.string().max(200).optional(),
        walletId: z.string().max(200).optional(),
        query: z.string().max(10000).optional(),
        kind: z.enum(['all', 'transaction', 'output', 'address']).optional(),
        label: z.enum(['all', 'labeled', 'unlabeled']).optional(),
        bookmarkedOnly: z.boolean().optional(),
        minSats: z.number().int().min(0).max(MAX_MONEY_SATS).optional(),
        maxSats: z.number().int().min(0).max(MAX_MONEY_SATS).optional(),
        spend: z.enum(['all', 'observed', 'unknown']).optional(),
        funding: z.enum(['all', 'missing', 'loaded']).optional(),
        showAddresses: z.boolean().optional(),
        focus: z
          .object({ id: z.string().max(300), hops: z.union([z.literal(1), z.literal(2)]) })
          .optional(),
        preserveContext: z.boolean().optional(),
        includeIds: z.array(z.string().max(300)).max(MAX_GRAPH_RECORDS).optional(),
      })
      .optional(),
    leftTab: z.enum(['wallets', 'entities', 'bookmarks', 'tags']).optional(),
    rightTab: z.enum(['inspect', 'analysis']).optional(),
    focusGraph: z.boolean().optional(),
    prefetchDepth: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    selectedWallet: z.string().max(200).optional(),
    mobilePanel: z.enum(['graph', 'left', 'right']).optional(),
    transactionFlow: z
      .object({
        transactionId: txid.optional(),
        expandedInputs: z.boolean().optional(),
        expandedOutputs: z.boolean().optional(),
        open: z.boolean().optional(),
      })
      .optional(),
  }),
});

export class WorkspaceValidationError extends Error {
  constructor(
    readonly code:
      | 'graph-limit'
      | 'wallet-address-limit'
      | 'transaction-limit'
      | 'wallet-identity'
      | 'wallet-address',
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceValidationError';
  }
}

// Count cheap structural records before parsing/allocating every imported node.
export function assertWorkspaceBudget(data: unknown) {
  if (!data || typeof data !== 'object') return;
  const raw = data as { transactions?: unknown; wallets?: unknown; tags?: unknown };
  assertTagBudget(raw.tags);
  if (
    raw.transactions &&
    typeof raw.transactions === 'object' &&
    !Array.isArray(raw.transactions)
  ) {
    const transactions = Object.values(raw.transactions);
    if (transactions.length > 10000)
      throw new WorkspaceValidationError(
        'transaction-limit',
        'Workspace exceeds the 10,000 transaction limit.',
      );
    let records = transactions.length;
    for (const item of transactions) {
      if (!item || typeof item !== 'object') continue;
      const tx = item as { vin?: unknown; vout?: unknown };
      records +=
        (Array.isArray(tx.vin) ? tx.vin.length : 0) + (Array.isArray(tx.vout) ? tx.vout.length : 0);
      if (records > MAX_GRAPH_RECORDS)
        throw new WorkspaceValidationError(
          'graph-limit',
          'Workspace exceeds the 50,000 transaction/input/output record limit. Split this investigation into separate workspaces.',
        );
    }
  }
  if (Array.isArray(raw.wallets)) {
    if (raw.wallets.length > 100)
      throw new WorkspaceValidationError(
        'wallet-identity',
        'Workspace supports at most 100 wallets.',
      );
    let addresses = 0;
    for (const wallet of raw.wallets) {
      if (wallet && typeof wallet === 'object' && Array.isArray(wallet.addresses))
        addresses += wallet.addresses.length;
      if (addresses > MAX_GRAPH_RECORDS)
        throw new WorkspaceValidationError(
          'wallet-address-limit',
          'Workspace exceeds the 50,000 wallet address limit.',
        );
    }
  }
}

export function parseTransaction(data: unknown): Transaction {
  return transactionSchema.parse(data);
}
export function parseWorkspace(data: unknown, verifyDerivation = true): Workspace {
  assertWorkspaceBudget(data);
  const parsed = workspaceSchema.parse(data);
  if (parsed.tags !== undefined) parsed.tags = parseWorkspaceTags(parsed.tags, parsed.network);
  if (Object.entries(parsed.transactions).some(([id, transaction]) => id !== transaction.txid))
    throw new Error('Workspace has invalid transaction records.');
  const walletIds = new Set<string>();
  for (const wallet of parsed.wallets) {
    if (walletIds.has(wallet.id))
      throw new WorkspaceValidationError(
        'wallet-identity',
        'Workspace contains duplicate wallet IDs.',
      );
    walletIds.add(wallet.id);
    const key = inspectExtendedPublicKey(wallet.key, parsed.network);
    if (key.suggestedScriptType && key.suggestedScriptType !== wallet.scriptType)
      throw new WorkspaceValidationError(
        'wallet-identity',
        'Wallet script type does not match its public key encoding.',
      );
    const slots = new Set<string>();
    for (const address of wallet.addresses) {
      const slot = `${address.branch}/${address.index}`;
      if (slots.has(slot))
        throw new WorkspaceValidationError(
          'wallet-address',
          'Wallet contains duplicate receive/change derivation indexes.',
        );
      slots.add(slot);
      if (address.path !== `account/${slot}`)
        throw new WorkspaceValidationError(
          'wallet-address',
          'Wallet address path does not match its branch and index.',
        );
      if (addressToScriptHash(address.address, parsed.network) !== address.scripthash)
        throw new WorkspaceValidationError(
          'wallet-address',
          'Wallet address does not match its script hash.',
        );
    }
    if (verifyDerivation)
      verifyWalletAddresses(wallet.key, parsed.network, wallet.scriptType, wallet.addresses);
  }
  for (const address of parsed.watchedAddresses) addressToScriptHash(address, parsed.network);
  return parsed;
}
export function newWorkspace(name: string, network: Workspace['network']): Workspace {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    network,
    createdAt: new Date().toISOString(),
    wallets: [],
    transactions: {},
    annotations: {},
    findings: [],
    watchedAddresses: [],
    demo: false,
    view: { dimensions: 3, sizeBy: 'uniform', glow: true, showAddresses: false },
  };
}
export function outputAddress(output: Transaction['vout'][number]) {
  return (
    output.scriptPubKey.address ??
    (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined)
  );
}
export function buildGraph(workspace: Workspace): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphData['links'][number]>();
  const clusters = new Map<string, string>();
  for (const finding of workspace.findings)
    if (!finding.excluded && !finding.stale)
      for (const id of finding.nodeIds) clusters.set(id, finding.id);
  const add = (node: GraphNode) => {
    const old = nodes.get(node.id);
    const annotation = workspace.annotations[node.id];
    const label = annotation?.label || node.label;
    nodes.set(node.id, {
      ...old,
      ...node,
      label: annotation?.icon ? `${annotation.icon} ${label}` : label,
      cluster: clusters.get(node.id),
    });
  };
  const link = (source: string, target: string, kind: GraphData['links'][number]['kind']) => {
    const id = `${source}>${target}`;
    links.set(id, { id, source, target, kind });
  };
  for (const tx of Object.values(workspace.transactions)) {
    add({
      id: txNodeId(tx.txid),
      kind: 'transaction',
      txid: tx.txid,
      label: short(tx.txid),
      value: tx.vout.reduce((s, o) => s + sats(o.value), 0),
    });
    for (const output of tx.vout) {
      const id = outputNodeId(tx.txid, output.n);
      const address = outputAddress(output);
      add({
        id,
        kind: 'output',
        txid: tx.txid,
        vout: output.n,
        label: `${short(tx.txid, 5)}:${output.n}`,
        value: sats(output.value),
        address,
      });
      link(txNodeId(tx.txid), id, 'creates');
      if (address && workspace.view.showAddresses) {
        const aid = addressNodeId(address);
        add({ id: aid, kind: 'address', label: short(address), address });
        link(id, aid, 'address');
      }
    }
  }
  for (const tx of Object.values(workspace.transactions))
    for (const input of tx.vin) {
      if (!input.txid || input.vout === undefined) continue;
      const id = outputNodeId(input.txid, input.vout);
      if (!nodes.has(id))
        add({
          id,
          kind: 'output',
          txid: input.txid,
          vout: input.vout,
          label: `${short(input.txid, 5)}:${input.vout}`,
        });
      link(id, txNodeId(tx.txid), 'spends');
    }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}
