import { z } from 'zod';
import {
  connectionScansSchema,
  type ConnectionScanRecords,
} from './ConnectionScan/connectionScans';
import {
  latestConnectionScanRecords,
  validateConnectionScanRecords,
} from './ConnectionScan/records';
import {
  parseGraphNodeIds,
  parseHiddenNodeIds,
  viewSchema,
  type GraphFilters,
  type GraphPanelsState,
  type GraphSnapshot,
} from './view';

import { assertWorkspaceBudget, WorkspaceValidationError } from './budgets';
import { validateTransactionAddresses, indexPreviousOutputs } from '../ChainData/index';
import {
  parseWorkspaceTags,
  annotationsSchema,
  type Annotation,
  type WorkspaceTag,
} from './Annotations/annotations';

import { addressToScriptHash, type Network } from '../Bitcoin/index';
import { inspectExtendedPublicKey, verifyDerivedAddresses } from './Wallets/walletDerivation';
import { canonicalEntityReference } from './entityReferences';
const text = z.string().max(10000);
const timestamp = z.iso.datetime({ offset: true });
import { chainDataSchema, type ChainDataDocument } from './chainData';
import { walletsSchema, type Wallet, type WalletReviewRecords } from './Wallets/wallets';

import { analysisSchema, type AnalysisFinding } from './Analysis/finding';

/** Decrypted workspace schema version, independent of the encrypted envelope version. */
export const CURRENT_WORKSPACE_VERSION = 6 as const;

/** Canonical live and decrypted document. Runtime services belong to the unlocked session. */
export interface WorkspaceDocument {
  /** Decrypted data schema version, independent of the encrypted envelope format. */
  version: typeof CURRENT_WORKSPACE_VERSION;
  id: string;
  name: string;
  description?: string;
  network: Network;
  createdAt: string;
  chainData: ChainDataDocument;
  wallets: {
    definitions: Wallet[];
    /** Review decisions keyed by `walletId|reason|subject`. */
    reviews?: WalletReviewRecords;
  };
  annotations: {
    entities: Record<string, Annotation>;
    tags?: WorkspaceTag[];
  };
  analysis: { findings: AnalysisFinding[] };
  /** Compact scan records and retained path evidence, encrypted with this workspace. */
  connectionScans?: ConnectionScanRecords;
  demo: boolean;
  view: {
    /** Automatically fetched input parents show only these outputs until explicitly opened. */
    inputContext?: Record<string, number[]>;
    dimensions: 2 | 3;
    sizeBy: 'uniform' | 'value' | 'degree';
    glow: boolean;
    showAddresses: boolean;
    graphNodeIds?: string[];
    hiddenNodeIds?: string[];
    entityVisibility?: 'visible' | 'hidden' | 'all' | 'graph';
    smallAmountThreshold?: number;
    flowAmountThreshold?: number;
    showLabels?: boolean;
    showTags?: boolean;
    showIcons?: boolean;
    lockToSelection?: boolean;
    highlightMode?: 'all' | 'wallets' | 'tags' | 'none';
    graphSnapshot?: GraphSnapshot;
    selectionId?: string;
    filters?: GraphFilters;
    workbench?: 'graph' | 'analysis' | 'trace' | 'wallet';
    panels?: GraphPanelsState;
    prefetchDepth?: 0 | 1 | 2;
    selectedWallet?: string;
  };
}

/** The live workspace data is the document, never a second flattened model. */
export type Workspace = WorkspaceDocument;

const workspaceSchema: z.ZodType<Workspace> = z.object({
  version: z.literal(CURRENT_WORKSPACE_VERSION),
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: text.optional(),
  network: z.enum(['mainnet', 'testnet4']),
  createdAt: timestamp,
  demo: z.boolean(),
  connectionScans: connectionScansSchema.optional(),
  view: viewSchema,
  chainData: chainDataSchema,
  wallets: walletsSchema,
  annotations: annotationsSchema,
  analysis: analysisSchema,
});
export function validateWorkspace(data: unknown, verifyDerivation = true): Workspace {
  assertWorkspaceBudget(data, true);
  const parsed = workspaceSchema.parse(data);
  if (parsed.view.graphNodeIds !== undefined)
    parsed.view.graphNodeIds = parseGraphNodeIds(parsed.view.graphNodeIds, parsed.network);
  if (parsed.view.hiddenNodeIds !== undefined)
    parsed.view.hiddenNodeIds = parseHiddenNodeIds(parsed.view.hiddenNodeIds, parsed.network);
  if (parsed.annotations.tags !== undefined)
    parsed.annotations.tags = parseWorkspaceTags(parsed.annotations.tags, parsed.network);
  for (const finding of parsed.analysis.findings) {
    if (!finding.subjects) continue;
    const subjects = finding.subjects.map((id) => canonicalEntityReference(id, parsed.network));
    if (new Set(subjects).size !== subjects.length)
      throw new Error('Analysis finding contains duplicate subjects.');
    finding.subjects = subjects;
  }
  if (
    Object.entries(parsed.chainData.transactions).some(
      ([id, transaction]) => id !== transaction.txid,
    )
  )
    throw new Error('Workspace has invalid transaction records.');
  if (
    new Set(parsed.chainData.contextTransactionIds ?? []).size !==
    (parsed.chainData.contextTransactionIds?.length ?? 0)
  )
    throw new Error('Automatic context contains duplicate transaction references.');
  if (parsed.chainData.contextTransactionIds?.some((id) => !parsed.chainData.transactions[id]))
    throw new Error('Automatic context must reference a loaded transaction.');
  for (const [id, outputs] of Object.entries(parsed.view.inputContext ?? {})) {
    const transaction = parsed.chainData.transactions[id];
    if (!transaction) throw new Error('Input context must reference a loaded transaction.');
    if (new Set(outputs).size !== outputs.length)
      throw new Error('Input context contains duplicate output indexes.');
    if (outputs.some((index) => index >= transaction.vout.length))
      throw new Error('Input context references an output outside its transaction.');
  }
  for (const transaction of Object.values(parsed.chainData.transactions))
    validateTransactionAddresses(transaction, parsed.network);
  if (
    [
      ...indexPreviousOutputs({
        network: parsed.network,
        transactions: parsed.chainData.transactions,
      }).values(),
    ].some((resolution) => resolution.status === 'conflict')
  )
    throw new Error('Workspace contains conflicting previous-output observations.');
  if (parsed.connectionScans) {
    for (const transaction of Object.values(parsed.connectionScans.evidence))
      validateTransactionAddresses(transaction, parsed.network);
    validateConnectionScanRecords(
      parsed.connectionScans,
      parsed.network,
      parsed.chainData.transactions,
    );
    parsed.connectionScans = latestConnectionScanRecords(
      parsed.connectionScans,
      parsed.chainData.transactions,
    );
  }
  const walletIds = new Set<string>();
  for (const wallet of parsed.wallets.definitions) {
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
      verifyDerivedAddresses(wallet.key, parsed.network, wallet.scriptType, wallet.addresses);
  }
  for (const address of parsed.chainData.watchedAddresses)
    addressToScriptHash(address, parsed.network);
  for (const address of Object.keys(parsed.chainData.addressHistories ?? {}))
    addressToScriptHash(address, parsed.network);
  for (const [address, observation] of Object.entries(parsed.chainData.addressBalances ?? {})) {
    addressToScriptHash(address, parsed.network);
    if (observation.network !== parsed.network)
      throw new Error('Address balance observation belongs to a different network.');
  }
  for (const [address, observation] of Object.entries(parsed.chainData.addressUtxos ?? {})) {
    addressToScriptHash(address, parsed.network);
    if (observation.network !== parsed.network)
      throw new Error('Address UTXO observation belongs to a different network.');
    if (observation.utxos.some((entry) => entry.txid.length !== 64))
      throw new Error('Address UTXO observation contains an invalid transaction ID.');
  }
  return parsed;
}
