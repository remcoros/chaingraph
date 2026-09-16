// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EntityBrowser from './EntityBrowser';
import { txNodeId } from '../../../../../Domain/Metadata/entityReferences';
import type { GraphFilters } from '../../../GraphState/filters';
import type { GraphNode } from '../../../GraphState/types';
import { installDomStubs } from '../../../../../../tests/domStubs';

installDomStubs();
afterEach(cleanup);

const nodes: GraphNode[] = Array.from({ length: 120 }, (_, i) => {
  const txid = i.toString(16).padStart(64, '0');
  return { id: txNodeId(txid), kind: 'transaction', label: `tx ${i}`, txid };
});

/** Mirrors the graph panel: it owns the filters the browser reports back. */
function Host() {
  const [filters, setFilters] = useState<GraphFilters>({});
  return (
    <EntityBrowser
      nodes={nodes}
      annotations={{}}
      filters={filters}
      onFiltersChange={setFilters}
      onResetFilters={() => setFilters({})}
      onSelect={() => {}}
      onRemoveNode={() => {}}
      onSetHidden={() => {}}
    />
  );
}

const pageLabel = () => screen.getByText(/^Page \d+ \/ \d+$/).textContent;

describe('EntityBrowser paging', () => {
  it('pages through the entities it is given', () => {
    render(<Host />);
    expect(pageLabel()).toMatch(/^Page 1 \//);
    fireEvent.click(screen.getByLabelText('Next entity page'));
    expect(pageLabel()).toMatch(/^Page 2 \//);
  });

  it('returns to the first page when the filters change', () => {
    // A later page of the old results says nothing about the new ones, and can
    // be past their end entirely.
    render(<Host />);
    fireEvent.click(screen.getByLabelText('Next entity page'));
    expect(pageLabel()).toMatch(/^Page 2 \//);
    fireEvent.change(screen.getByPlaceholderText(/^Search labels/), { target: { value: 'tx 1' } });
    expect(pageLabel()).toMatch(/^Page 1 \//);
  });

  it('stays on the page while nothing it depends on changes', () => {
    render(<Host />);
    fireEvent.click(screen.getByLabelText('Next entity page'));
    fireEvent.click(screen.getByLabelText('Next entity page'));
    expect(pageLabel()).toMatch(/^Page 3 \//);
  });
});
