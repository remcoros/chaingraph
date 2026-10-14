// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceTemplateCards } from './WorkspaceTemplateCards';
import { WORKSPACE_TEMPLATES } from './workspaceTemplates';

afterEach(cleanup);
it.each(['mainnet', 'testnet4'] as const)(
  'keeps normal %s example controls scoped to the configured network',
  (network) => {
    const choose = vi.fn();
    render(<WorkspaceTemplateCards networks={[network]} onTemplate={choose} />);
    for (const control of screen.getAllByRole('button', { name: /^create .* workspace$/i }))
      fireEvent.click(control);
    expect(choose.mock.calls.map(([id]) => id)).toEqual(
      WORKSPACE_TEMPLATES.filter((entry) => entry.network === network).map((entry) => entry.id),
    );
  },
);
