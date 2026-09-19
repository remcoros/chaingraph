import { ArrowUpRight } from 'lucide-react';
import type { Network } from '../../Core/Bitcoin';
import { WORKSPACE_TEMPLATES } from './workspaceTemplates';

export function WorkspaceTemplateCards({
  networks,
  onTemplate,
}: {
  networks: Network[];
  onTemplate: (id: string) => void;
}) {
  return (
    <div className="workspace-template-gallery">
      {(['mainnet', 'testnet4'] as const)
        .filter((network) => networks.includes(network))
        .map((network) => (
          <section
            className="workspace-template-group"
            aria-label={`${network === 'mainnet' ? 'Mainnet' : 'Testnet4'} examples`}
            key={network}
          >
            <div className="workspace-template-grid">
              {WORKSPACE_TEMPLATES.filter((template) => template.network === network).map(
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
                        <strong className="workspace-template-title">{template.name}</strong>
                        <span className="workspace-template-network">
                          {template.network === 'mainnet' ? 'Mainnet' : 'Testnet4'}
                        </span>
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </span>
                      <span className="small muted">{template.summary}</span>
                    </button>
                    <div className="workspace-template-actions">
                      <button
                        className="workspace-template-action"
                        onClick={() => onTemplate(template.id)}
                      >
                        Create workspace →
                      </button>
                      <a
                        className="workspace-template-source"
                        href={template.sources[0].url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${template.name} on mempool.space`}
                      >
                        mempool.space <ArrowUpRight size={12} aria-hidden="true" />
                      </a>
                    </div>
                  </article>
                ),
              )}
            </div>
          </section>
        ))}
    </div>
  );
}
