import { z } from 'zod';
import { canonicalEntityReference } from './entityReferences';
import { type Network, MAX_MONEY_SATS } from '../Bitcoin/index';

const MAX_GRAPH_RECORDS = 50_000;
const txid = z.string().regex(/^[0-9a-f]{64}$/);
const uint32 = z.number().int().min(0).max(0xffffffff);
export type GraphLeftTab = 'wallets' | 'entities' | 'bookmarks' | 'tags';
export type GraphRightTab = 'scan' | 'inspect' | 'addresses' | 'transactions' | 'utxos';
export type GraphMobilePanel = 'graph' | 'left' | 'right';
export type FlowPanelHeight = 'collapsed' | 'expanded' | 'full';

export interface TransactionFlowState {
  transactionId?: string;
  expandedInputs?: boolean;
  expandedOutputs?: boolean;
  height?: FlowPanelHeight;
}

export interface GraphPanelsState {
  left?: { tab?: GraphLeftTab; collapsed?: boolean };
  right?: { tab?: GraphRightTab; collapsed?: boolean };
  flow?: TransactionFlowState;
  mobile?: GraphMobilePanel;
}

/** Saved filters. Transient projection exclusions belong to Graph. */
export interface GraphFilters {
  tagId?: string;
  tagState?: 'all' | 'tagged' | 'untagged';
  walletId?: string;
  walletIds?: string[];
  walletMatch?: 'all' | 'matched' | 'unmatched';
  query?: string;
  kind?: 'all' | 'transaction' | 'output' | 'address';
  label?: 'all' | 'labeled' | 'unlabeled';
  bookmarkedOnly?: boolean;
  minSats?: number;
  maxSats?: number;
  spend?: 'all' | 'observed' | 'unknown';
  funding?: 'all' | 'missing' | 'loaded';
  showAddresses?: boolean;
  focus?: { id: string; hops: 1 | 2 };
  preserveContext?: boolean;
  includeIds?: string[];
}

export const GRAPH_SNAPSHOT_NODE_LIMIT = 50_000;
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const point = z.object({ x: coordinate, y: coordinate, z: coordinate });
export const graphSnapshotSchema = z.object({
  version: z.literal(1),
  dimensions: z.union([z.literal(2), z.literal(3)]),
  camera: z
    .object({ position: point, target: point, up: point })
    .refine(
      ({ position, target, up }) =>
        Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z) > 0.001 &&
        Math.hypot(up.x, up.y, up.z) > 0.001,
      'Invalid camera orientation',
    ),
  nodes: z
    .array(point.extend({ id: z.string().min(1).max(200) }))
    .max(GRAPH_SNAPSHOT_NODE_LIMIT)
    .refine(
      (nodes) => new Set(nodes.map((node) => node.id)).size === nodes.length,
      'Duplicate graph positions',
    ),
});

/** Geometry only: no renderer objects, annotations, Bitcoin data or actions. */
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;

export function validateGraphSnapshot(value: unknown) {
  return graphSnapshotSchema.safeParse(value);
}

/** Camera-only updates need not traverse the unchanged position records. */
export function validateGraphCamera(value: unknown) {
  return graphSnapshotSchema.shape.camera.safeParse(value);
}

export function validateGraphPositions(value: unknown) {
  return graphSnapshotSchema.shape.nodes.safeParse(value);
}

export const MAX_GRAPH_NODES = 110_000;
export const MAX_GRAPH_ACTION_NODES = 50_000;
export const graphNodeIdsSchema = z.array(z.string().max(200)).max(MAX_GRAPH_NODES);

export function assertGraphNodeBudget(value: unknown): void {
  if (Array.isArray(value) && value.length > MAX_GRAPH_NODES)
    throw new Error('Workspace exceeds the 110,000 graph entity limit.');
}

export function parseGraphNodeIds(value: unknown, network: Network): string[] {
  assertGraphNodeBudget(value);
  return [
    ...new Set(graphNodeIdsSchema.parse(value).map((id) => canonicalEntityReference(id, network))),
  ];
}

export const MAX_HIDDEN_NODES = 50_000;
export const hiddenNodeIdsSchema = z.array(z.string().max(200)).max(MAX_HIDDEN_NODES);

export function assertHiddenNodeBudget(value: unknown): void {
  if (Array.isArray(value) && value.length > MAX_HIDDEN_NODES)
    throw new Error('Workspace exceeds the 50,000 hidden entity limit.');
}

export function parseHiddenNodeIds(value: unknown, network: Network): string[] {
  assertHiddenNodeBudget(value);
  return [
    ...new Set(hiddenNodeIdsSchema.parse(value).map((id) => canonicalEntityReference(id, network))),
  ];
}

/** Hide exactly these entities. This never edits transaction observations or linked entities. */

export const viewSchema = z.object({
  inputContext: z.record(txid, z.array(uint32).min(1).max(10000)).optional(),
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
});
