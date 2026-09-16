import type { WorkspaceTag } from '../../Workspace/Annotations/workspaceTags';
/** Shared non-interactive metadata for transaction rows, graph cards and lists. */
export function EntityBadges({
  tags,
  wallets,
  related = false,
}: {
  tags: readonly WorkspaceTag[];
  wallets: readonly string[];
  related?: boolean;
}) {
  if (!tags.length && !wallets.length) return null;
  return (
    <span className="tag-badges entity-badges">
      {wallets.slice(0, 2).map((name, index) => (
        <span
          key={`${name}:${index}`}
          title={
            related
              ? 'Transaction associated with matched wallet outputs'
              : 'Script matches a derived wallet address'
          }
        >
          <i className="wallet-match-dot" />
          {related ? 'Related' : 'Wallet'}: {name}
        </span>
      ))}
      {wallets.length > 2 && <span>+{wallets.length - 2} wallets</span>}
      {tags.slice(0, 3).map((tag) => (
        <span key={tag.id} title={`Manual tag: ${tag.name}`}>
          <i style={{ backgroundColor: tag.color }} />
          {tag.name}
        </span>
      ))}
      {tags.length > 3 && (
        <span title="Open Tags in the inspector for all memberships">+{tags.length - 3} tags</span>
      )}
    </span>
  );
}
