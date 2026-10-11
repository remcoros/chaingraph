import { parseExtendedPublicKey } from '../../Bitcoin';
import type { Workspace } from '../workspace';
import { buildWalletMatches, type WalletMatchSubject } from '../Wallets/walletMatches';

export type LabelScope =
  | { kind: 'workspace' }
  | { kind: 'wallet'; walletId: string }
  | { kind: 'selection'; ids: readonly string[] };

export function createLabelKeyMatcher(workspace: Workspace) {
  const parsed = new Map<string, ReturnType<typeof parseExtendedPublicKey>>();
  const parse = (key: string) => {
    let value = parsed.get(key);
    if (!value) {
      value = parseExtendedPublicKey(key, workspace.network);
      parsed.set(key, value);
    }
    return value;
  };
  const wallets = workspace.wallets.definitions.map((wallet) => ({
    wallet,
    key: parse(wallet.key),
  }));
  const matching = (key: string) => {
    const incoming = parse(key);
    return wallets
      .filter(
        ({ wallet, key: stored }) =>
          incoming.bip32Key === stored.bip32Key &&
          (!incoming.encoding.script || incoming.encoding.script === wallet.scriptType),
      )
      .map(({ wallet }) => wallet);
  };
  return { parse, matching };
}

/** Use script-verified relationships, including off-canvas loaded evidence. */
export function labelScopeIds(
  workspace: Workspace,
  ids: readonly string[],
  scope: LabelScope,
  matcher = createLabelKeyMatcher(workspace),
): Set<string> {
  if (scope.kind === 'workspace') return new Set(ids);
  if (scope.kind === 'selection') return new Set(scope.ids);
  if (!workspace.wallets.definitions.some((wallet) => wallet.id === scope.walletId))
    return new Set();
  const subjects: WalletMatchSubject[] = [];
  const keys: string[] = [];
  for (const id of ids) {
    if (id.startsWith('tx:')) subjects.push({ id, kind: 'transaction', txid: id.slice(3) });
    else if (id.startsWith('out:')) subjects.push({ id, kind: 'output' });
    else if (id.startsWith('addr:')) subjects.push({ id, kind: 'address', address: id.slice(5) });
    else if (id.startsWith('xpub:')) {
      try {
        if (matcher.matching(id.slice(5)).some((wallet) => wallet.id === scope.walletId))
          keys.push(id);
      } catch {
        // Legacy annotation references cannot establish wallet membership.
        // Wallet definitions and inspected incoming keys are validated separately.
      }
    }
  }
  const matches = buildWalletMatches(workspace, subjects);
  return new Set([
    ...keys,
    ...subjects
      .filter((subject) => matches.get(subject.id)?.walletIds.includes(scope.walletId))
      .map((subject) => subject.id),
  ]);
}

export function knownLabelReference(
  workspace: Workspace,
  id: string,
  matcher = createLabelKeyMatcher(workspace),
): boolean {
  if (id.startsWith('tx:')) return Boolean(workspace.chainData.transactions[id.slice(3)]);
  if (id.startsWith('out:')) {
    const [txid, index] = id.slice(4).split(':');
    return Boolean(
      workspace.chainData.transactions[txid]?.vout.some((output) => output.n === Number(index)),
    );
  }
  if (id.startsWith('addr:'))
    return (
      workspace.wallets.definitions.some((wallet) =>
        wallet.addresses.some((address) => address.address === id.slice(5)),
      ) || workspace.chainData.watchedAddresses.includes(id.slice(5))
    );
  if (id.startsWith('xpub:')) return matcher.matching(id.slice(5)).length > 0;
  return false;
}
