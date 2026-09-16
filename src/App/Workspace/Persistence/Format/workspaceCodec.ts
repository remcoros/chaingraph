import { z } from 'zod';
import {
  connectionScansSchema,
  latestConnectionScanRecords,
  validateConnectionScanRecords,
} from '../../ConnectionScan/records';
import { graphSnapshotSchema } from '../../GraphState/graphSnapshot';
import { graphNodeIdsSchema, parseGraphNodeIds } from '../../GraphState/graphMembership';
import { hiddenNodeIdsSchema, parseHiddenNodeIds } from '../../GraphState/visibility';
import { CURRENT_WORKSPACE_VERSION, type Workspace } from '../../workspace';
import { assertWorkspaceBudget, WorkspaceValidationError } from '../../workspaceValidation';
import {
  MAX_MONEY_SATS,
  transactionSchema,
  validateTransactionAddresses,
} from '../../../../Domain/Chain/transactionValidation';
import { parseWorkspaceTags, workspaceTagsSchema } from '../../Annotations/workspaceTags';
import { walletReviewsSchema } from '../../Wallet/walletReviewRecords';
import { indexPreviousOutputs } from '../../../../Domain/Chain/prevouts';
import { migrateWorkspace } from './workspaceMigrations';
import { legacyGraphNodeIds } from './legacyGraphMembership';
import {
  addressToScriptHash,
  inspectExtendedPublicKey,
  verifyWalletAddresses,
} from '../../../../Domain/Wallet/wallet';
const MAX_GRAPH_RECORDS = 50_000;
const txid = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().max(10000);
const uint32 = z.number().int().min(0).max(0xffffffff);
const derivationIndex = z.number().int().min(0).max(0x7fffffff);
const height = z.number().int().min(-1).max(0x7fffffff);
const timestamp = z.iso.datetime({ offset: true });
const addressHistorySchema = z.object({
  history: z.array(z.object({ tx_hash: txid, height })).max(10000),
  truncated: z.boolean(),
  scannedAt: timestamp.optional(),
});
const addressBalanceSchema = z.object({
  network: z.enum(['mainnet', 'testnet4']),
  confirmedSats: z.number().int().min(0).max(MAX_MONEY_SATS),
  unconfirmedSats: z.number().int().min(-MAX_MONEY_SATS).max(MAX_MONEY_SATS),
  checkedAt: timestamp,
});
const addressUtxoSchema = z.object({
  txid,
  vout: uint32,
  valueSats: z.number().int().min(0).max(MAX_MONEY_SATS),
  height,
});
const addressUtxoObservationSchema = z.object({
  network: z.enum(['mainnet', 'testnet4']),
  utxos: z.array(addressUtxoSchema).max(10000),
  checkedAt: timestamp,
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
  version: z.literal(CURRENT_WORKSPACE_VERSION),
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: text.optional(),
  network: z.enum(['mainnet', 'testnet4']),
  createdAt: timestamp,
  demo: z.boolean(),
  wallets: z.array(walletSchema).max(100),
  transactions: z.record(txid, transactionSchema),
  connectionScans: connectionScansSchema(transactionSchema).optional(),
  inputContext: z.record(txid, z.array(uint32).min(1).max(10000)).optional(),
  contextTransactionIds: z.array(txid).max(10000).optional(),
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
  walletReviews: walletReviewsSchema.optional(),
  findings: z
    .array(
      z.object({
        id: z.string().max(100),
        algorithm: z.string().max(100),
        title: z.string().max(200),
        description: text,
        details: text.optional(),
        guidance: z
          .object({
            kind: z.enum(['tip', 'privacy', 'next-step']),
            text,
          })
          .optional(),
        nodeIds: z.array(z.string().max(200)).max(30000),
        txids: z.array(txid).max(10000),
        createdAt: timestamp,
        excluded: z.boolean().optional(),
        kind: z.enum(['observation', 'hypothesis', 'incomplete']).optional(),
        scopeTxids: z.array(txid).max(10000).optional(),
        stale: z.boolean().optional(),
        reviewRule: z
          .enum(['fee-threshold', 'repeated-address', 'distinct-wallet-inputs'])
          .optional(),
      }),
    )
    .max(10000),
  watchedAddresses: z.array(z.string().max(150)).max(10000),
  addressHistories: z.record(z.string().min(1).max(150), addressHistorySchema).optional(),
  addressBalances: z
    .record(z.string().min(1).max(150), addressBalanceSchema)
    .refine((value) => Object.keys(value).length <= 10000, 'Too many address balance records.')
    .optional(),
  addressUtxos: z
    .record(z.string().min(1).max(150), addressUtxoObservationSchema)
    .refine((value) => Object.keys(value).length <= 10000, 'Too many address UTXO records.')
    .optional(),
  view: z.object({
    dimensions: z.union([z.literal(2), z.literal(3)]),
    sizeBy: z.enum(['uniform', 'value', 'degree']),
    glow: z.boolean(),
    showAddresses: z.boolean(),
    graphNodeIds: graphNodeIdsSchema.optional(),
    hiddenNodeIds: hiddenNodeIdsSchema.optional(),
    entityVisibility: z.enum(['visible', 'hidden', 'all', 'graph']).optional(),
    smallAmountThreshold: z.number().int().min(0).max(MAX_MONEY_SATS).optional(),
    flowAmountThreshold: z.number().int().min(0).max(MAX_MONEY_SATS).optional(),
    showLabels: z.boolean().optional(),
    showTags: z.boolean().optional(),
    showIcons: z.boolean().optional(),
    lockToSelection: z.boolean().optional(),
    highlightMode: z.enum(['all', 'wallets', 'tags', 'none']).optional(),
    graphSnapshot: graphSnapshotSchema.optional(),
    selectionId: z.string().max(300).optional(),
    filters: z
      .object({
        tagId: z.string().max(200).optional(),
        tagState: z.enum(['all', 'tagged', 'untagged']).optional(),
        walletId: z.string().max(200).optional(),
        walletIds: z
          .array(z.string().min(1).max(200))
          .max(100)
          .transform((ids) => [...new Set(ids)])
          .optional(),
        walletMatch: z.enum(['all', 'matched', 'unmatched']).optional(),
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
    workbench: z.enum(['graph', 'analysis', 'trace', 'wallet']).optional(),
    panels: z
      .object({
        left: z
          .object({
            tab: z.enum(['wallets', 'entities', 'bookmarks', 'tags']).optional(),
            collapsed: z.boolean().optional(),
          })
          .optional(),
        right: z
          .object({
            tab: z.enum(['scan', 'inspect', 'addresses', 'transactions', 'utxos']).optional(),
            collapsed: z.boolean().optional(),
          })
          .optional(),
        mobile: z.enum(['graph', 'left', 'right']).optional(),
        flow: z
          .object({
            transactionId: txid.optional(),
            expandedInputs: z.boolean().optional(),
            expandedOutputs: z.boolean().optional(),
            height: z.enum(['collapsed', 'expanded', 'full']).optional(),
          })
          .optional(),
      })
      .optional(),
    prefetchDepth: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    selectedWallet: z.string().max(200).optional(),
  }),
});

export function parseWorkspace(
  data: unknown,
  verifyDerivation = true,
  restoreRunningScans = true,
): Workspace {
  const migrated = migrateWorkspace(data);
  assertWorkspaceBudget(migrated, true);
  const parsed = workspaceSchema.parse(migrated);
  if (
    parsed.view.graphNodeIds === undefined &&
    [2, 3, CURRENT_WORKSPACE_VERSION].includes((data as { version?: number }).version ?? 0)
  )
    throw new Error('Workspace is missing explicit graph entity membership.');
  if (parsed.view.graphNodeIds !== undefined)
    parsed.view.graphNodeIds = parseGraphNodeIds(parsed.view.graphNodeIds, parsed.network);
  if (parsed.view.hiddenNodeIds !== undefined)
    parsed.view.hiddenNodeIds = parseHiddenNodeIds(parsed.view.hiddenNodeIds, parsed.network);
  if (parsed.tags !== undefined) parsed.tags = parseWorkspaceTags(parsed.tags, parsed.network);
  if (Object.entries(parsed.transactions).some(([id, transaction]) => id !== transaction.txid))
    throw new Error('Workspace has invalid transaction records.');
  if (
    new Set(parsed.contextTransactionIds ?? []).size !== (parsed.contextTransactionIds?.length ?? 0)
  )
    throw new Error('Automatic context contains duplicate transaction references.');
  if (parsed.contextTransactionIds?.some((id) => !parsed.transactions[id]))
    throw new Error('Automatic context must reference a loaded transaction.');
  for (const [id, outputs] of Object.entries(parsed.inputContext ?? {})) {
    const transaction = parsed.transactions[id];
    if (!transaction) throw new Error('Input context must reference a loaded transaction.');
    if (new Set(outputs).size !== outputs.length)
      throw new Error('Input context contains duplicate output indexes.');
    if (outputs.some((index) => index >= transaction.vout.length))
      throw new Error('Input context references an output outside its transaction.');
  }
  for (const transaction of Object.values(parsed.transactions))
    validateTransactionAddresses(transaction, parsed.network);
  if (
    [...indexPreviousOutputs(parsed).values()].some(
      (resolution) => resolution.status === 'conflict',
    )
  )
    throw new Error('Workspace contains conflicting previous-output observations.');
  if (parsed.connectionScans) {
    for (const transaction of Object.values(parsed.connectionScans.evidence))
      validateTransactionAddresses(transaction, parsed.network);
    validateConnectionScanRecords(parsed.connectionScans, parsed);
    parsed.connectionScans = latestConnectionScanRecords(parsed);
    if (restoreRunningScans && parsed.connectionScans)
      parsed.connectionScans.runs = parsed.connectionScans.runs.map((run) =>
        run.status === 'running' ? { ...run, status: 'interrupted' as const } : run,
      );
  }
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
  for (const address of Object.keys(parsed.addressHistories ?? {}))
    addressToScriptHash(address, parsed.network);
  for (const [address, observation] of Object.entries(parsed.addressBalances ?? {})) {
    addressToScriptHash(address, parsed.network);
    if (observation.network !== parsed.network)
      throw new Error('Address balance observation belongs to a different network.');
  }
  for (const [address, observation] of Object.entries(parsed.addressUtxos ?? {})) {
    addressToScriptHash(address, parsed.network);
    if (observation.network !== parsed.network)
      throw new Error('Address UTXO observation belongs to a different network.');
    if (observation.utxos.some((entry) => entry.txid.length !== 64))
      throw new Error('Address UTXO observation contains an invalid transaction ID.');
  }
  if (parsed.view.graphNodeIds === undefined)
    parsed.view.graphNodeIds = parseGraphNodeIds(legacyGraphNodeIds(parsed), parsed.network);
  return parsed;
}
