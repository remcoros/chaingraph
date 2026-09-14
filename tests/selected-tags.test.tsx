// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SelectedTags } from '../src/App/Workspace/Tags/TagsPanel';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import { txNodeId, type GraphNode, type Workspace } from '../src/Domain/types';
import { installDomStubs } from './domStubs';

installDomStubs();

afterEach(cleanup);

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function node(txid: string): GraphNode {
  return { id: txNodeId(txid), kind: 'transaction', label: txid.slice(0, 8), txid };
}

/** Mirrors the inspector: the selection and the workspace can both change under it. */
function Host({ second }: { second: Workspace }) {
  const [workspace, setWorkspace] = useState(() => newWorkspace('Tags fixture', 'mainnet'));
  const [selected, setSelected] = useState(() => node(A));
  return (
    <>
      <SelectedTags
        workspace={workspace}
        selected={selected}
        onChange={() => {}}
        onManage={() => {}}
      />
      <button type="button" onClick={() => setSelected(node(B))}>
        select another
      </button>
      <button type="button" onClick={() => setWorkspace(second)}>
        open another workspace
      </button>
    </>
  );
}

const addButton = () => screen.getByLabelText('Add or choose tags');

describe('SelectedTags', () => {
  it('opens its picker when asked', () => {
    render(<Host second={newWorkspace('Other', 'mainnet')} />);
    expect(addButton().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(addButton());
    expect(addButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the picker when the selection moves to another entity', () => {
    render(<Host second={newWorkspace('Other', 'mainnet')} />);
    fireEvent.click(addButton());
    fireEvent.click(screen.getByText('select another'));
    expect(addButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the picker when another workspace is opened', () => {
    render(<Host second={newWorkspace('Other', 'mainnet')} />);
    fireEvent.click(addButton());
    fireEvent.click(screen.getByText('open another workspace'));
    expect(addButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves the picker open while nothing it depends on changes', () => {
    render(<Host second={newWorkspace('Other', 'mainnet')} />);
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    expect(addButton().getAttribute('aria-expanded')).toBe('true');
  });
});
