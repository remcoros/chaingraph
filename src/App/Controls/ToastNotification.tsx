import { X } from 'lucide-react';
import { ADDRESS_DISPLAY_NOTICE } from '../Workspace/workspaceNotices';
import type { WorkspaceController } from '../Workspace/useWorkspace';
import type { useAppState } from '../useAppState';

interface ToastNotificationProps {
  app: ReturnType<typeof useAppState>;
  workspace: WorkspaceController;
}

export function ToastNotification({ app, workspace }: ToastNotificationProps) {
  const { activeWorkspace, workspaces } = app;
  const toastText = app.error || workspaces.storageError || app.notice?.visibleMessage;
  const toastAccessibleText = app.error || workspaces.storageError || app.notice?.message;
  const toastIsError = !!app.error || !!workspaces.storageError || app.notice?.kind === 'error';
  const toastMessageIsTruncated = !!app.notice && app.notice.message !== app.notice.visibleMessage;
  if (!toastText) return null;
  return (
    <div
      className={`toast ${toastIsError ? 'error' : ''}`}
      role={toastIsError ? 'alert' : 'status'}
    >
      <span
        className="feedback-message"
        title={toastMessageIsTruncated ? toastAccessibleText : undefined}
        aria-label={toastMessageIsTruncated ? toastAccessibleText : undefined}
        tabIndex={toastMessageIsTruncated ? 0 : undefined}
      >
        {toastText}
      </span>
      {!app.error &&
        !workspaces.storageError &&
        app.notice?.message === ADDRESS_DISPLAY_NOTICE &&
        activeWorkspace &&
        !activeWorkspace.view.showAddresses && (
          <button
            onClick={() => {
              workspace.edit((current) => ({
                ...current,
                view: { ...current.view, showAddresses: true },
              }));
              app.setNotice('');
            }}
          >
            Enable address display
          </button>
        )}
      {!workspaces.storageError && (
        <button
          className="icon-button"
          aria-label="Dismiss message"
          onClick={() => {
            app.setError('');
            app.setNotice('');
          }}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
