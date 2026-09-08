import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addressToScriptHash } from '../lib/wallet';
import { canonicalAddress, canonicalEntityNodeId } from './entityReferences';
import type { GraphData, GraphNode, Network, Workspace, WorkspaceTag } from './types';
import { outputNodeId } from './types';

export const MAX_WORKSPACE_TAGS = 200;
export const MAX_TAG_MEMBERS = 50_000;
const tagSchema = z.object({
  id: z
    .string()
    .uuid()
    .transform((id) => id.toLowerCase()),
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  description: z.string().max(2000).optional(),
  nodeIds: z.array(z.string().max(200)).max(MAX_TAG_MEMBERS),
});
export const workspaceTagsSchema = z.array(tagSchema).max(MAX_WORKSPACE_TAGS);

/** Kept as a named tag boundary for existing callers. */
export const canonicalTagNodeId = canonicalEntityNodeId;

/** Count the supplied records before allocating or normalizing their contents. */
export function assertTagBudget(tags: unknown): void {
  if (!Array.isArray(tags)) return;
  if (tags.length > MAX_WORKSPACE_TAGS) throw new Error('Workspace supports at most 200 tags.');
  let members = 0;
  for (const tag of tags) {
    if (tag && typeof tag === 'object' && Array.isArray(tag.nodeIds)) members += tag.nodeIds.length;
    if (members > MAX_TAG_MEMBERS)
      throw new Error('Workspace exceeds the 50,000 tag membership limit.');
  }
}

export function parseWorkspaceTags(tags: unknown, network: Network): WorkspaceTag[] {
  assertTagBudget(tags);
  const parsed = workspaceTagsSchema.parse(tags);
  const ids = new Set<string>();
  const names = new Set<string>();
  return parsed.map((tag) => {
    if (ids.has(tag.id)) throw new Error('Workspace contains duplicate tag IDs.');
    const nameKey = tag.name.toLowerCase();
    if (names.has(nameKey)) throw new Error('Workspace contains duplicate tag names.');
    ids.add(tag.id);
    names.add(nameKey);
    return {
      ...tag,
      nodeIds: [...new Set(tag.nodeIds.map((id) => canonicalTagNodeId(id, network)))],
    };
  });
}

/** Address membership extends to its outputs, never implicitly to transactions. */
export function listTagsForNode(workspace: Workspace, node: GraphNode): WorkspaceTag[] {
  const address = node.address ? `addr:${canonicalAddress(node.address)}` : undefined;
  return (workspace.tags ?? []).filter((tag) =>
    tag.nodeIds.some(
      (id) =>
        id === node.id || (node.kind !== 'transaction' && address !== undefined && id === address),
    ),
  );
}

/** Build once per workspace/graph update, then use constant-time node lookups. */
export function buildTagIndex(workspace: Workspace, graph: GraphData): Map<string, WorkspaceTag[]> {
  const loaded = new Set<string>();
  const addressNodes = new Map<string, string[]>();
  for (const node of graph.nodes) {
    loaded.add(node.id);
    if (node.kind === 'transaction' || node.address === undefined) continue;
    const addressId = `addr:${canonicalAddress(node.address)}`;
    const nodes = addressNodes.get(addressId);
    if (nodes) nodes.push(node.id);
    else addressNodes.set(addressId, [node.id]);
  }
  const result = new Map<string, WorkspaceTag[]>();
  const add = (id: string, tag: WorkspaceTag) => {
    const tags = result.get(id);
    if (!tags) result.set(id, [tag]);
    else if (tags[tags.length - 1] !== tag) tags.push(tag);
  };
  for (const tag of workspace.tags ?? []) {
    for (const id of tag.nodeIds) {
      if (loaded.has(id)) add(id, tag);
      for (const nodeId of addressNodes.get(id) ?? []) add(nodeId, tag);
    }
  }
  return result;
}

/** Resolve only loaded graph nodes; stored off-graph members remain in the tag. */
export function tagNodeIds(tag: WorkspaceTag, graph: GraphData): string[] {
  const members = new Set(tag.nodeIds);
  return graph.nodes
    .filter(
      (node) =>
        members.has(node.id) ||
        (node.kind !== 'transaction' &&
          node.address !== undefined &&
          members.has(`addr:${canonicalAddress(node.address)}`)),
    )
    .map((node) => node.id);
}

/** Proposals only. Calling this never edits annotations or existing tags.
 * Labels longer than the tag name limit and unsupported references are omitted.
 * Existing tag names are left alone so repeated imports do not alter membership.
 */
export function tagsFromLabels(workspace: Workspace): WorkspaceTag[] {
  const existing = new Set((workspace.tags ?? []).map((tag) => tag.name.toLowerCase()));
  const grouped = new Map<string, { name: string; nodeIds: Set<string> }>();
  for (const [id, annotation] of Object.entries(workspace.annotations)) {
    const name = annotation.label.trim();
    const key = name.toLowerCase();
    if (!name || name.length > 100 || existing.has(key)) continue;
    let canonical: string;
    try {
      canonical = canonicalTagNodeId(id, workspace.network);
    } catch {
      continue;
    }
    const group = grouped.get(key) ?? { name, nodeIds: new Set<string>() };
    group.nodeIds.add(canonical);
    grouped.set(key, group);
  }
  const palette = ['#65cbbb', '#e4af67', '#9c9aed', '#e888a5', '#85bce8', '#a4c977'];
  const proposals = [...grouped.values()].map((group, index) => ({
    id: crypto.randomUUID(),
    name: group.name,
    color: palette[index % palette.length],
    nodeIds: [...group.nodeIds],
  }));
  assertTagBudget([...(workspace.tags ?? []), ...proposals]);
  return proposals;
}

export interface WalletMatch {
  walletIds: string[];
  /** A transaction is associated with matching outputs, not wholly wallet-owned. */
  kind: 'output' | 'address' | 'transaction';
}

/** Project wallet addresses verified by workspace import or browser derivation.
 * No key derivation, history inference or network requests happen here. A raw
 * output script, when present, is authoritative over decoded address text.
 */
export function buildWalletMatches(
  workspace: Workspace,
  graph: GraphData,
): Map<string, WalletMatch> {
  const walletsByScript = new Map<string, Set<string>>();
  for (const wallet of workspace.wallets) {
    for (const address of wallet.addresses) {
      let hash: string;
      try {
        hash = addressToScriptHash(address.address, workspace.network);
      } catch {
        continue;
      }
      if (hash !== address.scripthash) continue;
      const wallets = walletsByScript.get(hash) ?? new Set<string>();
      wallets.add(wallet.id);
      walletsByScript.set(hash, wallets);
    }
  }
  if (!walletsByScript.size) return new Map();
  const outputWallets = new Map<string, Set<string>>();
  const transactionWallets = new Map<string, Set<string>>();
  const associate = (txid: string, wallets: Set<string>) => {
    const associated = transactionWallets.get(txid) ?? new Set<string>();
    for (const id of wallets) associated.add(id);
    transactionWallets.set(txid, associated);
  };
  for (const transaction of Object.values(workspace.transactions)) {
    for (const output of transaction.vout) {
      let hash: string | undefined;
      const script = output.scriptPubKey;
      try {
        if (script.hex !== undefined) {
          hash = bytesToHex(sha256(hexToBytes(script.hex)).reverse());
        } else {
          const address =
            script.address ?? (script.addresses?.length === 1 ? script.addresses[0] : undefined);
          if (address) hash = addressToScriptHash(address, workspace.network);
        }
      } catch {
        continue;
      }
      const wallets = hash ? walletsByScript.get(hash) : undefined;
      if (!wallets) continue;
      outputWallets.set(outputNodeId(transaction.txid, output.n), wallets);
      associate(transaction.txid, wallets);
    }
  }
  for (const transaction of Object.values(workspace.transactions)) {
    for (const input of transaction.vin) {
      if (input.txid === undefined || input.vout === undefined) continue;
      const wallets = outputWallets.get(outputNodeId(input.txid, input.vout));
      if (wallets) associate(transaction.txid, wallets);
    }
  }
  const matches = new Map<string, WalletMatch>();
  for (const node of graph.nodes) {
    let wallets: Set<string> | undefined;
    if (node.kind === 'transaction')
      wallets = transactionWallets.get(node.txid ?? node.id.slice(3));
    else if (node.kind === 'output') wallets = outputWallets.get(node.id);
    else if (node.address) {
      try {
        wallets = walletsByScript.get(addressToScriptHash(node.address, workspace.network));
      } catch {
        /* Unsupported display-only addresses do not establish a match. */
      }
    }
    if (wallets?.size) matches.set(node.id, { walletIds: [...wallets], kind: node.kind });
  }
  return matches;
}
