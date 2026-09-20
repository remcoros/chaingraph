// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GraphView from './GraphView';
import { GraphLegend } from './GraphLegend';
import type { GraphAdapterEvents, GraphAdapterFactory, GraphFrame } from './Renderer/adapter';
import type { GraphLink, GraphNode } from '../../GraphState/types';

const nodes: GraphNode[] = [
  { id: 'source', kind: 'transaction', label: 'Source transaction' },
  { id: 'output-1', kind: 'output', label: 'Output 1' },
  { id: 'output-2', kind: 'output', label: 'Output 2' },
  { id: 'output-3', kind: 'output', label: 'Output 3' },
  { id: 'target', kind: 'transaction', label: 'Target transaction' },
];
const links: GraphLink[] = [1, 2, 3].flatMap((index) => [
  {
    id: `create-${index}`,
    source: 'source',
    target: `output-${index}`,
    kind: 'creates' as const,
  },
  {
    id: `spend-${index}`,
    source: `output-${index}`,
    target: 'target',
    kind: 'spends' as const,
  },
]);

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('grouped output interaction', () => {
  it('toggles grouping and routes its hover card and canvas selection to the member outputs', () => {
    let events: GraphAdapterEvents | undefined;
    let frame: GraphFrame | undefined;
    const adapterFactory: GraphAdapterFactory = (container, nextEvents) => {
      events = nextEvents;
      const canvas = document.createElement('canvas');
      container.append(canvas);
      return {
        canvas,
        update(next) {
          frame = next;
        },
        resize() {},
        focus() {},
        fit() {},
        setMotion() {},
        dispose() {},
      };
    };
    const onSelect = vi.fn();
    const onSelectOutputGroup = vi.fn();

    render(
      <GraphView
        adapterFactory={adapterFactory}
        toolbar={({ motionToggle, groupOutputsToggle }) => (
          <div>
            {motionToggle}
            {groupOutputsToggle}
          </div>
        )}
        legend={({ groupOutputs }) => (
          <GraphLegend
            dimensions={3}
            showAddresses={false}
            groupOutputs={groupOutputs}
            demo={false}
          />
        )}
        nodes={nodes}
        links={links}
        onSelect={onSelect}
        onSelectOutputGroup={onSelectOutputGroup}
        dimensions={3}
        sizeBy="uniform"
        glow
        fitToken={0}
      />,
    );

    const controls = screen.getAllByRole('button');
    expect(controls.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Motion',
      'Group outputs going from/to the same transaction',
    ]);
    const toggle = controls[1];
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(frame?.nodes.filter((node) => node.shape === 'output-group')).toHaveLength(1);
    expect(screen.getByText('Multiple outputs')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(frame?.nodes.filter((node) => node.shape === 'sphere')).toHaveLength(3);
    expect(screen.queryByText('Multiple outputs')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Multiple outputs')).toBeTruthy();

    const group = frame?.nodes.find((node) => node.shape === 'output-group');
    expect(group?.group?.memberIds).toEqual(['output-1', 'output-2', 'output-3']);
    const hit = {
      type: 'output-group' as const,
      id: group!.id,
      memberIds: group!.group!.memberIds,
    };
    act(() => {
      events!.hover({ hit, point: { x: 40, y: 60, pointerType: 'mouse' } });
      vi.advanceTimersByTime(320);
    });

    expect(screen.getByRole('dialog', { name: 'Multiple outputs' })).toBeTruthy();
    expect(screen.getByText('3 outputs')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select outputs' }));
    expect(onSelectOutputGroup).toHaveBeenNthCalledWith(1, ['output-1', 'output-2', 'output-3']);

    act(() => {
      events!.select({ hit, point: { x: 40, y: 60, pointerType: 'mouse' } });
    });
    expect(onSelectOutputGroup).toHaveBeenNthCalledWith(2, ['output-1', 'output-2', 'output-3']);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
