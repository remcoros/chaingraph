import { createTemplateWorkspace } from '../domain/workspaceTemplates';

// One creation per worker. No password is sent here.
self.onmessage = async (event: MessageEvent<{ id: string; name: string; description: string }>) => {
  self.onmessage = null;
  try {
    const { id, name, description } = event.data;
    self.postMessage({ workspace: await createTemplateWorkspace(id, name, description) });
  } catch {
    self.postMessage({ error: true });
  }
};
