import type { Network } from '../../Core/Bitcoin';
import { Modal } from '../Dialogs';
import { WorkspaceTemplateCards } from './WorkspaceTemplateCards';

export function ExamplesDialog({
  networks,
  onTemplate,
  onClose,
}: {
  networks?: Network[];
  onTemplate: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Example workspaces" onClose={onClose} className="example-workspaces-dialog">
      <p className="muted">
        Real transactions with starter labels, tags and bookmarks. Choose an example to create your
        own encrypted workspace. Only networks configured on your backend are shown.
      </p>
      {networks?.length ? (
        <WorkspaceTemplateCards networks={networks} onTemplate={onTemplate} />
      ) : (
        <p role="status">Connect to your backend to discover available networks.</p>
      )}
    </Modal>
  );
}
