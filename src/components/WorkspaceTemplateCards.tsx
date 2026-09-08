import { ArrowUpRight } from 'lucide-react';
import type { Network } from '../domain/types';
import { WORKSPACE_TEMPLATES } from '../domain/workspaceTemplates';

export function WorkspaceTemplateCards({
  networks,
  onTemplate,
}: {
  networks: Network[];
  onTemplate: (id: string) => void;
}) {
  return (
    <div className="workspace-template-grid">
      {WORKSPACE_TEMPLATES.filter((template) => networks.includes(template.network)).map(
        (template) => (
          <article className="workspace-template" key={template.id}>
            <button
              className="workspace-template-open"
              aria-label={`Create ${template.name} workspace`}
              onClick={() => onTemplate(template.id)}
            >
              <span className="workspace-template-heading">
                <span aria-hidden="true" className="workspace-template-icon">
                  {template.icon}
                </span>
                <span className="workspace-template-network">
                  {template.network === 'mainnet' ? 'Mainnet' : 'Testnet4'}
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </span>
              <strong>{template.name}</strong>
              <span className="small muted">{template.summary}</span>
              <span className="workspace-template-action">Create workspace →</span>
            </button>
            <a
              className="workspace-template-source"
              href={template.sources[0].url}
              target="_blank"
              rel="noreferrer"
              aria-label={`View source for ${template.name}`}
            >
              View transaction source <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </article>
        ),
      )}
    </div>
  );
}
