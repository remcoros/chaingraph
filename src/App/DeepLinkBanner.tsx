import { X } from 'lucide-react';
import { addressToScriptHash, type Network } from '../Core/Bitcoin';
import type { useAppState } from './useAppState';
import type { WorkspaceController } from './Workspace/useWorkspace';

interface DeepLinkBannerProps {
  app: ReturnType<typeof useAppState>;
  workspace: WorkspaceController;
}

function compactReference(ref: string) {
  return ref.length > 24 ? `${ref.slice(0, 10)}…${ref.slice(-8)}` : ref;
}

function isAddressForNetwork(ref: string, network: Network) {
  try {
    addressToScriptHash(ref, network);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shows a lookup reference carried by a #?s= URL fragment until it is added to
 * a graph or dismissed. The fragment itself is consumed on arrival; this
 * banner is the only remaining holder of the reference.
 */
export function DeepLinkBanner({ app, workspace }: DeepLinkBannerProps) {
  const ref = app.deepLinkRef;
  if (!ref) return null;
  const addToGraph = async () => {
    if (!app.activeWorkspace) {
      app.setNotice(
        'Open or create a workspace first, then add the linked reference from the banner.',
      );
      return;
    }
    const valid =
      /^[0-9a-f]{64}(:\d+)?$/i.test(ref) || isAddressForNetwork(ref, app.activeWorkspace.network);
    if (!valid) {
      app.setNotice('The link does not contain a valid transaction ID, output, or address.');
      return;
    }
    await workspace.graph.lookup.submit(ref);
    if (workspace.graph.lookup.resolveLoaded(ref)) app.setDeepLinkRef(undefined);
  };
  return (
    <div className="deep-link-banner" data-testid="deep-link-banner" role="status">
      <span className="deep-link-banner-label">Linked lookup</span>
      <button
        type="button"
        className="deep-link-banner-ref mono"
        data-testid="deep-link-banner-ref"
        title={`Add ${ref} to the graph`}
        onClick={() => void addToGraph()}
      >
        {compactReference(ref)}
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss linked lookup"
        onClick={() => app.setDeepLinkRef(undefined)}
      >
        <X size={15} />
      </button>
    </div>
  );
}
