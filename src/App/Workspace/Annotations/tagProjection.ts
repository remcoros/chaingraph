import { TAG_COLORS } from '../../Controls/Metadata/tagColors';
import { addressToScriptHash } from '../../../Domain/Wallet/wallet';
import { canonicalAddress, canonicalEntityNodeId } from '../../../Domain/Metadata/entityReferences';
import type { GraphData, GraphNode } from '../GraphState/types';
import type { Workspace } from '../../../Domain/Workspace/workspaceTypes';
import type { WorkspaceTag } from '../../../Domain/Workspace/annotationTypes';
import { outputNodeId } from '../../../Domain/Metadata/entityReferences';
import { indexPreviousOutputs, outputScriptHash } from '../../../Domain/Chain/prevouts';
import { assertTagBudget } from '../../../Domain/Workspace/tagStorage';

/** Kept as a named tag boundary for existing callers. */
export const canonicalTagNodeId = canonicalEntityNodeId;

/** Address membership extends to its outputs, never implicitly to transactions. */
export function listTagsForNode(
  workspace: Pick<Workspace, 'tags'>,
  node: GraphNode,
): WorkspaceTag[] {
  const address = node.address ? `addr:${canonicalAddress(node.address)}` : undefined;
  return (workspace.tags ?? []).filter((tag) =>
    tag.nodeIds.some(
      (id) =>
        id === node.id || (node.kind !== 'transaction' && address !== undefined && id === address),
    ),
  );
}

/** Build once per workspace/graph update, then use constant-time node lookups. */
export function buildTagIndex(
  workspace: Pick<Workspace, 'tags'>,
  graph: GraphData,
): Map<string, WorkspaceTag[]> {
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
  const proposals = [...grouped.values()].map((group, index) => ({
    id: crypto.randomUUID(),
    name: group.name,
    color: TAG_COLORS[index % TAG_COLORS.length],
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
  workspace: Pick<Workspace, 'network' | 'transactions' | 'wallets'>,
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
  for (const [nodeId, resolution] of indexPreviousOutputs(workspace)) {
    if (resolution.status !== 'loaded' && resolution.status !== 'attached') continue;
    const hash = outputScriptHash(resolution.output, workspace.network);
    const wallets = hash ? walletsByScript.get(hash) : undefined;
    if (!wallets) continue;
    outputWallets.set(nodeId, wallets);
    associate(nodeId.slice(4, 68), wallets);
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
