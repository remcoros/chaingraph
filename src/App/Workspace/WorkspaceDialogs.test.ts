// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../Core/Workspace/createWorkspace';
import { planEntityRemoval } from '../../Core/Workspace/entityRemoval';
import type { Workspace } from '../../Core/Workspace/workspace';
import type { WorkspaceController } from './useWorkspace';
import { EntityRemovalDialog } from './WorkspaceDialogs';

const txid = '12345678' + 'a'.repeat(48) + '87654321';
const address = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

function renderRemoval(workspace: Workspace, nodeId: string) {
  const plan = planEntityRemoval(workspace, nodeId);
  expect(plan).toBeDefined();
  expect(plan).not.toHaveProperty('title');
  return renderToStaticMarkup(
    createElement(EntityRemovalDialog, {
      workspace: {
        activeWorkspace: workspace,
        entityRemoval: {
          pending: { workspaceId: workspace.id, nodeId },
          plan,
          cancel: vi.fn(),
          confirm: vi.fn(),
        },
      } as unknown as WorkspaceController,
    }),
  );
}

function example() {
  const workspace = createWorkspace('Removal display', 'mainnet');
  workspace.chainData.transactions[txid] = {
    txid,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  };
  workspace.chainData.watchedAddresses = [address];
  return workspace;
}

describe('entity removal display belongs to the dialog', () => {
  it.each([`tx:${txid}`, `addr:${address}`])('prefers the current annotation for %s', (id) => {
    const workspace = example();
    workspace.annotations.entities[id] = {
      label: 'My label',
      note: '',
      icon: '',
      bookmarked: false,
    };
    expect(renderRemoval(workspace, id)).toContain('<p>My label</p>');
    workspace.annotations.entities[id].label = 'Updated label';
    expect(renderRemoval(workspace, id)).toContain('<p>Updated label</p>');
  });

  it('shortens the transaction title but retains the complete identifier', () => {
    const html = renderRemoval(example(), `tx:${txid}`);
    expect(html).toContain('<p>12345678...87654321</p>');
    expect(html).toContain(`>${txid}</code>`);
    expect(html).toContain('Remove transaction?');
  });

  it('shows the full watched address without a label', () => {
    const html = renderRemoval(example(), `addr:${address}`);
    expect(html).toContain(`<p>${address}</p>`);
    expect(html).toContain('Stop watching address?');
  });
});
